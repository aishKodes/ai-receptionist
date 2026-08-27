import "dotenv/config";
import { ensureDataDirectory, seedDatabase } from "@/lib/db/setup";
import { databasePath } from "@/db";

ensureDataDirectory();
const reset = process.argv.includes("--reset");
const noSeed = process.argv.includes("--no-seed");
const result = noSeed ? (await import("@/lib/db/setup")).createSchema() : seedDatabase(reset);
console.log(`[SETUP] Database ready: ${databasePath}`);
if (result) console.log(`[SETUP] Seed status: ${JSON.stringify(result)}`);
