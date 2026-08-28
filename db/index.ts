import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import * as schema from "./schema";
import { MysqlSyncDatabase, type OperationalDatabase } from "./mysql-sync";

const dataDir = path.join(process.cwd(), "data");
export const databasePath = process.env.RADIANCE_DB_PATH || path.join(dataDir, "radiance.db");

type GlobalWithDb = typeof globalThis & { __radianceSqlite?: Database.Database; __radianceMysql?: MysqlSyncDatabase };

export function getSqlite() {
  const root = globalThis as GlobalWithDb;
  if (!root.__radianceSqlite) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    root.__radianceSqlite = new Database(databasePath);
    root.__radianceSqlite.pragma("journal_mode = WAL");
    root.__radianceSqlite.pragma("foreign_keys = ON");
    root.__radianceSqlite.pragma("busy_timeout = 5000");
  }
  return root.__radianceSqlite;
}

export function getDb() {
  return drizzle(getSqlite(), { schema });
}

export function getDatabase(): OperationalDatabase {
  if (process.env.DATABASE_PROVIDER !== "mysql") return getSqlite() as unknown as OperationalDatabase;
  const root = globalThis as GlobalWithDb;
  if (!root.__radianceMysql) root.__radianceMysql = new MysqlSyncDatabase();
  return root.__radianceMysql;
}

export const nowIso = () => new Date().toISOString();
export const makeId = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
