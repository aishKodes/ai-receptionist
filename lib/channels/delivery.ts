import { getDatabase } from "@/db";
import { addAudit } from "@/lib/services/repository";
import { RealWhatsAppCloudChannel } from "./whatsapp-cloud";

type StoredOutboundMessage = {
  id: string;
  conversationId: string;
  patientId: string;
  channel: string;
  phone: string;
  whatsappId: string | null;
  serviceWindowExpiresAt: string | null;
  content: string;
  mediaUrl: string | null;
  externalMessageId: string | null;
};

export type DeliveryResult = {
  ok: boolean;
  skipped?: boolean;
  externalMessageId?: string;
  status: string;
  error?: string;
};

function storedOutboundMessage(messageId: string) {
  return getDatabase().prepare(`
    SELECT m.id,m.conversation_id AS conversationId,m.patient_id AS patientId,
      c.channel,p.phone,p.whatsapp_id AS whatsappId,
      p.service_window_expires_at AS serviceWindowExpiresAt,
      m.content,m.media_url AS mediaUrl,m.external_message_id AS externalMessageId
    FROM messages m
    JOIN conversations c ON c.id=m.conversation_id
    JOIN patients p ON p.id=m.patient_id
    WHERE m.id=? AND m.direction='outbound'
  `).get(messageId) as StoredOutboundMessage | undefined;
}

export async function deliverStoredMessage(messageId: string, channelOverride?: string): Promise<DeliveryResult> {
  const db = getDatabase();
  const message = storedOutboundMessage(messageId);
  if (!message) return { ok: false, status: "missing", error: "Outbound message was not found." };
  if (message.externalMessageId) return { ok: true, skipped: true, externalMessageId: message.externalMessageId, status: "already_sent" };

  const channel = channelOverride || message.channel;
  if (channel !== "whatsapp") return { ok: true, skipped: true, status: "stored_locally" };

  const recipient = (message.whatsappId || message.phone || "").replace(/\D/g, "");
  if (!recipient) return { ok: false, status: "failed", error: "Patient WhatsApp number is missing." };
  if (!message.serviceWindowExpiresAt || new Date(message.serviceWindowExpiresAt).getTime() <= Date.now()) {
    const error = "WhatsApp 24-hour reply window is closed; use an approved template.";
    db.prepare("UPDATE messages SET delivery_status='failed' WHERE id=?").run(message.id);
    addAudit("META_ERROR", "message", message.id, error, "SYSTEM", { patientId: message.patientId });
    return { ok: false, status: "failed", error };
  }

  try {
    const cloud = new RealWhatsAppCloudChannel();
    const sent = message.mediaUrl
      ? await cloud.sendContent({ to: recipient, text: message.content, url: message.mediaUrl })
      : await cloud.sendText({ to: recipient, text: message.content });
    db.prepare("UPDATE messages SET external_message_id=?,delivery_status=? WHERE id=?").run(sent.id, sent.status, message.id);
    addAudit("WHATSAPP_SENT", "message", message.id, "WhatsApp reply accepted by Meta", "SYSTEM", { patientId: message.patientId, externalMessageId: sent.id });
    return { ok: true, externalMessageId: sent.id, status: sent.status };
  } catch (error) {
    const safeError = error instanceof Error ? error.message : "WhatsApp delivery failed.";
    db.prepare("UPDATE messages SET delivery_status='failed' WHERE id=?").run(message.id);
    addAudit("META_ERROR", "message", message.id, safeError, "SYSTEM", { patientId: message.patientId });
    return { ok: false, status: "failed", error: safeError };
  }
}

export async function deliverConversationRepliesAfter(conversationId: string, cursor: { id: string; createdAt: string }, channelOverride?: string) {
  const rows = getDatabase().prepare(`
    SELECT id FROM messages
    WHERE conversation_id=? AND direction='outbound'
      AND (created_at>? OR (created_at=? AND id<>?))
    ORDER BY created_at ASC,id ASC
  `).all(conversationId, cursor.createdAt, cursor.createdAt, cursor.id) as Array<{ id: string }>;
  const deliveries: DeliveryResult[] = [];
  for (const row of rows) deliveries.push(await deliverStoredMessage(row.id, channelOverride));
  return deliveries;
}

export function messageCursor(messageId: string) {
  const row = getDatabase().prepare("SELECT id,created_at AS createdAt FROM messages WHERE id=?").get(messageId) as { id: string; createdAt: string } | undefined;
  if (!row) throw new Error("Message delivery cursor was not found.");
  return row;
}
