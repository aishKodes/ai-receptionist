import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { processIncomingMessage } from "@/lib/channels/pipeline";
import { enforceRateLimit, enforceSameOrigin } from "@/lib/security/http";
import { getSqlite, nowIso } from "@/db";
import { addAudit, addMessage, getPatientContext } from "@/lib/services/repository";

const Schema = z.object({ patientId: z.string(), text: z.string().min(1).max(2000), type: z.enum(["text", "image", "document", "delivered", "read", "failed", "template_send"]).default("text") });
export async function POST(request: NextRequest) {
  try {
    enforceSameOrigin(request); enforceRateLimit(request, "mock-meta", 30);
    const input = Schema.parse(await request.json());
    if (["delivered", "read", "failed"].includes(input.type)) {
      const context = getPatientContext(input.patientId); if (!context) throw new Error("Patient not found.");
      const message = getSqlite().prepare("SELECT id,external_message_id AS externalMessageId FROM messages WHERE patient_id=? AND direction='outbound' ORDER BY created_at DESC LIMIT 1").get(input.patientId) as { id: string; externalMessageId: string | null } | undefined;
      if (!message) throw new Error("No outbound message is available for a status simulation.");
      getSqlite().prepare("UPDATE messages SET delivery_status=? WHERE id=?").run(input.type, message.id);
      if (message.externalMessageId) getSqlite().prepare("UPDATE outbound_messages SET status=?,delivered_at=CASE WHEN ?='DELIVERED' THEN ? ELSE delivered_at END,read_at=CASE WHEN ?='READ' THEN ? ELSE read_at END,failed_at=CASE WHEN ?='FAILED' THEN ? ELSE failed_at END,failure_message=CASE WHEN ?='FAILED' THEN 'Simulated Meta failure' ELSE failure_message END WHERE external_message_id=?").run(input.type.toUpperCase(), input.type.toUpperCase(), nowIso(), input.type.toUpperCase(), nowIso(), input.type.toUpperCase(), nowIso(), input.type.toUpperCase(), message.externalMessageId);
      addAudit(input.type === "failed" ? "META_ERROR" : "META_STATUS", "message", message.id, `Simulated Meta ${input.type} event`, "SYSTEM");
      return NextResponse.json({ ok: true, simulated: input.type });
    }
    if (input.type === "template_send") {
      const context = getPatientContext(input.patientId); if (!context) throw new Error("Patient not found.");
      addMessage({ patientId: input.patientId, conversationId: String(context.conversation.id), direction: "outbound", senderType: "automation", content: "Hi, this is Radiance Clinics, Bhubaneswar. Reply here if you would like reception assistance. Reply STOP to opt out.", externalMessageId: `mock_meta_${crypto.randomUUID()}`, deliveryStatus: "sent", metadata: { simulatedMeta: true, template: "general_reengagement_v1" } });
      addAudit("OUTREACH_SENT", "patient", input.patientId, "Simulated Meta template sent", "SYSTEM");
      return NextResponse.json({ ok: true, simulated: "template_send" });
    }
    const inboundType = input.type as "text" | "image" | "document";
    const result = await processIncomingMessage({ channel: "mock_meta", patientId: input.patientId, text: input.text, messageType: inboundType, externalMessageId: `mock_${crypto.randomUUID()}`, ...(inboundType !== "text" ? { mediaId: crypto.randomUUID(), mediaMimeType: inboundType === "image" ? "image/jpeg" : "application/pdf" } : {}) });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Mock Meta message failed" }, { status: 400 }); }
}
