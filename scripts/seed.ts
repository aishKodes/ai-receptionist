import "dotenv/config";
import { seedDatabase } from "@/lib/db/setup";

console.log(`[SEED] ${JSON.stringify(seedDatabase(true))}`);
