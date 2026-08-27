import "dotenv/config";
import { createSchema } from "@/lib/db/setup";
import { processDueJobsOnce } from "@/lib/scheduling/worker";
import { processOutboundOnce } from "@/lib/outreach/service";

createSchema();
console.log("[WORKER] Radiance follow-up worker online — polling every 2 seconds");
const tick = () => { processDueJobsOnce(); void processOutboundOnce(); };
const timer = setInterval(tick, 2000);
processDueJobsOnce();

process.on("SIGINT", () => { clearInterval(timer); process.exit(0); });
process.on("SIGTERM", () => { clearInterval(timer); process.exit(0); });
