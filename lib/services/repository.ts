import { format, parseISO } from "date-fns";
import { getDatabase, makeId, nowIso } from "@/db";
import { createSchema } from "@/lib/db/setup";
import { estimateModelCostUsd } from "@/lib/ai/cost";

let initialized = false;
export function ready() {
  if (!initialized && process.env.DATABASE_PROVIDER !== "mysql") createSchema();
  initialized = true;
  return getDatabase();
}

export function addEvent(patientId: string, conversationId: string | null, eventType: string, title: string, details?: string | null, metadata: Record<string, unknown> = {}) {
  const db = ready();
  const event = { id: makeId("evt"), patientId, conversationId, eventType, title, details: details ?? null, metadataJson: JSON.stringify(metadata), createdAt: nowIso() };
  db.prepare("INSERT INTO ai_events (id,patient_id,conversation_id,event_type,title,details,metadata_json,created_at) VALUES (@id,@patientId,@conversationId,@eventType,@title,@details,@metadataJson,@createdAt)").run(event);
  return event;
}

export function addMessage(args: { patientId: string; conversationId: string; direction: "inbound" | "outbound"; senderType: string; content: string; messageType?: string; contentItemId?: string | null; mediaUrl?: string | null; metadata?: Record<string, unknown>; createdAt?: string; externalMessageId?: string | null; deliveryStatus?: string }) {
  const db = ready();
  const message = { id: makeId("msg"), ...args, messageType: args.messageType ?? "text", contentItemId: args.contentItemId ?? null, mediaUrl: args.mediaUrl ?? null, externalMessageId: args.externalMessageId ?? null, metadataJson: JSON.stringify(args.metadata ?? {}), deliveryStatus: args.deliveryStatus ?? "delivered", createdAt: args.createdAt ?? nowIso() };
  db.prepare("INSERT INTO messages (id,conversation_id,patient_id,direction,sender_type,message_type,content,media_url,content_item_id,delivery_status,metadata_json,external_message_id,created_at) VALUES (@id,@conversationId,@patientId,@direction,@senderType,@messageType,@content,@mediaUrl,@contentItemId,@deliveryStatus,@metadataJson,@externalMessageId,@createdAt)").run(message);
  db.prepare("UPDATE conversations SET last_message_at = ?, unread_count = unread_count + ? WHERE id = ?").run(message.createdAt, args.direction === "inbound" ? 1 : 0, args.conversationId);
  const directionColumn = args.direction === "inbound" ? "last_inbound_at" : "last_outbound_at";
  const serviceWindow = args.direction === "inbound" ? new Date(new Date(message.createdAt).getTime() + 24 * 60 * 60 * 1000).toISOString() : null;
  db.prepare(`UPDATE patients SET last_contact_at = ?, ${directionColumn} = ?, service_window_expires_at = COALESCE(?, service_window_expires_at), updated_at = ? WHERE id = ?`).run(message.createdAt, message.createdAt, serviceWindow, message.createdAt, args.patientId);
  return message;
}

export function getPatientContext(patientId: string) {
  const db = ready();
  const patient = db.prepare(`SELECT id,name,name_source AS nameSource,name_verified AS nameVerified,phone,email,age,gender,primary_concern AS primaryConcern,concern_duration AS concernDuration,treatment_category AS treatmentCategory,treatment_slug AS treatmentSlug,lead_score AS leadScore,lead_temperature AS leadTemperature,lead_stage AS leadStage,source,campaign,ai_summary AS aiSummary,assigned_to AS assignedTo,ai_enabled AS aiEnabled,whatsapp_id AS whatsappId,whatsapp_opt_in_status AS whatsappOptInStatus,whatsapp_opt_in_date AS whatsappOptInDate,whatsapp_opt_in_source AS whatsappOptInSource,do_not_contact AS doNotContact,invalid_phone AS invalidPhone,last_inbound_at AS lastInboundAt,last_outbound_at AS lastOutboundAt,service_window_expires_at AS serviceWindowExpiresAt,created_at AS createdAt,updated_at AS updatedAt,last_contact_at AS lastContactAt,next_followup_at AS nextFollowupAt FROM patients WHERE id = ?`).get(patientId) as Record<string, unknown> | undefined;
  if (!patient) return null;
  const conversation = db.prepare("SELECT id,patient_id AS patientId,channel,status,unread_count AS unreadCount,ai_enabled AS aiEnabled,last_message_at AS lastMessageAt,created_at AS createdAt FROM conversations WHERE patient_id = ? ORDER BY last_message_at DESC LIMIT 1").get(patientId) as Record<string, unknown>;
  const messages = db.prepare("SELECT id,conversation_id AS conversationId,patient_id AS patientId,direction,sender_type AS senderType,message_type AS messageType,content,media_url AS mediaUrl,content_item_id AS contentItemId,delivery_status AS deliveryStatus,metadata_json AS metadataJson,external_message_id AS externalMessageId,created_at AS createdAt FROM messages WHERE conversation_id = ? ORDER BY created_at ASC").all(conversation.id) as Array<Record<string, unknown>>;
  const appointment = db.prepare("SELECT id,patient_id AS patientId,conversation_id AS conversationId,treatment_slug AS treatmentSlug,date_time AS dateTime,status,notes,created_at AS createdAt,updated_at AS updatedAt FROM appointments WHERE patient_id = ? ORDER BY date_time DESC LIMIT 1").get(patientId) as Record<string, unknown> | undefined;
  const state = getConversationState(String(conversation.id));
  return { patient, conversation, messages, appointment: appointment ?? null, state };
}

