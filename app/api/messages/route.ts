import { NextRequest, NextResponse } from "next/server";
import { IncomingMessageSchema } from "@/lib/ai/schemas";
import { processPatientMessage } from "@/lib/ai/orchestrator";
import { addEvent, addMessage, getPatientContext } from "@/lib/services/repository";

export async function POST(request: NextRequest) {
  try {
    const input = IncomingMessageSchema.parse(await request.json());
    if (input.senderType === "human") {
      const context = getPatientContext(input.patientId);
      if (!context) return NextResponse.json({ error: "Patient not found" }, { status: 404 });
      addMessage({ patientId: input.patientId, conversationId: String(context.conversation.id), direction: "outbound", senderType: "human", content: input.content });
      addEvent(input.patientId, String(context.conversation.id), "HUMAN_REPLY_SENT", "Receptionist replied", input.content.slice(0, 160));
      return NextResponse.json({ ok: true, mode: "human" });
    }
    const result = await processPatientMessage(input.patientId, input.content);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send message";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
