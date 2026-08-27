import { format, parseISO } from "date-fns";
import { getSqlite, nowIso } from "@/db";
import { addEvent, addMessage, getPatientContext, updatePatient } from "@/lib/services/repository";

type Job = { id: string; patientId: string; conversationId: string; appointmentId: string | null; jobType: string; scheduledFor: string; payloadJson: string };

function reminderCopy(job: Job) {
  const context = getPatientContext(job.patientId);
  const firstName = String(context?.patient.name || "there").split(" ")[0];
  const payload = JSON.parse(job.payloadJson || "{}") as { appointmentTime?: string };
  const time = payload.appointmentTime ? format(parseISO(payload.appointmentTime), "EEEE, d MMM 'at' h:mm a") : "your scheduled time";
  if (job.jobType === "NO_SHOW_RECOVERY") return `Hi ${firstName}, we noticed you couldn’t make it to your consultation at Radiance Clinics. If you’d still like to meet the team, I can help you find another convenient time.`;
  if (job.jobType === "APPOINTMENT_REMINDER_2") return `Hi ${firstName} 👋 One more reminder that your consultation at Radiance Clinics, Bhubaneswar is scheduled for ${time}. Reply here if you need any help with the timing.`;
  return `Hi ${firstName} 👋 A quick reminder about your consultation at Radiance Clinics, Bhubaneswar. Your appointment is confirmed for ${time}. If you need to change the time, just reply here and I’ll help.`;
}

export function processDueJobsOnce(limit = 10) {
  const db = getSqlite();
  const due = db.prepare("SELECT id,patient_id AS patientId,conversation_id AS conversationId,appointment_id AS appointmentId,job_type AS jobType,scheduled_for AS scheduledFor,payload_json AS payloadJson FROM scheduled_jobs WHERE status='pending' AND scheduled_for <= ? ORDER BY scheduled_for ASC LIMIT ?").all(nowIso(), limit) as Job[];
  let completed = 0;
  for (const job of due) {
    const claimed = db.prepare("UPDATE scheduled_jobs SET status='processing' WHERE id=? AND status='pending'").run(job.id);
    if (!claimed.changes) continue;
    try {
      const copy = reminderCopy(job);
      addMessage({ patientId: job.patientId, conversationId: job.conversationId, direction: "outbound", senderType: "automation", messageType: "system", content: copy, metadata: { jobId: job.id, jobType: job.jobType } });
      addEvent(job.patientId, job.conversationId, job.jobType === "NO_SHOW_RECOVERY" ? "NO_SHOW_RECOVERY_SENT" : "FOLLOWUP_SENT", job.jobType === "NO_SHOW_RECOVERY" ? "No-show recovery sent" : "Appointment reminder sent", job.jobType.replaceAll("_", " "));
      db.prepare("UPDATE scheduled_jobs SET status='completed', executed_at=?, error=NULL WHERE id=?").run(nowIso(), job.id);
      const next = db.prepare("SELECT scheduled_for AS scheduledFor FROM scheduled_jobs WHERE patient_id=? AND status='pending' ORDER BY scheduled_for LIMIT 1").get(job.patientId) as { scheduledFor?: string } | undefined;
      updatePatient(job.patientId, { nextFollowupAt: next?.scheduledFor ?? null });
      console.log(`[SCHEDULE] completed ${job.jobType} job=${job.id}`);
      completed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown worker failure";
      db.prepare("UPDATE scheduled_jobs SET status='failed', executed_at=?, error=? WHERE id=?").run(nowIso(), message.slice(0, 300), job.id);
      console.error(`[SCHEDULE] failed job=${job.id}: ${message}`);
    }
  }
  return { found: due.length, completed };
}
