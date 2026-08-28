import "dotenv/config";
import { createSchema, ensureDataDirectory, seedDatabase } from "@/lib/db/setup";
import { databasePath } from "@/db";

ensureDataDirectory();
const seedTest = process.argv.includes("--seed-test") && process.env.RADIANCE_ALLOW_FIXTURES === "true";
const reset = process.argv.includes("--reset-test") && seedTest;
const result = seedTest ? seedDatabase(reset) : createSchema();
console.log(`[SETUP] Database ready: ${databasePath}`);
if (result) console.log(`[SETUP] Test seed status: ${JSON.stringify(result)}`);
