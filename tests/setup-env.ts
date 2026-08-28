import os from "node:os";
import path from "node:path";

process.env.RADIANCE_DB_PATH = path.join(os.tmpdir(), `radiance-ai-test-${process.pid}.db`);
process.env.AI_PROVIDER = "mock";
process.env.HUMAN_LOCK_MINUTES = "30";
