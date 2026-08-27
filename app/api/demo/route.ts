import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { addMinutes } from "date-fns";
import { getSqlite, makeId, nowIso } from "@/db";
import { seedDatabase } from "@/lib/db/setup";
import { processDueJobsOnce } from "@/lib/scheduling/worker";
import { addEvent, addMessage, getPatientContext, setSettings, updatePatient } from "@/lib/services/repository";
import { enforceRateLimit, enforceSameOrigin } from "@/lib/security/http";

const Schema = z.object({ action: z.string(), patientId: z.string().optional(), values: z.record(z.string(), z.string()).optional() });

function createLead(source: string) {
  const db = getSqlite();
  const suffix = Math.floor(Math.random() * 9000 + 1000);
  const patientId = makeId("pat");
  const conversationId = makeId("con");
  const now = nowIso();
  const name = source === "instagram" ? "Meera Demo" : source === "google_ads" ? "Kunal Demo" : source === "website" ? "Ishita Demo" : `Demo Patient ${suffix}`;
  db.prepare("INSERT INTO patients (id,name,phone,lead_score,lead_temperature,lead_stage,source,ai_summary,assigned_to,ai_enabled,created_at,updated_at,last_contact_at) VALUES (?,?,?,10,'COLD','new',?,?,?,1,?,?,?)").run(patientId, name, `+91 80000 ${suffix}`, source, `New ${source.replaceAll("_", " ")} enquiry.`, "AI Reception", now, now, now);
  db.prepare("INSERT INTO conversations (id,patient_id,channel,status,unread_count,ai_enabled,last_message_at,created_at) VALUES (?,?,'local_demo','open',1,1,?,?)").run(conversationId, patientId, now, now);
  addMessage({ patientId, conversationId, direction: "inbound", senderType: "patient", content: "Hi, I’d like to know more about a consultation." });
  addEvent(patientId, conversationId, "MESSAGE_RECEIVED", `New ${source.replaceAll("_", " ")} lead`, "Simulated from Demo Control.");
  return patientId;
}

export async function POST(request: NextRequest) {
  try {
    enforceSameOrigin(request); enforceRateLimit(request, "demo", 60);
    const { action, patientId = "pat_rahul", values } = Schema.parse(await request.json());
    if (action === "reset") return NextResponse.json({ ok: true, result: seedDatabase(true) });
    if (action === "settings" && values) { setSettings(values); return NextResponse.json({ ok: true }); }
    if (action === "fresh_patient") return NextResponse.json({ ok: true, patientId: createLead("demo") });
    if (action.startsWith("source_")) return NextResponse.json({ ok: true, patientId: createLead(action.replace("source_", "")) });
    const context = getPatientContext(patientId);
    if (!context) return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    const conversationId = String(context.conversation.id);
    if (action === "trigger_reminder") {
      const appointment = context.appointment;
      const db = getSqlite();
      db.prepare("INSERT INTO scheduled_jobs (id,patient_id,conversation_id,appointment_id,job_type,scheduled_for,status,payload_json,created_at) VALUES (?,?,?,?,? ,?,'pending',?,?)").run(makeId("job"), patientId, conversationId, appointment?.id ?? null, "APPOINTMENT_REMINDER_1", nowIso(), JSON.stringify({ appointmentTime: appointment?.dateTime }), nowIso());
      processDueJobsOnce();
    } else if (action === "no_show") {
      getSqlite().prepare("UPDATE appointments SET status='no_show',updated_at=? WHERE patient_id=? AND status='confirmed'").run(nowIso(), patientId);
      updatePatient(patientId, { leadStage: "follow_up" });
      addEvent(patientId, conversationId, "APPOINTMENT_NO_SHOW", "Appointment marked no-show", "Recovery is ready to trigger.");
    } else if (action === "no_show_recovery") {
      getSqlite().prepare("INSERT INTO scheduled_jobs (id,patient_id,conversation_id,appointment_id,job_type,scheduled_for,status,payload_json,created_at) VALUES (?,?,?,?,? ,?,'pending','{}',?)").run(makeId("job"), patientId, conversationId, context.appointment?.id ?? null, "NO_SHOW_RECOVERY", nowIso(), nowIso());
      processDueJobsOnce();
    } else if (action === "escalation") {
      updatePatient(patientId, { aiEnabled: false, assignedTo: "Front Desk", leadStage: "human_required" });
      getSqlite().prepare("UPDATE conversations SET ai_enabled=0 WHERE id=?").run(conversationId);
      addEvent(patientId, conversationId, "HUMAN_ESCALATION", "Human attention required", "Simulated from Demo Control.");
      addMessage({ patientId, conversationId, direction: "outbound", senderType: "system", messageType: "system", content: "Reception attention requested from Demo Control." });
    } else if (action === "followup_due") {
      updatePatient(patientId, { nextFollowupAt: addMinutes(new Date(), 1).toISOString() });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Demo action failed" }, { status: 400 });
  }
}
