import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { processDueJobsOnce } from "@/lib/scheduling/worker";
import { processOutboundOnce } from "@/lib/outreach/service";

function authorized(request: NextRequest) {
  const expected = process.env.CRON_SECRET || "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || request.headers.get("x-cron-secret") || "";
  if (!expected || expected.length < 32 || supplied.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [jobs, outreach] = await Promise.all([processDueJobsOnce(25), processOutboundOnce()]);
  return NextResponse.json({ ok: true, jobs, outreach, processedAt: new Date().toISOString() });
}
