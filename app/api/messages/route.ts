import { NextRequest, NextResponse } from "next/server";
import { IncomingMessageSchema } from "@/lib/ai/schemas";
import { processIncomingMessage } from "@/lib/channels/pipeline";
import { deliverStoredMessage } from "@/lib/channels/delivery";
import { addAudit, addEvent, addMessage, getPatientContext } from "@/lib/services/repository";
import { enforceRateLimit, enforceSameOrigin } from "@/lib/security/http";

export async function POST(request: NextRequest) {
  try {
    enforceSameOrigin(request); enforceRateLimit(request, "messages", 90);
    const input = IncomingMessageSchema.parse(await request.json());
    if (input.senderType === "human") {
      const context = getPatientContext(input.patientId);
      if (!context) return NextResponse.json({ error: "Patient not found" }, { status: 404 });
      const message = addMessage({ patientId: input.patientId, conversationId: String(context.conversation.id), direction: "outbound", senderType: "human", content: input.content });
      const delivery = await deliverStoredMessage(message.id);
      if (!delivery.ok) throw new Error(delivery.error || "WhatsApp delivery failed.");
      addEvent(input.patientId, String(context.conversation.id), "HUMAN_REPLY_SENT", "Receptionist replied", input.content.slice(0, 160));
      addAudit("HUMAN_REPLY_SENT", "conversation", String(context.conversation.id), "Receptionist sent a reply", "RECEPTION", { patientId: input.patientId });
      return NextResponse.json({ ok: true, mode: "human", delivery });
    }
    const result = await processIncomingMessage({ channel: "local", patientId: input.patientId, text: input.content, messageType: "text" });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send message";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
