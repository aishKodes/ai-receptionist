import "dotenv/config";
import { createSchema } from "@/lib/db/setup";
import { processDueJobsOnce } from "@/lib/scheduling/worker";
import { processOutboundOnce } from "@/lib/outreach/service";

createSchema();
console.log("[WORKER] Radiance follow-up worker online — polling every 2 seconds");
let ticking = false;
const tick = async () => {
  if (ticking) return;
  ticking = true;
  try { await processDueJobsOnce(); await processOutboundOnce(); }
  finally { ticking = false; }
};
const timer = setInterval(tick, 2000);
void tick();

process.on("SIGINT", () => { clearInterval(timer); process.exit(0); });
process.on("SIGTERM", () => { clearInterval(timer); process.exit(0); });
