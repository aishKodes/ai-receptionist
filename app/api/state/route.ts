import { NextRequest, NextResponse } from "next/server";
import { getDashboardState } from "@/lib/services/repository";

export const dynamic = "force-dynamic";
export function GET(request: NextRequest) {
  const patientId = request.nextUrl.searchParams.get("patientId");
  return NextResponse.json(getDashboardState(patientId), { headers: { "Cache-Control": "no-store" } });
}
