import { format, parseISO } from "date-fns";
import { getSqlite, makeId, nowIso } from "@/db";
import { createSchema } from "@/lib/db/setup";

let initialized = false;
export function ready() {
  if (!initialized) { createSchema(); initialized = true; }
  return getSqlite();
}

export function addEvent(patientId: string, conversationId: string | null, eventType: string, title: string, details?: string | null, metadata: Record<string, unknown> = {}) {
  const db = ready();
  const event = { id: makeId("evt"), patientId, conversationId, eventType, title, details: details ?? null, metadataJson: JSON.stringify(metadata), createdAt: nowIso() };
  db.prepare("INSERT INTO ai_events (id,patient_id,conversation_id,event_type,title,details,metadata_json,created_at) VALUES (@id,@patientId,@conversationId,@eventType,@title,@details,@metadataJson,@createdAt)").run(event);
  return event;
}

export function addMessage(args: { patientId: string; conversationId: string; direction: "inbound" | "outbound"; senderType: string; content: string; messageType?: string; contentItemId?: string | null; mediaUrl?: string | null; metadata?: Record<string, unknown>; createdAt?: string }) {
  const db = ready();
  const message = { id: makeId("msg"), ...args, messageType: args.messageType ?? "text", contentItemId: args.contentItemId ?? null, mediaUrl: args.mediaUrl ?? null, metadataJson: JSON.stringify(args.metadata ?? {}), deliveryStatus: "delivered", createdAt: args.createdAt ?? nowIso() };
  db.prepare("INSERT INTO messages (id,conversation_id,patient_id,direction,sender_type,message_type,content,media_url,content_item_id,delivery_status,metadata_json,created_at) VALUES (@id,@conversationId,@patientId,@direction,@senderType,@messageType,@content,@mediaUrl,@contentItemId,@deliveryStatus,@metadataJson,@createdAt)").run(message);
  db.prepare("UPDATE conversations SET last_message_at = ?, unread_count = unread_count + ? WHERE id = ?").run(message.createdAt, args.direction === "inbound" ? 1 : 0, args.conversationId);
  db.prepare("UPDATE patients SET last_contact_at = ?, updated_at = ? WHERE id = ?").run(message.createdAt, message.createdAt, args.patientId);
  return message;
}

export function getPatientContext(patientId: string) {
  const db = ready();
  const patient = db.prepare(`SELECT id,name,phone,email,age,gender,primary_concern AS primaryConcern,concern_duration AS concernDuration,treatment_category AS treatmentCategory,treatment_slug AS treatmentSlug,lead_score AS leadScore,lead_temperature AS leadTemperature,lead_stage AS leadStage,source,campaign,ai_summary AS aiSummary,assigned_to AS assignedTo,ai_enabled AS aiEnabled,created_at AS createdAt,updated_at AS updatedAt,last_contact_at AS lastContactAt,next_followup_at AS nextFollowupAt FROM patients WHERE id = ?`).get(patientId) as Record<string, unknown> | undefined;
  if (!patient) return null;
  const conversation = db.prepare("SELECT id,patient_id AS patientId,channel,status,unread_count AS unreadCount,ai_enabled AS aiEnabled,last_message_at AS lastMessageAt,created_at AS createdAt FROM conversations WHERE patient_id = ? ORDER BY last_message_at DESC LIMIT 1").get(patientId) as Record<string, unknown>;
  const messages = db.prepare("SELECT id,conversation_id AS conversationId,patient_id AS patientId,direction,sender_type AS senderType,message_type AS messageType,content,media_url AS mediaUrl,content_item_id AS contentItemId,delivery_status AS deliveryStatus,metadata_json AS metadataJson,created_at AS createdAt FROM messages WHERE conversation_id = ? ORDER BY created_at ASC").all(conversation.id) as Array<Record<string, unknown>>;
  const appointment = db.prepare("SELECT id,patient_id AS patientId,conversation_id AS conversationId,treatment_slug AS treatmentSlug,date_time AS dateTime,status,notes,created_at AS createdAt,updated_at AS updatedAt FROM appointments WHERE patient_id = ? ORDER BY date_time DESC LIMIT 1").get(patientId) as Record<string, unknown> | undefined;
  return { patient, conversation, messages, appointment: appointment ?? null };
}

