import { Worker } from "node:worker_threads";
// Keep the driver in the server dependency trace.  The worker is evaluated by
// Node rather than webpack, so it must be given the absolute module entry that
// was resolved by the parent server module.
import mysqlDriver from "mysql2/promise";

type QueryOperation = "get" | "all" | "run" | "exec" | "begin" | "commit" | "rollback";
type QueryParameters = unknown[] | Record<string, unknown>;

// This worker deliberately lives in the server bundle instead of a separate
// file. Managed Node hosts (including Hostinger) retain the Next server output
// but may discard custom files placed next to `.next` during their deploy
// packaging phase. `mysql2` is a production dependency, so it is resolved by
// Node inside the worker at runtime.
const MYSQL_WORKER_SOURCE = String.raw`
const { parentPort } = require("node:worker_threads");
const { workerData } = require("node:worker_threads");

if (!parentPort) throw new Error("MySQL worker requires a parent port.");

let pool;
let transactionConnection;
let startupFailure;
try {
  const mysql = require(workerData.mysqlModulePath);
  // The hosting provider closes idle MySQL connections. A pool discards
  // closed connections and opens a fresh one for the next request.
  pool = mysql.createPool({
    uri: process.env.DATABASE_URL,
    connectTimeout: 7000,
    waitForConnections: true,
    connectionLimit: 2,
    maxIdle: 1,
    idleTimeout: 30000,
    multipleStatements: true,
    supportBigNumbers: true,
    bigNumberStrings: false,
    ssl: process.env.DATABASE_SSL === "false"
      ? undefined
      : { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" },
  });
} catch (error) {
  startupFailure = {
    message: typeof error === "object" && error && "message" in error ? String(error.message) : "MySQL worker could not start.",
    code: typeof error === "object" && error && "code" in error ? String(error.code) : "MYSQL_WORKER_STARTUP_ERROR",
  };
}

function finish(buffer, ok, payload) {
  const control = new Int32Array(buffer, 0, 4);
  const output = new Uint8Array(buffer, 16);
  let encoded = new TextEncoder().encode(JSON.stringify(payload));
  if (encoded.length > output.length) {
    ok = false;
    encoded = new TextEncoder().encode(JSON.stringify({ message: "MySQL result exceeded the configured response buffer.", code: "RESULT_TOO_LARGE" }));
  }
  output.set(encoded);
  Atomics.store(control, 1, encoded.length);
  Atomics.store(control, 2, ok ? 1 : 0);
  Atomics.store(control, 0, 1);
  Atomics.notify(control, 0);
}

parentPort.on("message", async ({ buffer, operation, sql, params }) => {
  try {
    if (startupFailure) throw Object.assign(new Error(startupFailure.message), { code: startupFailure.code });
    if (operation === "begin") {
      if (transactionConnection) throw new Error("A MySQL transaction is already active.");
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        transactionConnection = connection;
      } catch (error) {
        connection.release();
        throw error;
      }
    } else if (operation === "commit" || operation === "rollback") {
      if (!transactionConnection) throw new Error("No MySQL transaction is active.");
      const connection = transactionConnection;
      transactionConnection = undefined;
      try {
        if (operation === "commit") await connection.commit();
        else await connection.rollback();
      } finally {
        connection.release();
      }
    }
    else {
      const [result] = await (transactionConnection || pool).query(sql, params || []);
      if (operation === "get") finish(buffer, true, Array.isArray(result) ? result[0] ?? null : null);
      else if (operation === "all") finish(buffer, true, Array.isArray(result) ? result : []);
      else if (operation === "run") finish(buffer, true, { changes: Number(result.affectedRows || 0), lastInsertRowid: Number(result.insertId || 0) });
      else finish(buffer, true, null);
      return;
    }
    finish(buffer, true, null);
  } catch (error) {
    finish(buffer, false, {
      message: typeof error === "object" && error && "message" in error
        ? String(error.message)
        : error instanceof Error ? error.message : "MySQL request failed.",
      code: typeof error === "object" && error && "code" in error ? String(error.code) : "MYSQL_ERROR",
    });
  }
});
`;

