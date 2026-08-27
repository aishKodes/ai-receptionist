import { NextResponse } from "next/server";
import { getProvider } from "@/lib/ai/provider-factory";

export async function POST() {
  try { return NextResponse.json(await getProvider().healthCheck()); }
  catch (error) { return NextResponse.json({ connected: false, message: error instanceof Error ? error.message : "Connection failed" }, { status: 503 }); }
}
