import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDatabase, makeId, nowIso } from "@/db";
import { processIncomingMessage } from "@/lib/channels/pipeline";
import { verifyMetaSignature } from "@/lib/channels/whatsapp-cloud";
import { addAudit, addEvent, addMessage, applyHumanLock, ensurePatientForChannel, setSettings } from "@/lib/services/repository";

export function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token && token === process.env.WHATSAPP_VERIFY_TOKEN) return new NextResponse(challenge || "", { status: 200 });
  return new NextResponse("Verification failed", { status: 403 });
}

type MetaMessage = {
  id?: string; from?: string; to?: string; recipient_id?: string; timestamp?: string; type?: string;
  text?: { body?: string }; image?: { id?: string; mime_type?: string; caption?: string };
  video?: { id?: string; mime_type?: string; caption?: string }; audio?: { id?: string; mime_type?: string };
  document?: { id?: string; mime_type?: string; filename?: string; caption?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
};
type MetaStatus = { id?: string; status?: string; timestamp?: string; errors?: Array<{ code?: number; title?: string }> };
type MetaValue = { contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>; messages?: MetaMessage[]; message_echoes?: MetaMessage[]; statuses?: MetaStatus[] };
type WhatsAppPayload = { entry?: Array<{ id?: string; changes?: Array<{ field?: string; value?: MetaValue }> }> };

function claimWebhookEvent(externalId: string, eventType: string, raw: string) {
  const result = getDatabase().prepare("INSERT OR IGNORE INTO webhook_events (id,external_id,event_type,payload_hash,status,created_at) VALUES (?,?,?,?,?,?)").run(makeId("webhook"), externalId, eventType, crypto.createHash("sha256").update(raw).digest("hex"), "PROCESSING", nowIso());
  return Boolean(result.changes);
}

function finishWebhookEvent(externalId: string) {
  getDatabase().prepare("UPDATE webhook_events SET status='PROCESSED',processed_at=? WHERE external_id=?").run(nowIso(), externalId);
}

function messageText(message: MetaMessage) {
  return message.text?.body || message.image?.caption || message.video?.caption || message.document?.caption || message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || "";
}

function storeStaffEcho(message: MetaMessage, contactPhone?: string) {
  const recipient = message.to || message.recipient_id || contactPhone;
  if (!message.id || !recipient) return false;
  const digits = recipient.replace(/\D/g, "");
  if (!digits) return false;
  const context = ensurePatientForChannel({ phone: digits.startsWith("91") ? `+${digits}` : `+91${digits}`, whatsappId: digits, channel: "whatsapp" });
  const patientId = String(context.patient.id);
  const conversationId = String(context.conversation.id);
  const media = message.image || message.video || message.audio || message.document;
  addMessage({
    patientId,
    conversationId,
    direction: "outbound",
    senderType: "human",
    messageType: message.type || "text",
    content: messageText(message) || `[${message.type || "message"} sent by reception]`,
    mediaUrl: media?.id ? `meta-media://${media.id}` : null,
    externalMessageId: message.id,
    createdAt: message.timestamp ? new Date(Number(message.timestamp) * 1000).toISOString() : undefined,
    deliveryStatus: "sent",
    metadata: { channel: "whatsapp", source: "smb_message_echoes", mimeType: media?.mime_type || null },
  });
  const lock = applyHumanLock(patientId, "RECEPTION");
  addEvent(patientId, conversationId, "STAFF_WHATSAPP_ECHO", "Reception replied in WhatsApp Business", `AI paused for ${lock.minutes} minutes.`);
  return true;
}

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"))) return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
  try {
    const body = JSON.parse(raw) as WhatsAppPayload;
    let processed = 0;
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value;
        const field = change.field || "messages";
        const contact = value?.contacts?.[0];
        if (["smb_message_echoes", "history", "smb_app_state_sync"].includes(field)) {
          setSettings({ metaCoexistenceDetected: "true", metaLastCoexistenceEventAt: nowIso(), metaLastCoexistenceField: field });
        }
        if (field === "smb_message_echoes") {
          const echoes = value?.message_echoes || value?.messages || [];
          for (const echo of echoes) {
            if (!echo.id) continue;
            const externalEventId = `echo:${echo.id}`;
            if (!claimWebhookEvent(externalEventId, field, raw)) continue;
            try {
              if (storeStaffEcho(echo, contact?.wa_id)) processed += 1;
              finishWebhookEvent(externalEventId);
            } catch (error) {
              getDatabase().prepare("UPDATE webhook_events SET status='FAILED',error=?,processed_at=? WHERE external_id=?").run(error instanceof Error ? error.message.slice(0, 500) : "Staff echo failed", nowIso(), externalEventId);
              throw error;
            }
          }
          if (!echoes.length) addAudit("META_COEXISTENCE_EVENT", "whatsapp_business_account", entry.id || null, "Coexistence echo event received without message data", "SYSTEM", { field });
          continue;
        }
        if (field === "history" || field === "smb_app_state_sync") {
          const externalEventId = `${field}:${crypto.createHash("sha256").update(raw).digest("hex").slice(0, 24)}`;
          if (claimWebhookEvent(externalEventId, field, raw)) {
            addAudit("META_COEXISTENCE_EVENT", "whatsapp_business_account", entry.id || null, `Meta ${field} event processed`, "SYSTEM", { field });
            finishWebhookEvent(externalEventId);
            processed += 1;
          }
          continue;
        }
        for (const status of value?.statuses || []) {
          if (!status.id || !status.status) continue;
          const externalEventId = `status:${status.id}:${status.status}:${status.timestamp || ""}`;
          if (!claimWebhookEvent(externalEventId, "status", raw)) continue;
          const normalizedStatus = status.status.toUpperCase();
          const db = getDatabase();
          db.prepare("UPDATE messages SET delivery_status=? WHERE external_message_id=?").run(normalizedStatus.toLowerCase(), status.id);
          db.prepare("UPDATE outbound_messages SET status=?,error=?,delivered_at=CASE WHEN ?='DELIVERED' THEN ? ELSE delivered_at END,read_at=CASE WHEN ?='READ' THEN ? ELSE read_at END,failed_at=CASE WHEN ?='FAILED' THEN ? ELSE failed_at END,failure_code=CASE WHEN ?='FAILED' THEN ? ELSE failure_code END,failure_message=CASE WHEN ?='FAILED' THEN ? ELSE failure_message END WHERE external_message_id=?").run(normalizedStatus === "FAILED" ? "FAILED" : normalizedStatus, status.errors?.[0]?.title || null, normalizedStatus, nowIso(), normalizedStatus, nowIso(), normalizedStatus, nowIso(), normalizedStatus, status.errors?.[0]?.code || null, normalizedStatus, status.errors?.[0]?.title || null, status.id);
          if (normalizedStatus === "FAILED") addAudit("META_ERROR", "outbound_message", status.id, "WhatsApp delivery failed", "SYSTEM", { code: status.errors?.[0]?.code || null });
          finishWebhookEvent(externalEventId);
          processed += 1;
        }
        for (const message of value?.messages || []) {
          if (!message.id || !message.from) continue;
          const externalEventId = `message:${message.id}`;
          if (!claimWebhookEvent(externalEventId, "message", raw)) continue;
          const media = message.image || message.video || message.audio || message.document;
          const text = messageText(message);
          await processIncomingMessage({
            channel: "whatsapp", externalMessageId: message.id, from: message.from,
            profileName: contact?.profile?.name, messageType: (message.type || "text") as "text" | "image" | "video" | "audio" | "document" | "interactive",
            text, mediaId: media?.id, mediaMimeType: media?.mime_type,
            timestamp: message.timestamp ? new Date(Number(message.timestamp) * 1000).toISOString() : undefined,
          });
          finishWebhookEvent(externalEventId);
          processed += 1;
        }
      }
    }
    return NextResponse.json({ ok: true, processed });
  } catch (error) {
    console.error(`[WHATSAPP] webhook processing failed: ${error instanceof Error ? error.name : "unknown"}`);
    return NextResponse.json({ error: "Webhook could not be processed" }, { status: 400 });
  }
}
