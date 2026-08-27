import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSqlite, makeId, nowIso } from "@/db";
import { processIncomingMessage } from "@/lib/channels/pipeline";
import { verifyMetaSignature } from "@/lib/channels/whatsapp-cloud";
import { addAudit } from "@/lib/services/repository";

export function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token && token === process.env.WHATSAPP_VERIFY_TOKEN) return new NextResponse(challenge || "", { status: 200 });
  return new NextResponse("Verification failed", { status: 403 });
}

type MetaMessage = {
  id?: string; from?: string; timestamp?: string; type?: string;
  text?: { body?: string }; image?: { id?: string; mime_type?: string; caption?: string };
  video?: { id?: string; mime_type?: string; caption?: string }; audio?: { id?: string; mime_type?: string };
  document?: { id?: string; mime_type?: string; filename?: string; caption?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
};
type MetaStatus = { id?: string; status?: string; timestamp?: string; errors?: Array<{ code?: number; title?: string }> };
type WhatsAppPayload = { entry?: Array<{ changes?: Array<{ value?: { contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>; messages?: MetaMessage[]; statuses?: MetaStatus[] } }> }> };

function claimWebhookEvent(externalId: string, eventType: string, raw: string) {
  const result = getSqlite().prepare("INSERT OR IGNORE INTO webhook_events (id,external_id,event_type,payload_hash,status,created_at) VALUES (?,?,?,?,?,?)").run(makeId("webhook"), externalId, eventType, crypto.createHash("sha256").update(raw).digest("hex"), "PROCESSING", nowIso());
  return Boolean(result.changes);
}

function finishWebhookEvent(externalId: string) {
  getSqlite().prepare("UPDATE webhook_events SET status='PROCESSED',processed_at=? WHERE external_id=?").run(nowIso(), externalId);
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
        const contact = value?.contacts?.[0];
        for (const status of value?.statuses || []) {
          if (!status.id || !status.status) continue;
          const externalEventId = `status:${status.id}:${status.status}:${status.timestamp || ""}`;
          if (!claimWebhookEvent(externalEventId, "status", raw)) continue;
          const normalizedStatus = status.status.toUpperCase();
          const db = getSqlite();
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
          const text = message.text?.body || message.image?.caption || message.video?.caption || message.document?.caption || message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || "";
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