export function updatePatient(patientId: string, fields: Record<string, unknown>) {
  const allowed: Record<string, string> = { name: "name", age: "age", gender: "gender", primaryConcern: "primary_concern", concernDuration: "concern_duration", treatmentCategory: "treatment_category", treatmentSlug: "treatment_slug", leadScore: "lead_score", leadTemperature: "lead_temperature", leadStage: "lead_stage", source: "source", aiSummary: "ai_summary", aiEnabled: "ai_enabled", assignedTo: "assigned_to", nextFollowupAt: "next_followup_at" };
  const entries = Object.entries(fields).filter(([key, value]) => key in allowed && value !== undefined);
  if (!entries.length) return;
  const values = entries.map(([, value]) => typeof value === "boolean" ? Number(value) : value);
  const sets = entries.map(([key]) => `${allowed[key]} = ?`).join(", ");
  ready().prepare(`UPDATE patients SET ${sets}, updated_at = ? WHERE id = ?`).run(...values, nowIso(), patientId);
}

export function treatmentCategory(slug: string | null) {
  if (!slug) return null;
  return ["hair_loss", "hair_transplant", "prp", "gfc", "beard_transplant", "general_hair"].includes(slug) ? "Hair" : "Skin";
}

export function selectContent(conversationId: string, treatmentSlug: string | null, query: string | null): null | Record<string, unknown> {
  if (!treatmentSlug) return null;
  const db = ready();
  const sent = new Set((db.prepare("SELECT content_item_id AS id FROM messages WHERE conversation_id = ? AND content_item_id IS NOT NULL").all(conversationId) as Array<{ id: string }>).map((row) => row.id));
  const candidates = db.prepare("SELECT id,type,title,description,url,thumbnail_url AS thumbnailUrl,treatment_slug AS treatmentSlug,tags_json AS tagsJson,when_to_send AS whenToSend,priority,active FROM content_items WHERE active = 1 AND (treatment_slug = ? OR treatment_slug IS NULL) ORDER BY priority DESC").all(treatmentSlug) as Array<Record<string, unknown>>;
  const terms = (query || "").toLowerCase().split(/\W+/).filter((term) => term.length > 2);
  return candidates.filter((item) => !sent.has(String(item.id))).map((item): Record<string, unknown> => {
    const tags = JSON.parse(String(item.tagsJson || "[]")) as string[];
    const haystack = `${item.title} ${item.description} ${tags.join(" ")}`.toLowerCase();
    const matches = terms.filter((term) => haystack.includes(term)).length;
    return { ...item, tags, rank: Number(item.priority) + matches * 2 + (item.treatmentSlug === treatmentSlug ? 10 : 0) };
  }).sort((a, b) => Number(b.rank) - Number(a.rank))[0] ?? null;
}

export function getAvailableSlots(date: string, period?: "morning" | "evening" | null) {
  const db = ready();
  const rows = db.prepare(`SELECT s.time FROM available_slots s WHERE s.date = ? AND s.active = 1 AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.status = 'confirmed' AND substr(a.date_time,1,10) = s.date AND substr(a.date_time,12,5) = s.time) ORDER BY s.time`).all(date) as Array<{ time: string }>;
  return rows.map((row) => row.time).filter((time) => period === "evening" ? time >= "16:00" : period === "morning" ? time < "13:00" : true);
}