export function updatePatient(patientId: string, fields: Record<string, unknown>) {
  const allowed: Record<string, string> = { name: "name", nameSource: "name_source", nameVerified: "name_verified", age: "age", gender: "gender", primaryConcern: "primary_concern", concernDuration: "concern_duration", treatmentCategory: "treatment_category", treatmentSlug: "treatment_slug", leadScore: "lead_score", leadTemperature: "lead_temperature", leadStage: "lead_stage", source: "source", aiSummary: "ai_summary", aiEnabled: "ai_enabled", assignedTo: "assigned_to", nextFollowupAt: "next_followup_at", whatsappId: "whatsapp_id", whatsappOptInStatus: "whatsapp_opt_in_status", whatsappOptInDate: "whatsapp_opt_in_date", whatsappOptInSource: "whatsapp_opt_in_source", doNotContact: "do_not_contact", invalidPhone: "invalid_phone", lastInboundAt: "last_inbound_at", lastOutboundAt: "last_outbound_at", serviceWindowExpiresAt: "service_window_expires_at" };
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
  const db = ready();
  const sent = new Set((db.prepare("SELECT content_item_id AS id FROM messages WHERE conversation_id = ? AND content_item_id IS NOT NULL").all(conversationId) as Array<{ id: string }>).map((row) => row.id));
  const candidates = db.prepare("SELECT id,type,title,description,url,thumbnail_url AS thumbnailUrl,treatment_slug AS treatmentSlug,tags_json AS tagsJson,when_to_send AS whenToSend,priority,active,approved_for_ai AS approvedForAi,approved_for_production AS approvedForProduction FROM content_items WHERE active = 1 AND approved_for_ai = 1 AND approved_for_production = 1 AND url NOT LIKE '%example.com%' AND url NOT LIKE '%localhost%' AND url NOT LIKE '%placeholder%' AND url NOT LIKE '%/demo/%' AND (treatment_slug = ? OR treatment_slug IS NULL) ORDER BY priority DESC").all(treatmentSlug) as Array<Record<string, unknown>>;
  const terms = (query || "").toLowerCase().split(/\W+/).filter((term) => term.length > 3 && !["please", "could", "would", "share", "about", "with", "this", "that"].includes(term));
  if (!terms.length) return null;
  return candidates.filter((item) => !sent.has(String(item.id))).map((item): Record<string, unknown> => {
    const tags = JSON.parse(String(item.tagsJson || "[]")) as string[];
    const haystack = `${item.title} ${item.description} ${tags.join(" ")}`.toLowerCase();
    const matches = terms.filter((term) => haystack.includes(term)).length;
    return { ...item, tags, matches, rank: Number(item.priority) + matches * 2 + (item.treatmentSlug === treatmentSlug ? 10 : 0) };
  }).filter((item) => Number(item.matches) >= 2).sort((a, b) => Number(b.rank) - Number(a.rank))[0] ?? null;
}

export function getAvailableSlots(date: string, period?: "morning" | "evening" | null) {
  const db = ready();
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  if (date < today) return [];
  const earliestMinutes = date === today ? Number(parts.hour) * 60 + Number(parts.minute) + 30 : 0;
  const rows = db.prepare(`SELECT s.time FROM available_slots s WHERE s.date = ? AND s.active = 1 AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.status = 'confirmed' AND substr(a.date_time,1,10) = s.date AND substr(a.date_time,12,5) = s.time) ORDER BY s.time`).all(date) as Array<{ time: string }>;
  return rows.map((row) => row.time).filter((time) => { const [hour, minute] = time.split(":").map(Number); return hour * 60 + minute >= earliestMinutes && (period === "evening" ? time >= "16:00" : period === "morning" ? time < "13:00" : true); });
}

export function bookAppointment(patientId: string, conversationId: string, treatmentSlug: string | null, date: string, time: string) {
  const db = ready();
  const result = db.transaction(() => {
    if (!getAvailableSlots(date).includes(time)) throw new Error("That consultation time is no longer available.");
    const id = makeId("apt");
    const dateTime = `${date}T${time}:00+05:30`;
    const now = nowIso();
    db.prepare("UPDATE appointments SET status = 'rescheduled', updated_at = ? WHERE patient_id = ? AND status = 'confirmed'").run(now, patientId);
    db.prepare("UPDATE scheduled_jobs SET status='cancelled', executed_at=? WHERE patient_id=? AND status='pending' AND appointment_id IS NOT NULL").run(now, patientId);
    db.prepare("INSERT INTO appointments (id,patient_id,conversation_id,treatment_slug,date_time,status,notes,created_at,updated_at) VALUES (?,?,?,?,?,'confirmed',?,?,?)").run(id, patientId, conversationId, treatmentSlug, dateTime, "Booked by Radiance AI Reception", now, now);
    return { id, patientId, conversationId, treatmentSlug, dateTime, status: "confirmed" as const };
  })();
  updatePatient(patientId, { leadStage: "booked", leadScore: 95, leadTemperature: "HOT" });
  return result;
}

