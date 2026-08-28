import { parentPort } from "node:worker_threads";
import mysql from "mysql2/promise";

if (!parentPort) throw new Error("MySQL worker requires a parent port.");

const connectionPromise = mysql.createConnection({
  uri: process.env.DATABASE_URL,
  multipleStatements: true,
  supportBigNumbers: true,
  bigNumberStrings: false,
  ssl: process.env.DATABASE_SSL === "false"
    ? undefined
    : { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" },
});

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
    const connection = await connectionPromise;
    if (operation === "begin") await connection.beginTransaction();
    else if (operation === "commit") await connection.commit();
    else if (operation === "rollback") await connection.rollback();
    else {
      const [result] = await connection.query(sql, params || []);
      if (operation === "get") finish(buffer, true, Array.isArray(result) ? result[0] ?? null : null);
      else if (operation === "all") finish(buffer, true, Array.isArray(result) ? result : []);
      else if (operation === "run") finish(buffer, true, { changes: Number(result.affectedRows || 0), lastInsertRowid: Number(result.insertId || 0) });
      else finish(buffer, true, null);
      return;
    }
    finish(buffer, true, null);
  } catch (error) {
    finish(buffer, false, {
      message: error instanceof Error ? error.message : "MySQL request failed.",
      code: typeof error === "object" && error && "code" in error ? String(error.code) : "MYSQL_ERROR",
    });
  }
});
