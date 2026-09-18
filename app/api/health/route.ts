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
  } catch {
    return NextResponse.json({ status: "degraded", database: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