export function bookAppointment(patientId: string, conversationId: string, treatmentSlug: string | null, date: string, time: string) {
  const db = ready();
  if (!getAvailableSlots(date).includes(time)) throw new Error("That consultation time is no longer available.");
  const id = makeId("apt");
  const dateTime = `${date}T${time}:00+05:30`;
  const now = nowIso();
  db.prepare("UPDATE appointments SET status = 'rescheduled', updated_at = ? WHERE patient_id = ? AND status = 'confirmed'").run(now, patientId);
  db.prepare("INSERT INTO appointments (id,patient_id,conversation_id,treatment_slug,date_time,status,notes,created_at,updated_at) VALUES (?,?,?,?,?,'confirmed',?,?,?)").run(id, patientId, conversationId, treatmentSlug, dateTime, "Booked by Radiance AI Reception", now, now);
  updatePatient(patientId, { leadStage: "booked", leadScore: 95, leadTemperature: "HOT" });
  return { id, patientId, conversationId, treatmentSlug, dateTime, status: "confirmed" };
}

export function scheduleAppointmentJobs(appointment: { id: string; patientId: string; conversationId: string; dateTime: string }) {
  const db = ready();
  const now = new Date();
  const settings = getSettings();
  const demo = settings.demoMode !== "false";
  const firstSeconds = demo ? Number(settings.reminder1Seconds || 45) : Math.max(0, (parseISO(appointment.dateTime).getTime() - now.getTime()) / 1000 - 86400);
  const secondSeconds = demo ? Number(settings.reminder2Seconds || 90) : Math.max(0, (parseISO(appointment.dateTime).getTime() - now.getTime()) / 1000 - 10800);
  const insert = db.prepare("INSERT INTO scheduled_jobs (id,patient_id,conversation_id,appointment_id,job_type,scheduled_for,status,payload_json,created_at,executed_at) VALUES (?,?,?,?,?,?,?,?,?,?)");
  const payload = JSON.stringify({ appointmentTime: appointment.dateTime });
  insert.run(makeId("job"), appointment.patientId, appointment.conversationId, appointment.id, "APPOINTMENT_CONFIRMATION", now.toISOString(), "completed", payload, now.toISOString(), now.toISOString());
  insert.run(makeId("job"), appointment.patientId, appointment.conversationId, appointment.id, "APPOINTMENT_REMINDER_1", new Date(now.getTime() + firstSeconds * 1000).toISOString(), "pending", payload, now.toISOString(), null);
  insert.run(makeId("job"), appointment.patientId, appointment.conversationId, appointment.id, "APPOINTMENT_REMINDER_2", new Date(now.getTime() + secondSeconds * 1000).toISOString(), "pending", payload, now.toISOString(), null);
  updatePatient(appointment.patientId, { nextFollowupAt: new Date(now.getTime() + firstSeconds * 1000).toISOString() });
  return { firstSeconds, secondSeconds };
}

export function getSettings() {
  const rows = ready().prepare("SELECT key,value FROM settings").all() as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.value])) as Record<string, string>;
}

export function setSettings(values: Record<string, string>) {
  const stmt = ready().prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES (?,?,?)");
  const tx = ready().transaction(() => Object.entries(values).forEach(([key, value]) => stmt.run(key, value, nowIso())));
  tx();
}