export function changeAppointment(appointmentId: string, action: "cancel" | "complete" | "no_show") {
  const db = ready();
  const appointment = db.prepare("SELECT id,patient_id AS patientId,conversation_id AS conversationId,treatment_slug AS treatmentSlug,date_time AS dateTime,status FROM appointments WHERE id=?").get(appointmentId) as { id: string; patientId: string; conversationId: string; treatmentSlug: string | null; dateTime: string; status: string } | undefined;
  if (!appointment) throw new Error("Appointment not found.");
  if (action === "cancel") {
    db.transaction(() => {
      db.prepare("UPDATE appointments SET status='cancelled', updated_at=? WHERE id=?").run(nowIso(), appointmentId);
      db.prepare("UPDATE scheduled_jobs SET status='cancelled', executed_at=? WHERE appointment_id=? AND status='pending'").run(nowIso(), appointmentId);
    })();
    updatePatient(appointment.patientId, { leadStage: "follow_up", nextFollowupAt: null });
    return { ...appointment, status: "cancelled" };
  }
  db.prepare("UPDATE appointments SET status=?, updated_at=? WHERE id=?").run(action, nowIso(), appointmentId);
  db.prepare("UPDATE scheduled_jobs SET status='cancelled', executed_at=? WHERE appointment_id=? AND status='pending'").run(nowIso(), appointmentId);
  return { ...appointment, status: action };
}

export function rescheduleAppointment(appointmentId: string, date: string, time: string) {
  const appointment = ready().prepare("SELECT patient_id AS patientId,conversation_id AS conversationId,treatment_slug AS treatmentSlug FROM appointments WHERE id=? AND status='confirmed'").get(appointmentId) as { patientId: string; conversationId: string; treatmentSlug: string | null } | undefined;
  if (!appointment) throw new Error("Confirmed appointment not found.");
  const next = bookAppointment(appointment.patientId, appointment.conversationId, appointment.treatmentSlug, date, time);
  scheduleAppointmentJobs(next);
  return next;
}

export function scheduleAppointmentJobs(appointment: { id: string; patientId: string; conversationId: string; dateTime: string }) {
  const db = ready();
  const now = new Date();
  const firstSeconds = Math.max(0, (parseISO(appointment.dateTime).getTime() - now.getTime()) / 1000 - 86400);
  const secondSeconds = Math.max(0, (parseISO(appointment.dateTime).getTime() - now.getTime()) / 1000 - 10800);
  const insert = db.prepare("INSERT INTO scheduled_jobs (id,patient_id,conversation_id,appointment_id,job_type,scheduled_for,status,payload_json,created_at,executed_at) VALUES (?,?,?,?,?,?,?,?,?,?)");
  const payload = JSON.stringify({ appointmentTime: appointment.dateTime });
  insert.run(makeId("job"), appointment.patientId, appointment.conversationId, appointment.id, "APPOINTMENT_CONFIRMATION", now.toISOString(), "completed", payload, now.toISOString(), now.toISOString());
  insert.run(makeId("job"), appointment.patientId, appointment.conversationId, appointment.id, "APPOINTMENT_REMINDER_1", new Date(now.getTime() + firstSeconds * 1000).toISOString(), "pending", payload, now.toISOString(), null);
  insert.run(makeId("job"), appointment.patientId, appointment.conversationId, appointment.id, "APPOINTMENT_REMINDER_2", new Date(now.getTime() + secondSeconds * 1000).toISOString(), "pending", payload, now.toISOString(), null);
  updatePatient(appointment.patientId, { nextFollowupAt: new Date(now.getTime() + firstSeconds * 1000).toISOString() });
  return { firstSeconds, secondSeconds };
}

export function getSettings() {
  const rows = ready().prepare("SELECT `key` AS settingKey,value FROM settings").all() as Array<{ settingKey: string; value: string }>;
  return Object.fromEntries(rows.map((row) => [row.settingKey, row.value])) as Record<string, string>;
}

export function setSettings(values: Record<string, string>) {
  const stmt = ready().prepare("INSERT OR REPLACE INTO settings (`key`,value,updated_at) VALUES (?,?,?)");
  const tx = ready().transaction(() => Object.entries(values).forEach(([key, value]) => stmt.run(key, value, nowIso())));
  tx();
}

