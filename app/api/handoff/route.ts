import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { addMessage, getPatientContext, setAiMode } from "@/lib/services/repository";
import { enforceRateLimit, enforceSameOrigin } from "@/lib/security/http";

const Schema = z.object({ patientId: z.string(), mode: z.enum(["human", "ai"]) });

export async function POST(request: NextRequest) {
  try {
    enforceSameOrigin(request); enforceRateLimit(request, "handoff", 40);
    const { patientId, mode } = Schema.parse(await request.json());
    const context = getPatientContext(patientId);
    if (!context) return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    const aiEnabled = mode === "ai";
    setAiMode(patientId, aiEnabled);
    addMessage({ patientId, conversationId: String(context.conversation.id), direction: "outbound", senderType: "system", messageType: "system", content: aiEnabled ? "AI reception resumed with conversation context." : "A Radiance receptionist joined the conversation." });
    return NextResponse.json({ ok: true, mode });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Handoff failed" }, { status: 400 });
  }
}
