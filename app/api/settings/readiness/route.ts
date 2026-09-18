import { NextResponse } from "next/server";
import { productionReadiness } from "@/lib/production/readiness";

export const dynamic = "force-dynamic";
export function GET() { return NextResponse.json(productionReadiness()); }