export function getConversationState(conversationId: string) {
  const db = ready();
  const now = nowIso();
  db.prepare("INSERT OR IGNORE INTO conversation_state (conversation_id,offered_slots_json,sent_content_ids_json,created_at,updated_at) VALUES (?,'[]','[]',?,?)").run(conversationId, now, now);
  return db.prepare(`SELECT conversation_id AS conversationId,preferred_language AS preferredLanguage,active_flow AS activeFlow,pending_question AS pendingQuestion,pending_action AS pendingAction,last_assistant_question AS lastAssistantQuestion,requested_date AS requestedDate,requested_time AS requestedTime,requested_day_part AS requestedDayPart,offered_slots_json AS offeredSlotsJson,selected_slot AS selectedSlot,appointment_id AS appointmentId,current_concern AS currentConcern,current_treatment AS currentTreatment,previous_treatment AS previousTreatment,rolling_summary AS rollingSummary,sent_content_ids_json AS sentContentIdsJson,last_content_sent_at AS lastContentSentAt,ai_mode AS aiMode,human_lock_until AS humanLockUntil,conversation_phase AS conversationPhase,readiness_score AS readinessScore,readiness_reason AS readinessReason,primary_objection AS primaryObjection,next_best_action AS nextBestAction,next_action_reason AS nextActionReason,conversion_memory_json AS conversionMemoryJson,created_at AS createdAt,updated_at AS updatedAt FROM conversation_state WHERE conversation_id=?`).get(conversationId) as Record<string, unknown>;
}

export function updateConversationState(conversationId: string, fields: Record<string, unknown>) {
  getConversationState(conversationId);
  const allowed: Record<string, string> = {
    preferredLanguage: "preferred_language", activeFlow: "active_flow", pendingQuestion: "pending_question",
    pendingAction: "pending_action", lastAssistantQuestion: "last_assistant_question", requestedDate: "requested_date",
    requestedTime: "requested_time", requestedDayPart: "requested_day_part", offeredSlotsJson: "offered_slots_json",
    selectedSlot: "selected_slot", appointmentId: "appointment_id", currentConcern: "current_concern",
    currentTreatment: "current_treatment", previousTreatment: "previous_treatment", rollingSummary: "rolling_summary",
    sentContentIdsJson: "sent_content_ids_json", lastContentSentAt: "last_content_sent_at", aiMode: "ai_mode",
    humanLockUntil: "human_lock_until",
    conversationPhase: "conversation_phase", readinessScore: "readiness_score", readinessReason: "readiness_reason",
    primaryObjection: "primary_objection", nextBestAction: "next_best_action", nextActionReason: "next_action_reason",
    conversionMemoryJson: "conversion_memory_json",
  };
  const entries = Object.entries(fields).filter(([key, value]) => key in allowed && value !== undefined);
  if (!entries.length) return getConversationState(conversationId);
  const values = entries.map(([, value]) => typeof value === "boolean" ? Number(value) : value);
  const sets = entries.map(([key]) => `${allowed[key]}=?`).join(",");
  ready().prepare(`UPDATE conversation_state SET ${sets},updated_at=? WHERE conversation_id=?`).run(...values, nowIso(), conversationId);
  return getConversationState(conversationId);
}

export function applyHumanLock(patientId: string, actor: "RECEPTION" | "SYSTEM" = "RECEPTION") {
  const context = getPatientContext(patientId);
  if (!context) throw new Error("Patient not found.");
  const minutes = Math.max(1, Number(getSettings().humanLockMinutes || process.env.HUMAN_LOCK_MINUTES || 30));
  const lockUntil = new Date(Date.now() + minutes * 60_000).toISOString();
  const conversationId = String(context.conversation.id);
  ready().transaction(() => {
    ready().prepare("UPDATE patients SET ai_enabled=0,assigned_to='Front Desk',updated_at=? WHERE id=?").run(nowIso(), patientId);
    ready().prepare("UPDATE conversations SET ai_enabled=0 WHERE id=?").run(conversationId);
    updateConversationState(conversationId, { aiMode: "HUMAN_LOCK", humanLockUntil: lockUntil });
  })();
  addAudit("HUMAN_LOCK_EXTENDED", "conversation", conversationId, `AI paused until ${lockUntil}`, actor, { patientId, minutes });
  return { lockUntil, minutes };
}

export function resolveHumanLockForInbound(patientId: string) {
  const context = getPatientContext(patientId);
  if (!context) throw new Error("Patient not found.");
  const conversationId = String(context.conversation.id);
  const state = context.state as Record<string, unknown>;
  if (state.aiMode !== "HUMAN_LOCK") return { locked: !context.patient.aiEnabled, lockUntil: state.humanLockUntil || null };
  const lockUntil = state.humanLockUntil ? new Date(String(state.humanLockUntil)).getTime() : Number.POSITIVE_INFINITY;
  if (lockUntil > Date.now()) return { locked: true, lockUntil: String(state.humanLockUntil) };
  ready().transaction(() => {
    ready().prepare("UPDATE patients SET ai_enabled=1,assigned_to='AI Reception',updated_at=? WHERE id=?").run(nowIso(), patientId);
    ready().prepare("UPDATE conversations SET ai_enabled=1 WHERE id=?").run(conversationId);
    updateConversationState(conversationId, { aiMode: "AI", humanLockUntil: null });
  })();
  addAudit("HUMAN_LOCK_EXPIRED", "conversation", conversationId, "AI resumed on the next patient message", "SYSTEM", { patientId });
  return { locked: false, lockUntil: null };
}

