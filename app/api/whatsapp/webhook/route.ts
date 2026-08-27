import { NextRequest, NextResponse } from "next/server";
import { getSqlite, makeId, nowIso } from "@/db";
import { processPatientMessage } from "@/lib/ai/orchestrator";
import { addEvent } from "@/lib/services/repository";

export function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token && token === process.env.WHATSAPP_VERIFY_TOKEN) return new NextResponse(challenge || "", { status: 200 });
  return new NextResponse("Verification failed", { status: 403 });
}

type WhatsAppPayload = { entry?: Array<{ changes?: Array<{ value?: { contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>; messages?: Array<{ from?: string; type?: string; text?: { body?: string } }> } }> }> };
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as WhatsAppPayload;
    const value = body.entry?.[0]?.changes?.[0]?.value;
    const incoming = value?.messages?.[0];
    if (!incoming?.from || incoming.type !== "text" || !incoming.text?.body) return NextResponse.json({ ok: true, ignored: true });
    const db = getSqlite();
    let patient = db.prepare("SELECT id FROM patients WHERE replace(replace(replace(phone,' ',''),'+',''),'-','') LIKE ? LIMIT 1").get(`%${incoming.from}`) as { id: string } | undefined;
    if (!patient) {
      const patientId = makeId("pat"); const conversationId = makeId("con"); const now = nowIso(); const name = value?.contacts?.[0]?.profile?.name || "WhatsApp Patient";
      db.prepare("INSERT INTO patients (id,name,phone,lead_score,lead_temperature,lead_stage,source,ai_summary,assigned_to,ai_enabled,created_at,updated_at,last_contact_at) VALUES (?,?,?,10,'COLD','new','whatsapp','New WhatsApp enquiry.','AI Reception',1,?,?,?)").run(patientId, name, `+${incoming.from}`, now, now, now);
      db.prepare("INSERT INTO conversations (id,patient_id,channel,status,unread_count,ai_enabled,last_message_at,created_at) VALUES (?,?,'whatsapp','open',1,1,?,?)").run(conversationId, patientId, now, now);
      patient = { id: patientId };
      addEvent(patientId, conversationId, "CHANNEL_CONNECTED", "WhatsApp patient connected", "Incoming Cloud API webhook.");
    }
    await processPatientMessage(patient.id, incoming.text.body);
    return NextResponse.json({ ok: true });
  } catch (error) { console.error(`[WHATSAPP] webhook error: ${error instanceof Error ? error.message : "unknown"}`); return NextResponse.json({ ok: false }, { status: 500 }); }
}
