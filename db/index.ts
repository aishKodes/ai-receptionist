import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import type Database from "better-sqlite3";
import * as schema from "./schema";
import { MysqlSyncDatabase, type OperationalDatabase } from "./mysql-sync";

const dataDir = path.join(process.cwd(), "data");
export const databasePath = process.env.RADIANCE_DB_PATH || path.join(dataDir, "radiance.db");

type GlobalWithDb = typeof globalThis & { __radianceSqlite?: Database.Database; __radianceMysql?: MysqlSyncDatabase };

let sqliteConstructor: typeof Database | undefined;
function sqliteDriver() {
  if (!sqliteConstructor) {
    // Do not use a static require here: managed MySQL deployments omit this
    // native dependency entirely and must never try to load it at startup.
    const moduleName = ["better", "sqlite3"].join("-");
    sqliteConstructor = createRequire(path.join(process.cwd(), "radiance-runtime.cjs"))(moduleName) as typeof Database;
  }
  return sqliteConstructor;
}

export function getSqlite() {
  const root = globalThis as GlobalWithDb;
  if (!root.__radianceSqlite) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    root.__radianceSqlite = new (sqliteDriver())(databasePath);
    root.__radianceSqlite.pragma("journal_mode = WAL");
    root.__radianceSqlite.pragma("foreign_keys = ON");
    root.__radianceSqlite.pragma("busy_timeout = 5000");
  }
  return root.__radianceSqlite;
}

export function getDb() {
  return drizzle(getSqlite(), { schema });
}

function usesMysql() {
  if (process.env.DATABASE_PROVIDER === "sqlite") return false;
  return process.env.DATABASE_PROVIDER === "mysql" || process.env.RADIANCE_BUILD_DATABASE_PROVIDER === "mysql";
}

export function getDatabase(): OperationalDatabase {
  if (!usesMysql()) return getSqlite() as unknown as OperationalDatabase;
  const root = globalThis as GlobalWithDb;
  if (!root.__radianceMysql) root.__radianceMysql = new MysqlSyncDatabase();
  return root.__radianceMysql;
}

export const nowIso = () => new Date().toISOString();
export const makeId = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
