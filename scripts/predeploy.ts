import dotenv from "dotenv";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { productionReadiness } from "@/lib/production/readiness";

dotenv.config({ path: ".env.local", override: false, quiet: true });
dotenv.config({ path: ".env", override: false, quiet: true });

const root = process.cwd();
const run = (script: string) => execFileSync("npm", ["run", script], { cwd: root, stdio: "inherit" });
const fail = (message: string): never => { throw new Error(`[PREDEPLOY] ${message}`); };

function sourceFiles(directory: string): string[] {
  const absolute = path.join(root, directory);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? sourceFiles(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
}

function scanProductionSources() {
  const validatorFiles = new Set(["scripts/predeploy.ts", "lib/services/repository.ts", "lib/testing/local-reception.ts", "app/api/content/route.ts"]);
  const files = ["app", "components", "lib", "db", "data", "migrations", "scripts"].flatMap(sourceFiles).filter((file) => /\.(?:ts|tsx|js|mjs|json|sql)$/.test(file) && !validatorFiles.has(file));
  const forbidden = [/(?:example\.com|localhost(?::\d+)?)/i, /(?:sk-[A-Za-z0-9_-]{12,}|EAA[A-Za-z0-9_-]{20,})/];
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    if (forbidden.some((pattern) => pattern.test(text))) fail(`Production source contains a placeholder URL or secret-like value: ${file}`);
  }
  const content = JSON.parse(fs.readFileSync(path.join(root, "data/radiance-content.json"), "utf8")) as Array<{ url?: string; approvedForProduction?: boolean }>;
  if (content.some((item) => !item.approvedForProduction || !/^https:\/\/(?:www\.youtube\.com\/@RadianceClinics|youtu\.be\/8qYMw935MF8)/i.test(String(item.url)))) fail("Content data contains a non-approved production URL.");
}

function validateEnvironment() {
  const readiness = productionReadiness();
  if (readiness.status !== "PRODUCTION READY") fail(`Production configuration is incomplete: ${readiness.blockers.join("; ")}`);
}

for (const script of ["lint", "typecheck", "test", "test:conversation-quality"]) run(script);
validateEnvironment();
run("db:production-check");
scanProductionSources();
run("build");
console.log("[PREDEPLOY] All production gates passed.");
