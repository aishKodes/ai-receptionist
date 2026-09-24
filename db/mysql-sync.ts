import path from "node:path";
import fs from "node:fs";
import { Worker } from "node:worker_threads";

type QueryOperation = "get" | "all" | "run" | "exec" | "begin" | "commit" | "rollback";
type QueryParameters = unknown[] | Record<string, unknown>;

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
    const roots = [process.cwd(), path.resolve(process.cwd(), "..")];
    const candidates = roots.flatMap((root) => [
      path.join(root, "db/mysql-worker.mjs"),
      path.join(root, ".next/db/mysql-worker.mjs"),
    ]);
    const workerPath = candidates.find((candidate) => fs.existsSync(candidate));
    if (!workerPath) throw new Error("MySQL worker is unavailable in this deployment. Rebuild the application before enabling MySQL.");
    this.worker = new Worker(workerPath);
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
