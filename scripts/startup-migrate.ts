import { execFileSync } from "node:child_process";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", override: false, quiet: true });
dotenv.config({ path: ".env", override: false, quiet: true });

if (process.env.DATABASE_PROVIDER === "mysql") {
  execFileSync("npm", ["run", "db:mysql:migrate"], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
} else {
  console.log("[STARTUP] MySQL migration skipped for non-MySQL runtime.");
}