export function getDashboardState(selectedPatientId?: string | null) {
  const db = ready();
  const patients = db.prepare(`SELECT p.id,p.name,p.phone,p.email,p.age,p.gender,p.primary_concern AS primaryConcern,p.concern_duration AS concernDuration,p.treatment_category AS treatmentCategory,p.treatment_slug AS treatmentSlug,p.lead_score AS leadScore,p.lead_temperature AS leadTemperature,p.lead_stage AS leadStage,p.source,p.campaign,p.ai_summary AS aiSummary,p.assigned_to AS assignedTo,p.ai_enabled AS aiEnabled,p.whatsapp_opt_in_status AS whatsappOptInStatus,p.do_not_contact AS doNotContact,p.invalid_phone AS invalidPhone,p.service_window_expires_at AS serviceWindowExpiresAt,p.created_at AS createdAt,p.last_contact_at AS lastContactAt,p.next_followup_at AS nextFollowupAt,c.id AS conversationId,c.unread_count AS unreadCount,c.last_message_at AS lastMessageAt,(SELECT content FROM messages lm WHERE lm.conversation_id=c.id ORDER BY lm.created_at DESC LIMIT 1) AS lastMessage,(SELECT sender_type FROM messages lm WHERE lm.conversation_id=c.id ORDER BY lm.created_at DESC LIMIT 1) AS lastSender FROM patients p JOIN conversations c ON c.patient_id=p.id ORDER BY c.last_message_at DESC`).all() as Array<Record<string, unknown>>;
  const selectedId = selectedPatientId && patients.some((p) => p.id === selectedPatientId) ? selectedPatientId : String(patients[0]?.id || "");
  const selected = selectedId ? getPatientContext(selectedId) : null;
  const events = db.prepare(`SELECT e.id,e.patient_id AS patientId,e.conversation_id AS conversationId,e.event_type AS eventType,e.title,e.details,e.metadata_json AS metadataJson,e.created_at AS createdAt,p.name AS patientName FROM ai_events e JOIN patients p ON p.id=e.patient_id ${selectedId ? "WHERE e.patient_id = ?" : ""} ORDER BY e.created_at DESC LIMIT 60`).all(...(selectedId ? [selectedId] : [])) as Array<Record<string, unknown>>;
  const appointments = db.prepare("SELECT a.id,a.patient_id AS patientId,a.conversation_id AS conversationId,a.treatment_slug AS treatmentSlug,a.date_time AS dateTime,a.status,a.notes,p.name,p.phone FROM appointments a JOIN patients p ON p.id=a.patient_id ORDER BY a.date_time ASC").all() as Array<Record<string, unknown>>;
  const contents = db.prepare("SELECT id,type,title,description,url,thumbnail_url AS thumbnailUrl,treatment_slug AS treatmentSlug,tags_json AS tagsJson,when_to_send AS whenToSend,priority,active,approved_for_ai AS approvedForAi,approved_for_production AS approvedForProduction,created_at AS createdAt FROM content_items ORDER BY active DESC, priority DESC").all() as Array<Record<string, unknown>>;
  const sentContent = selectedId ? db.prepare("SELECT DISTINCT c.id,c.type,c.title,c.description,c.url,c.treatment_slug AS treatmentSlug FROM content_items c JOIN messages m ON m.content_item_id=c.id WHERE m.patient_id=?").all(selectedId) : [];
  const jobs = db.prepare("SELECT id,patient_id AS patientId,conversation_id AS conversationId,appointment_id AS appointmentId,job_type AS jobType,scheduled_for AS scheduledFor,status,payload_json AS payloadJson,created_at AS createdAt,executed_at AS executedAt,error FROM scheduled_jobs ORDER BY created_at DESC").all() as Array<Record<string, unknown>>;
  const summaryCounts = db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN lead_temperature='HOT' THEN 1 ELSE 0 END) AS hot, SUM(CASE WHEN lead_stage='booked' THEN 1 ELSE 0 END) AS booked, SUM(CASE WHEN ai_enabled=0 THEN 1 ELSE 0 END) AS human FROM patients`).get() as Record<string, number>;
  const sourceCounts = db.prepare("SELECT source, COUNT(*) AS count FROM patients GROUP BY source ORDER BY count DESC").all();
  const stageCounts = db.prepare("SELECT lead_stage AS stage, COUNT(*) AS count FROM patients GROUP BY lead_stage").all();
  const sentFollowups = (db.prepare("SELECT COUNT(*) AS count FROM scheduled_jobs WHERE status='completed' AND job_type != 'APPOINTMENT_CONFIRMATION'").get() as { count: number }).count;
  const humanTasks = db.prepare("SELECT h.id,h.patient_id AS patientId,h.conversation_id AS conversationId,h.type,h.priority,h.status,h.title,h.reason,h.suggested_reply AS suggestedReply,h.assigned_to AS assignedTo,h.due_at AS dueAt,h.resolved_at AS resolvedAt,h.created_at AS createdAt,h.updated_at AS updatedAt,p.name AS patientName FROM human_tasks h JOIN patients p ON p.id=h.patient_id ORDER BY CASE h.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END,h.created_at DESC").all() as Array<Record<string, unknown>>;
  const scoreEvents = selectedId ? db.prepare("SELECT id,previous_score AS previousScore,new_score AS newScore,reason_codes_json AS reasonCodesJson,created_at AS createdAt FROM lead_score_events WHERE patient_id=? ORDER BY created_at DESC").all(selectedId) : [];
  const audit = selectedId ? db.prepare("SELECT id,actor,action,entity_type AS entityType,entity_id AS entityId,summary,metadata_json AS metadataJson,created_at AS createdAt FROM audit_logs WHERE entity_id=? OR json_extract(metadata_json,'$.patientId')=? ORDER BY created_at DESC LIMIT 100").all(selectedId, selectedId) : [];
  const outreachHistory = selectedId ? db.prepare("SELECT o.id,o.campaign_id AS campaignId,o.status,o.rendered_body AS renderedBody,o.scheduled_for AS scheduledFor,o.sent_at AS sentAt,c.name AS campaignName,t.category AS templateCategory FROM outbound_messages o LEFT JOIN campaigns c ON c.id=o.campaign_id LEFT JOIN message_templates t ON t.id=o.template_id WHERE o.patient_id=? ORDER BY o.created_at DESC").all(selectedId) : [];
  const campaigns = db.prepare("SELECT c.id,c.name,c.status,c.scheduled_for AS scheduledFor,c.rate_per_minute AS ratePerMinute,c.created_at AS createdAt,t.name AS templateName,COUNT(o.id) AS total,SUM(CASE WHEN o.status IN ('SENT','DELIVERED','READ','REPLIED') THEN 1 ELSE 0 END) AS sent,SUM(CASE WHEN o.status='DELIVERED' THEN 1 ELSE 0 END) AS delivered,SUM(CASE WHEN o.status='READ' THEN 1 ELSE 0 END) AS `read`,SUM(CASE WHEN o.status='REPLIED' THEN 1 ELSE 0 END) AS replied,SUM(CASE WHEN o.status='FAILED' THEN 1 ELSE 0 END) AS failed FROM campaigns c JOIN message_templates t ON t.id=c.template_id LEFT JOIN outbound_messages o ON o.campaign_id=c.id GROUP BY c.id ORDER BY c.created_at DESC").all();
  const istDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const dayStart = new Date(`${istDay}T00:00:00+05:30`);
  const dayEnd = new Date(dayStart.getTime() + 86400000);
  const providerMetrics = db.prepare("SELECT provider,model,COUNT(*) AS requests,ROUND(AVG(latency_ms)) AS avgLatency,SUM(CASE WHEN status='ERROR' THEN 1 ELSE 0 END) AS errors,SUM(CASE WHEN status='FALLBACK' THEN 1 ELSE 0 END) AS fallbacks,SUM(input_tokens) AS inputTokens,SUM(output_tokens) AS outputTokens,ROUND(SUM(CAST(COALESCE(estimated_cost_usd,'0') AS DECIMAL(18,8))),8) AS estimatedCost FROM provider_usage WHERE created_at>=? AND created_at<? GROUP BY provider,model").all(dayStart.toISOString(), dayEnd.toISOString());
  const funnelCounts = db.prepare(`SELECT
    SUM(CASE WHEN (SELECT COUNT(*) FROM messages m WHERE m.patient_id=p.id AND m.sender_type='patient') >= 2 THEN 1 ELSE 0 END) AS meaningfullyEngaged,
    SUM(CASE WHEN p.treatment_slug IS NOT NULL THEN 1 ELSE 0 END) AS qualified,
    SUM(CASE WHEN cs.readiness_score >= 80 THEN 1 ELSE 0 END) AS highIntent,
    SUM(CASE WHEN cs.conversion_memory_json LIKE '%"appointmentDiscussed":true%' THEN 1 ELSE 0 END) AS consultationDiscussed,
    SUM(CASE WHEN EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id=p.id AND a.status='completed') THEN 1 ELSE 0 END) AS completed,
    SUM(CASE WHEN EXISTS (SELECT 1 FROM human_tasks h WHERE h.patient_id=p.id AND h.type='CALL') THEN 1 ELSE 0 END) AS humanCall
    FROM patients p LEFT JOIN conversations c ON c.patient_id=p.id LEFT JOIN conversation_state cs ON cs.conversation_id=c.id`).get() as Record<string, number>;
  const outreachCounts = db.prepare("SELECT COUNT(*) AS outreachSent,SUM(CASE WHEN status='REPLIED' THEN 1 ELSE 0 END) AS outreachReplies FROM outbound_messages WHERE status IN ('SENT','DELIVERED','READ','REPLIED')").get() as Record<string, number>;
  const aiConversationCount = (db.prepare("SELECT COUNT(DISTINCT conversation_id) AS count FROM messages WHERE sender_type='ai' AND direction='outbound'").get() as { count: number }).count;
  const marketingUsed = (db.prepare("SELECT used FROM marketing_daily_quota WHERE day=?").get(istDay) as { used: number } | undefined)?.used ?? 0;
  const provider = (process.env.AI_PRIMARY_PROVIDER || process.env.AI_PROVIDER || "mock");
  const settings = getSettings();
  return { patients, selected: selected ? { ...selected, events, sentContent, scoreEvents, audit, outreachHistory } : null, appointments, contents, jobs, humanTasks, campaigns, providerMetrics, settings: { ...settings, autoMarketingDailyLimit: process.env.AUTO_MARKETING_DAILY_LIMIT ?? settings.autoMarketingDailyLimit ?? "10", marketingOutreachCooldownDays: process.env.MARKETING_OUTREACH_COOLDOWN_DAYS ?? settings.marketingOutreachCooldownDays ?? "7" }, analytics: { ...summaryCounts, ...funnelCounts, ...outreachCounts, aiConversations: aiConversationCount, marketingUsed, sentFollowups, sourceCounts, stageCounts }, provider, serverTime: nowIso() };
}

export function addAudit(action: string, entityType: string, entityId: string | null, summary: string, actor: "SYSTEM" | "AI" | "RECEPTION" | "ADMIN" = "SYSTEM", metadata: Record<string, unknown> = {}) {
  const record = { id: makeId("aud"), actor, action, entityType, entityId, summary, metadataJson: JSON.stringify(metadata), createdAt: nowIso() };
  ready().prepare("INSERT INTO audit_logs (id,actor,action,entity_type,entity_id,summary,metadata_json,created_at) VALUES (@id,@actor,@action,@entityType,@entityId,@summary,@metadataJson,@createdAt)").run(record);
  return record;
}

export function addLeadScoreEvent(patientId: string, conversationId: string | null, previousScore: number, newScore: number, reasonCodes: string[]) {
  const record = { id: makeId("score"), patientId, conversationId, previousScore, newScore, reasonCodesJson: JSON.stringify(reasonCodes), createdAt: nowIso() };
  ready().prepare("INSERT INTO lead_score_events (id,patient_id,conversation_id,previous_score,new_score,reason_codes_json,created_at) VALUES (@id,@patientId,@conversationId,@previousScore,@newScore,@reasonCodesJson,@createdAt)").run(record);
  return record;
}

export function createHumanTask(args: { patientId: string; conversationId?: string | null; type: string; priority?: "URGENT" | "HIGH" | "NORMAL" | "LOW"; title: string; reason?: string | null; suggestedReply?: string | null; assignedTo?: string | null; dueAt?: string | null }) {
  const db = ready();
  const existing = db.prepare("SELECT id FROM human_tasks WHERE patient_id=? AND type=? AND status IN ('OPEN','ASSIGNED','CONTACTED','SNOOZED') LIMIT 1").get(args.patientId, args.type) as { id: string } | undefined;
  if (existing) return { id: existing.id, duplicate: true };
  const now = nowIso();
  const task = { id: makeId("task"), patientId: args.patientId, conversationId: args.conversationId ?? null, type: args.type, priority: args.priority ?? "NORMAL", status: "OPEN", title: args.title, reason: args.reason ?? null, suggestedReply: args.suggestedReply ?? null, assignedTo: args.assignedTo ?? "Front Desk", dueAt: args.dueAt ?? null, createdAt: now, updatedAt: now };
  db.prepare("INSERT INTO human_tasks (id,patient_id,conversation_id,type,priority,status,title,reason,suggested_reply,assigned_to,due_at,created_at,updated_at) VALUES (@id,@patientId,@conversationId,@type,@priority,@status,@title,@reason,@suggestedReply,@assignedTo,@dueAt,@createdAt,@updatedAt)").run(task);
  addAudit("HUMAN_TASK_CREATED", "human_task", task.id, task.title, "SYSTEM", { patientId: args.patientId, type: args.type });
  return { ...task, duplicate: false };
}

export function updateHumanTask(taskId: string, status: "OPEN" | "ASSIGNED" | "CONTACTED" | "SNOOZED" | "RESOLVED" | "NOT_INTERESTED", assignedTo?: string | null, resolution?: string | null) {
  const now = nowIso();
  const task = ready().prepare("SELECT patient_id AS patientId FROM human_tasks WHERE id=?").get(taskId) as { patientId: string } | undefined;
  const result = ready().prepare("UPDATE human_tasks SET status=?,assigned_to=COALESCE(?,assigned_to),resolved_at=CASE WHEN ? IN ('RESOLVED','NOT_INTERESTED') THEN ? ELSE resolved_at END,resolved_by=CASE WHEN ? IN ('RESOLVED','NOT_INTERESTED') THEN COALESCE(?, 'Front Desk') ELSE resolved_by END,resolution=CASE WHEN ? IN ('RESOLVED','NOT_INTERESTED') THEN COALESCE(?, 'Resolved by reception') ELSE resolution END,updated_at=? WHERE id=?").run(status, assignedTo ?? null, status, now, status, assignedTo ?? null, status, resolution ?? null, now, taskId);
  if (!result.changes) throw new Error("Human task not found.");
  if (status === "NOT_INTERESTED" && task) {
    updatePatient(task.patientId, { leadStage: "not_interested", nextFollowupAt: null });
    ready().prepare("UPDATE outbound_messages SET status='CANCELLED',error='Patient marked not interested' WHERE patient_id=? AND status='QUEUED'").run(task.patientId);
  }
  addAudit("HUMAN_TASK_UPDATED", "human_task", taskId, `Task moved to ${status}`, "RECEPTION");
}

export function recordProviderUsage(args: { patientId?: string | null; conversationId?: string | null; provider: string; model: string; operation: string; status: string; latencyMs: number; inputTokens?: number | null; outputTokens?: number | null; estimatedCostUsd?: number | null; errorCode?: string | null; fallbackReason?: string | null }) {
  const estimatedCost = args.estimatedCostUsd ?? estimateModelCostUsd(args.model, args.inputTokens, args.outputTokens);
  ready().prepare("INSERT INTO provider_usage (id,patient_id,conversation_id,provider,model,operation,status,latency_ms,input_tokens,output_tokens,estimated_cost_usd,error_code,fallback_reason,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(makeId("usage"), args.patientId ?? null, args.conversationId ?? null, args.provider, args.model, args.operation, args.status, args.latencyMs, args.inputTokens ?? null, args.outputTokens ?? null, estimatedCost == null ? null : String(estimatedCost), args.errorCode ?? null, args.fallbackReason ?? null, nowIso());
}

export function ensurePatientForChannel(args: { phone: string; name?: string | null; whatsappId?: string | null; channel: string }) {
  const db = ready();
  let patient = db.prepare("SELECT id FROM patients WHERE phone=? OR whatsapp_id=? LIMIT 1").get(args.phone, args.whatsappId ?? "") as { id: string } | undefined;
  if (!patient) {
    const patientId = makeId("pat");
    const conversationId = makeId("con");
    const now = nowIso();
    db.transaction(() => {
      db.prepare("INSERT INTO patients (id,name,name_source,name_verified,phone,whatsapp_id,source,lead_score,lead_temperature,lead_stage,ai_enabled,assigned_to,created_at,updated_at) VALUES (?,?,'whatsapp_profile',0,?,?,?,10,'COLD','new',1,'AI Reception',?,?)").run(patientId, args.name?.trim() || "New Patient", args.phone, args.whatsappId ?? null, args.channel, now, now);
      db.prepare("INSERT INTO conversations (id,patient_id,channel,status,unread_count,ai_enabled,last_message_at,created_at) VALUES (?,?,?,'open',0,1,?,?)").run(conversationId, patientId, args.channel, now, now);
      db.prepare("INSERT INTO conversation_state (conversation_id,offered_slots_json,sent_content_ids_json,created_at,updated_at) VALUES (?,'[]','[]',?,?)").run(conversationId, now, now);
    })();
    addAudit("PATIENT_CREATED", "patient", patientId, `Patient created from ${args.channel}`, "SYSTEM");
    patient = { id: patientId };
  } else if (args.whatsappId) {
    db.transaction(() => {
      db.prepare("UPDATE patients SET whatsapp_id=COALESCE(whatsapp_id,?),name=CASE WHEN name IN ('New Patient','WhatsApp Patient') AND ? IS NOT NULL THEN ? ELSE name END,name_source=CASE WHEN name IN ('New Patient','WhatsApp Patient') AND ? IS NOT NULL THEN 'whatsapp_profile' ELSE name_source END,updated_at=? WHERE id=?").run(args.whatsappId, args.name?.trim() || null, args.name?.trim() || null, args.name?.trim() || null, nowIso(), patient!.id);
      db.prepare("UPDATE conversations SET channel=? WHERE id=(SELECT id FROM conversations WHERE patient_id=? ORDER BY last_message_at DESC LIMIT 1)").run(args.channel, patient!.id);
    })();
  }
  return getPatientContext(patient.id)!;
}

export function setAiMode(patientId: string, enabled: boolean, actor: "RECEPTION" | "ADMIN" | "SYSTEM" = "RECEPTION") {
  const context = getPatientContext(patientId);
  if (!context) throw new Error("Patient not found.");
  const db = ready();
  db.transaction(() => {
    db.prepare("UPDATE patients SET ai_enabled=?,assigned_to=?,lead_stage=CASE WHEN ?=0 THEN 'human_required' ELSE lead_stage END,updated_at=? WHERE id=?").run(Number(enabled), enabled ? "AI Reception" : "Front Desk", Number(enabled), nowIso(), patientId);
    db.prepare("UPDATE conversations SET ai_enabled=? WHERE patient_id=?").run(Number(enabled), patientId);
    updateConversationState(String(context.conversation.id), { aiMode: enabled ? "AI" : "HUMAN_REVIEW", humanLockUntil: null });
  })();
  addAudit(enabled ? "HUMAN_RESUME" : "HUMAN_TAKEOVER", "patient", patientId, enabled ? "Conversation returned to AI" : "Human takeover enabled", actor);
  addEvent(patientId, String(context.conversation.id), enabled ? "HUMAN_RESUME" : "HUMAN_TAKEOVER", enabled ? "Returned to AI Reception" : "Human takeover enabled");
}

export function timeLabel(dateTime: string) {
  return format(parseISO(dateTime), "EEE, d MMM · h:mm a");
}
