import { NextResponse } from "next/server";
import { getDatabase } from "@/db";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    getDatabase().prepare("SELECT 1").get();
    return NextResponse.json({
      status: "ok",
      database: "ok",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // Keep the public response intentionally non-specific, but make a
    // managed-host runtime failure diagnosable in the private server log.
    const details = error instanceof Error ? { message: error.message, code: (error as Error & { code?: string }).code } : { message: "Unknown database error" };
    console.error("[Radiance health] database unavailable", details);
    return NextResponse.json({ status: "degraded", database: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
