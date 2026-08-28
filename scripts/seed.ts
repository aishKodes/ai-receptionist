import "dotenv/config";
import { seedDatabase } from "@/lib/db/setup";

if (process.env.RADIANCE_ALLOW_FIXTURES !== "true") throw new Error("Test fixtures require RADIANCE_ALLOW_FIXTURES=true.");
console.log(`[SEED] ${JSON.stringify(seedDatabase(true))}`);