export function getDashboardState(selectedPatientId?: string | null) {
  const db = ready();
  const patients = db.prepare(`SELECT p.id,p.name,p.phone,p.email,p.age,p.gender,p.primary_concern AS primaryConcern,p.concern_duration AS concernDuration,p.treatment_category AS treatmentCategory,p.treatment_slug AS treatmentSlug,p.lead_score AS leadScore,p.lead_temperature AS leadTemperature,p.lead_stage AS leadStage,p.source,p.ai_summary AS aiSummary,p.assigned_to AS assignedTo,p.ai_enabled AS aiEnabled,p.created_at AS createdAt,p.last_contact_at AS lastContactAt,p.next_followup_at AS nextFollowupAt,c.id AS conversationId,c.unread_count AS unreadCount,c.last_message_at AS lastMessageAt,(SELECT content FROM messages lm WHERE lm.conversation_id=c.id ORDER BY lm.created_at DESC LIMIT 1) AS lastMessage,(SELECT sender_type FROM messages lm WHERE lm.conversation_id=c.id ORDER BY lm.created_at DESC LIMIT 1) AS lastSender FROM patients p JOIN conversations c ON c.patient_id=p.id ORDER BY c.last_message_at DESC`).all() as Array<Record<string, unknown>>;
  const selectedId = selectedPatientId && patients.some((p) => p.id === selectedPatientId) ? selectedPatientId : String(patients[0]?.id || "");
  const selected = selectedId ? getPatientContext(selectedId) : null;
  const events = db.prepare(`SELECT e.id,e.patient_id AS patientId,e.conversation_id AS conversationId,e.event_type AS eventType,e.title,e.details,e.metadata_json AS metadataJson,e.created_at AS createdAt,p.name AS patientName FROM ai_events e JOIN patients p ON p.id=e.patient_id ${selectedId ? "WHERE e.patient_id = ?" : ""} ORDER BY e.created_at DESC LIMIT 60`).all(...(selectedId ? [selectedId] : [])) as Array<Record<string, unknown>>;
  const appointments = db.prepare("SELECT a.id,a.patient_id AS patientId,a.conversation_id AS conversationId,a.treatment_slug AS treatmentSlug,a.date_time AS dateTime,a.status,a.notes,p.name,p.phone FROM appointments a JOIN patients p ON p.id=a.patient_id ORDER BY a.date_time ASC").all() as Array<Record<string, unknown>>;
  const contents = db.prepare("SELECT id,type,title,description,url,thumbnail_url AS thumbnailUrl,treatment_slug AS treatmentSlug,tags_json AS tagsJson,when_to_send AS whenToSend,priority,active,created_at AS createdAt FROM content_items ORDER BY active DESC, priority DESC").all() as Array<Record<string, unknown>>;
  const sentContent = selectedId ? db.prepare("SELECT DISTINCT c.id,c.type,c.title,c.description,c.url,c.treatment_slug AS treatmentSlug FROM content_items c JOIN messages m ON m.content_item_id=c.id WHERE m.patient_id=?").all(selectedId) : [];
  const jobs = db.prepare("SELECT id,patient_id AS patientId,conversation_id AS conversationId,appointment_id AS appointmentId,job_type AS jobType,scheduled_for AS scheduledFor,status,payload_json AS payloadJson,created_at AS createdAt,executed_at AS executedAt,error FROM scheduled_jobs ORDER BY created_at DESC").all() as Array<Record<string, unknown>>;
  const summaryCounts = db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN lead_temperature='HOT' THEN 1 ELSE 0 END) AS hot, SUM(CASE WHEN lead_stage='booked' THEN 1 ELSE 0 END) AS booked, SUM(CASE WHEN ai_enabled=0 THEN 1 ELSE 0 END) AS human FROM patients`).get() as Record<string, number>;
  const sourceCounts = db.prepare("SELECT source, COUNT(*) AS count FROM patients GROUP BY source ORDER BY count DESC").all();
  const stageCounts = db.prepare("SELECT lead_stage AS stage, COUNT(*) AS count FROM patients GROUP BY lead_stage").all();
  const sentFollowups = (db.prepare("SELECT COUNT(*) AS count FROM scheduled_jobs WHERE status='completed' AND job_type != 'APPOINTMENT_CONFIRMATION'").get() as { count: number }).count;
  const provider = (process.env.AI_PROVIDER || "auto");
  return { patients, selected: selected ? { ...selected, events, sentContent } : null, appointments, contents, jobs, settings: getSettings(), analytics: { ...summaryCounts, sentFollowups, sourceCounts, stageCounts }, provider, serverTime: nowIso() };
}

export function timeLabel(dateTime: string) {
  return format(parseISO(dateTime), "EEE, d MMM · h:mm a");
}
