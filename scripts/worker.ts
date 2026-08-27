import "dotenv/config";
import { createSchema } from "@/lib/db/setup";
import { processDueJobsOnce } from "@/lib/scheduling/worker";

createSchema();
console.log("[WORKER] Radiance follow-up worker online — polling every 2 seconds");
const timer = setInterval(() => processDueJobsOnce(), 2000);
processDueJobsOnce();

process.on("SIGINT", () => { clearInterval(timer); process.exit(0); });
process.on("SIGTERM", () => { clearInterval(timer); process.exit(0); });
