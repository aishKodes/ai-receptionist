import { getDatabase, nowIso } from "@/db";
import { NormalizedInboundSchema, type NormalizedInbound } from "@/lib/ai/schemas";
import { processPatientMessage } from "@/lib/ai/orchestrator";
import { deliverConversationRepliesAfter, messageCursor } from "@/lib/channels/delivery";
import { addAudit, addEvent, addMessage, createHumanTask, ensurePatientForChannel, getPatientContext, resolveHumanLockForInbound, updatePatient } from "@/lib/services/repository";

const optOutPattern = /^(?:stop|unsubscribe|remove me|don't message me|do not message me|opt out)[.!\s]*$/i;

export function normalizeIndianPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  const local = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits.length === 10 ? digits : "";
  return /^[6-9]\d{9}$/.test(local) ? `+91${local}` : null;
}

export function isOptOut(text: string) { return optOutPattern.test(text.trim()); }

export async function processIncomingMessage(raw: NormalizedInbound) {
  const incoming = NormalizedInboundSchema.parse(raw);
  const db = getDatabase();
  if (incoming.externalMessageId) {
    const duplicate = db.prepare("SELECT id FROM messages WHERE external_message_id=?").get(incoming.externalMessageId);
    if (duplicate) return { duplicate: true, replied: false };
  }
  const context = incoming.patientId
    ? getPatientContext(incoming.patientId)
    : incoming.from
      ? ensurePatientForChannel({ phone: normalizeIndianPhone(incoming.from) || `+${incoming.from.replace(/\D/g, "")}`, name: incoming.profileName, whatsappId: incoming.from, channel: incoming.channel })
      : null;
  if (!context) throw new Error("Patient could not be resolved.");
  const patientId = String(context.patient.id);
  const conversationId = String(context.conversation.id);
  const displayText = incoming.text || `[${incoming.messageType} received]`;
  const inbound = addMessage({ patientId, conversationId, direction: "inbound", senderType: "patient", content: displayText, messageType: incoming.messageType, mediaUrl: incoming.mediaId ? `meta-media://${incoming.mediaId}` : null, externalMessageId: incoming.externalMessageId, metadata: { channel: incoming.channel, mimeType: incoming.mediaMimeType || null } });
  const inboundCursor = messageCursor(inbound.id);
  const finish = async <T extends Record<string, unknown>>(result: T) => {
    const deliveries = await deliverConversationRepliesAfter(conversationId, inboundCursor, incoming.channel);
    return { ...result, deliveries };
  };

  db.prepare("UPDATE outbound_messages SET status='REPLIED',replied_at=? WHERE id=(SELECT id FROM outbound_messages WHERE patient_id=? AND status IN ('SENT','DELIVERED','READ') ORDER BY sent_at DESC LIMIT 1)").run(nowIso(), patientId);
  const humanLock = resolveHumanLockForInbound(patientId);

  if (isOptOut(incoming.text)) {
    const now = nowIso();
    db.transaction(() => {
      db.prepare("UPDATE patients SET do_not_contact=1,whatsapp_opt_in_status='REVOKED',updated_at=? WHERE id=?").run(now, patientId);
      db.prepare("UPDATE outbound_messages SET status='CANCELLED',error='Patient opted out' WHERE patient_id=? AND status='QUEUED'").run(patientId);
    })();
    addEvent(patientId, conversationId, "OPT_OUT", "Patient opted out", "Future automated outreach was stopped.");
    addAudit("OPT_OUT", "patient", patientId, "WhatsApp consent revoked and queued outreach cancelled", "SYSTEM");
    if (!humanLock.locked) addMessage({ patientId, conversationId, direction: "outbound", senderType: "system", content: "You have been opted out of promotional messages from Radiance Clinics. We will not automatically opt you back in. You may contact reception if you wish to give consent again." });
    return finish({ patientId, mode: "opt_out", replied: !humanLock.locked });
  }

  if (humanLock.locked) {
    if (incoming.messageType !== "text" && incoming.messageType !== "interactive") {
      createHumanTask({ patientId, conversationId, type: "DOCTOR_REVIEW", priority: "HIGH", title: `${incoming.messageType} needs staff review`, reason: "Patient media arrived while reception was handling the conversation." });
      addEvent(patientId, conversationId, "MEDIA_RECEIVED", "Patient media queued for review", incoming.messageType);
    }
    addEvent(patientId, conversationId, "AI_SUPPRESSED_HUMAN_LOCK", "AI reply paused", `Reception is handling this conversation until ${humanLock.lockUntil}.`);
    return finish({ patientId, mode: "human_lock", replied: false, lockUntil: humanLock.lockUntil });
  }

  if (incoming.messageType !== "text" && incoming.messageType !== "interactive") {
    createHumanTask({ patientId, conversationId, type: "DOCTOR_REVIEW", priority: "HIGH", title: `${incoming.messageType} needs staff review`, reason: "Patient media must not be automatically diagnosed.", suggestedReply: "Thank you for sharing this. A member of the clinical team will review it; we cannot assess or diagnose it automatically." });
    addMessage({ patientId, conversationId, direction: "outbound", senderType: "ai", content: "Thank you for sharing this. I’m forwarding it for staff review. Images and documents are not assessed or diagnosed automatically." });
    addEvent(patientId, conversationId, "MEDIA_RECEIVED", "Patient media queued for review", incoming.messageType);
    return finish({ patientId, mode: "human_review", replied: true });
  }

  updatePatient(patientId, { lastInboundAt: nowIso(), serviceWindowExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() });
  return finish({ patientId, ...(await processPatientMessage(patientId, incoming.text, { inboundAlreadyStored: true, externalMessageId: incoming.externalMessageId })) });
}
