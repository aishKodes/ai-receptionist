import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const source = path.resolve("db/mysql-worker.mjs");
const destination = path.resolve(".next/db/mysql-worker.mjs");

if (!existsSync(source)) throw new Error(`MySQL worker source is missing: ${source}`);
mkdirSync(path.dirname(destination), { recursive: true });
copyFileSync(source, destination);
