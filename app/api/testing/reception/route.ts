import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { processIncomingMessage } from "@/lib/channels/pipeline";
import { enforceRateLimit, enforceSameOrigin } from "@/lib/security/http";
import { ensureReceptionTestPatient, localReceptionTestEnabled, resetReceptionTestPatient } from "@/lib/testing/local-reception";
import { getPatientContext } from "@/lib/services/repository";

const MessageSchema = z.object({ message: z.string().trim().min(1).max(1200) });

function unavailable(request: NextRequest) {
  return !localReceptionTestEnabled(request.nextUrl.hostname);
}

export function GET(request: NextRequest) {
  if (unavailable(request)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ context: ensureReceptionTestPatient() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (unavailable(request)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    enforceSameOrigin(request);
    enforceRateLimit(request, "local-reception-test", 40, 60_000);
    const { message } = MessageSchema.parse(await request.json());
    const context = ensureReceptionTestPatient();
    await processIncomingMessage({ channel: "local", patientId: String(context.patient.id), messageType: "text", text: message });
    return NextResponse.json({ context: getPatientContext(String(context.patient.id)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The test message could not be processed." }, { status: 400 });
  }
}

export function DELETE(request: NextRequest) {
  if (unavailable(request)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    enforceSameOrigin(request);
    resetReceptionTestPatient();
    return NextResponse.json({ context: ensureReceptionTestPatient() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The test conversation could not be reset." }, { status: 400 });
  }
}
