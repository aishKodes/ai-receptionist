import { format, parseISO } from "date-fns";
import { getDatabase, nowIso } from "@/db";
import { addEvent, addMessage, getPatientContext, updatePatient } from "@/lib/services/repository";
import { deliverStoredMessage } from "@/lib/channels/delivery";
import { getMessageChannel } from "@/lib/channels";

type Job = { id: string; patientId: string; conversationId: string; appointmentId: string | null; jobType: string; scheduledFor: string; payloadJson: string; createdAt: string };

function reminderCopy(job: Job) {
  const context = getPatientContext(job.patientId);
  const candidate = context?.patient.nameVerified ? String(context.patient.name || "").split(" ")[0] : "";
  const firstName = candidate && !/^(?:radiance|clinic|patient|whatsapp|demo|test)$/i.test(candidate) ? candidate : "there";
  const payload = JSON.parse(job.payloadJson || "{}") as { appointmentTime?: string };
  const time = payload.appointmentTime ? format(parseISO(payload.appointmentTime), "EEEE, d MMM 'at' h:mm a") : "your scheduled time";
  if (job.jobType === "NO_SHOW_RECOVERY") return `Hi ${firstName}, we noticed you couldn’t make it to your consultation at Radiance Clinics. If you’d still like to meet the team, I can help you find another convenient time.`;
  if (job.jobType === "APPOINTMENT_REMINDER_2") return `Hi ${firstName} 👋 One more reminder that your consultation at Radiance Clinics, Bhubaneswar is scheduled for ${time}. Reply here if you need any help with the timing.`;
  return `Hi ${firstName} 👋 A quick reminder about your consultation at Radiance Clinics, Bhubaneswar. Your appointment is confirmed for ${time}. If you need to change the time, just reply here and I’ll help.`;
}

export async function processDueJobsOnce(limit = 10) {
  const db = getDatabase();
  const due = db.prepare("SELECT id,patient_id AS patientId,conversation_id AS conversationId,appointment_id AS appointmentId,job_type AS jobType,scheduled_for AS scheduledFor,payload_json AS payloadJson,created_at AS createdAt FROM scheduled_jobs WHERE status='pending' AND scheduled_for <= ? ORDER BY scheduled_for ASC LIMIT ?").all(nowIso(), limit) as Job[];
  let completed = 0;
  for (const job of due) {
    const claimed = db.prepare("UPDATE scheduled_jobs SET status='processing' WHERE id=? AND status='pending'").run(job.id);
    if (!claimed.changes) continue;
    try {
      const eligibility = db.prepare("SELECT p.do_not_contact AS doNotContact,p.whatsapp_opt_in_status AS consent,p.ai_enabled AS patientAi,p.last_inbound_at AS lastInboundAt,p.service_window_expires_at AS serviceWindowExpiresAt,p.phone,p.whatsapp_id AS whatsappId,c.ai_enabled AS conversationAi,c.channel,a.status AS appointmentStatus FROM patients p JOIN conversations c ON c.id=? LEFT JOIN appointments a ON a.id=? WHERE p.id=?").get(job.conversationId, job.appointmentId, job.patientId) as { doNotContact: number; consent: string; patientAi: number; conversationAi: number; appointmentStatus: string | null; lastInboundAt: string | null; serviceWindowExpiresAt: string | null; phone: string; whatsappId: string | null; channel: string } | undefined;
      const appointmentRequired = job.jobType.startsWith("APPOINTMENT_");
      const appointmentOk = !appointmentRequired || eligibility?.appointmentStatus === "confirmed";
      const genericFollowupSuperseded = !appointmentRequired && eligibility?.lastInboundAt && eligibility.lastInboundAt > job.createdAt;
      if (!eligibility || eligibility.doNotContact || !eligibility.patientAi || !eligibility.conversationAi || !appointmentOk || genericFollowupSuperseded) {
        db.prepare("UPDATE scheduled_jobs SET status='cancelled',executed_at=?,error=? WHERE id=?").run(nowIso(), "Eligibility changed before send", job.id);
        continue;
      }
      const copy = reminderCopy(job);
      const channel = getMessageChannel();
      const serviceWindowOpen = Boolean(eligibility.serviceWindowExpiresAt && new Date(eligibility.serviceWindowExpiresAt).getTime() > Date.now());
      if (channel.name === "whatsapp" && !serviceWindowOpen) {
        const templateName = job.jobType === "NO_SHOW_RECOVERY" ? process.env.WHATSAPP_NO_SHOW_TEMPLATE : process.env.WHATSAPP_APPOINTMENT_REMINDER_TEMPLATE;
        if (!templateName || !channel.sendTemplate) throw new Error("An approved WhatsApp utility template is required outside the 24-hour service window.");
        const approved = db.prepare("SELECT language FROM message_templates WHERE meta_template_name=? AND status='APPROVED' AND active=1").get(templateName) as { language?: string } | undefined;
        if (!approved) throw new Error("The configured WhatsApp reminder template is not approved in the synced template library.");
        const recipient = (eligibility.whatsappId || eligibility.phone).replace(/\D/g, "");
        const sent = await channel.sendTemplate({ to: recipient, templateName, language: approved.language || "en_US", variables: [] });
        addMessage({ patientId: job.patientId, conversationId: job.conversationId, direction: "outbound", senderType: "automation", messageType: "template", content: copy, externalMessageId: sent.id, deliveryStatus: sent.status, metadata: { jobId: job.id, jobType: job.jobType, templateName } });
      } else {
        const stored = addMessage({ patientId: job.patientId, conversationId: job.conversationId, direction: "outbound", senderType: "automation", messageType: "system", content: copy, metadata: { jobId: job.id, jobType: job.jobType } });
        const delivery = await deliverStoredMessage(stored.id);
        if (!delivery.ok) throw new Error(delivery.error || "Reminder delivery failed.");
      }
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