export type DatabaseStatement = {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number; lastInsertRowid?: number };
};

export type OperationalDatabase = {
  prepare(sql: string): DatabaseStatement;
  exec(sql: string): unknown;
  pragma(source: string): unknown;
  transaction<TArgs extends unknown[], TResult>(callback: (...args: TArgs) => TResult): (...args: TArgs) => TResult;
};

function mysqlSyntax(source: string) {
  return source
    .replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, "INSERT IGNORE INTO")
    .replace(/INSERT\s+OR\s+REPLACE\s+INTO/gi, "REPLACE INTO")
    .replace(/ON\s+CONFLICT\s*\([^)]+\)\s+DO\s+UPDATE\s+SET/gi, "ON DUPLICATE KEY UPDATE")
    .replace(/\bexcluded\.([a-z_][a-z0-9_]*)/gi, "VALUES($1)")
    .replace(/date\s*\(\s*'now'\s*\)/gi, "CURRENT_DATE");
}

function positionalParameters(sql: string, input: unknown[]) {
  if (input.length !== 1 || !input[0] || Array.isArray(input[0]) || typeof input[0] !== "object") return { sql, params: input };
  const record = input[0] as Record<string, unknown>;
  const params: unknown[] = [];
  const rewritten = sql.replace(/@([a-z_][a-z0-9_]*)/gi, (_, key: string) => {
    params.push(record[key]);
    return "?";
  });
  return { sql: rewritten, params };
}

export class MysqlSyncDatabase implements OperationalDatabase {
  private worker: Worker;

  constructor() {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required when DATABASE_PROVIDER=mysql.");
    // The void expression keeps the statically imported production dependency
    // in Next's server trace; the evaluated worker uses the resolved absolute
    // path because its own module-resolution base is Hostinger's worker shim.
    void mysqlDriver;
    // Webpack rewrites `require.resolve()` (and createRequire().resolve()) to
    // its numeric module id. Resolve through Node's runtime require so the
    // evaluated worker receives an absolute filename instead.
    const nodeRequire = eval("require") as { resolve(moduleName: string): string };
    const mysqlModulePath = nodeRequire.resolve("mysql2/promise");
    this.worker = new Worker(MYSQL_WORKER_SOURCE, { eval: true, workerData: { mysqlModulePath } });
    this.worker.unref();
  }

  private request(operation: QueryOperation, sql = "", params: QueryParameters = []) {
    const buffer = new SharedArrayBuffer(4 * 1024 * 1024);
    const control = new Int32Array(buffer, 0, 4);
    this.worker.postMessage({ buffer, operation, sql, params });
    const wait = Atomics.wait(control, 0, 0, 30_000);
    if (wait === "timed-out") throw new Error("MySQL request timed out after 30 seconds.");
    const length = Atomics.load(control, 1);
    const ok = Atomics.load(control, 2) === 1;
    const text = new TextDecoder().decode(new Uint8Array(buffer, 16, length));
    const result = text ? JSON.parse(text) as unknown : null;
    if (!ok) {
      const failure = result as { message?: string; code?: string } | null;
      throw Object.assign(new Error(failure?.message || "MySQL request failed."), { code: failure?.code || "MYSQL_ERROR" });
    }
    return result;
  }

  prepare(source: string): DatabaseStatement {
    const initial = mysqlSyntax(source);
    const invoke = (operation: "get" | "all" | "run", values: unknown[]) => {
      const { sql, params } = positionalParameters(initial, values);
      return this.request(operation, sql, params);
    };
    return {
      get: (...params) => invoke("get", params),
      all: (...params) => invoke("all", params) as unknown[],
      run: (...params) => invoke("run", params) as { changes: number; lastInsertRowid?: number },
    };
  }

  exec(sql: string) { return this.request("exec", mysqlSyntax(sql)); }
  pragma() { return undefined; }

  transaction<TArgs extends unknown[], TResult>(callback: (...args: TArgs) => TResult) {
    return (...args: TArgs) => {
      this.request("begin");
      try {
        const result = callback(...args);
        this.request("commit");
        return result;
      } catch (error) {
        this.request("rollback");
        throw error;
      }
    };
  }
}
