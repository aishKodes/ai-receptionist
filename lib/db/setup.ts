import fs from "node:fs";
import path from "node:path";
import { addDays, format, subMinutes } from "date-fns";
import { getSqlite, makeId, nowIso } from "@/db";
import knowledge from "@/data/radiance-knowledge.json";
import content from "@/data/radiance-content.json";

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS patients (id TEXT PRIMARY KEY, name TEXT NOT NULL, name_source TEXT NOT NULL DEFAULT 'whatsapp_profile', name_verified INTEGER NOT NULL DEFAULT 0, phone TEXT NOT NULL UNIQUE, email TEXT, age INTEGER, gender TEXT, primary_concern TEXT, concern_duration TEXT, treatment_category TEXT, treatment_slug TEXT, lead_score INTEGER NOT NULL DEFAULT 10, lead_temperature TEXT NOT NULL DEFAULT 'COLD', lead_stage TEXT NOT NULL DEFAULT 'new', source TEXT NOT NULL DEFAULT 'whatsapp', campaign TEXT, ai_summary TEXT, assigned_to TEXT DEFAULT 'AI Reception', ai_enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT, last_contact_at TEXT, next_followup_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE, channel TEXT NOT NULL DEFAULT 'whatsapp', status TEXT NOT NULL DEFAULT 'open', unread_count INTEGER NOT NULL DEFAULT 0, ai_enabled INTEGER NOT NULL DEFAULT 1, last_message_at TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE, direction TEXT NOT NULL, sender_type TEXT NOT NULL, message_type TEXT NOT NULL DEFAULT 'text', content TEXT NOT NULL, media_url TEXT, content_item_id TEXT, delivery_status TEXT NOT NULL DEFAULT 'delivered', metadata_json TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS conversation_state (conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE, preferred_language TEXT NOT NULL DEFAULT 'AUTO', active_flow TEXT, pending_question TEXT, pending_action TEXT, last_assistant_question TEXT, requested_date TEXT, requested_time TEXT, requested_day_part TEXT, offered_slots_json TEXT NOT NULL DEFAULT '[]', selected_slot TEXT, appointment_id TEXT, current_concern TEXT, current_treatment TEXT, previous_treatment INTEGER NOT NULL DEFAULT 0, rolling_summary TEXT, sent_content_ids_json TEXT NOT NULL DEFAULT '[]', last_content_sent_at TEXT, ai_mode TEXT NOT NULL DEFAULT 'AI', human_lock_until TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS treatments (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, category TEXT NOT NULL, description TEXT NOT NULL, approved_response_guidance TEXT NOT NULL, booking_enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS content_items (id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, url TEXT NOT NULL, thumbnail_url TEXT, treatment_slug TEXT, tags_json TEXT NOT NULL DEFAULT '[]', when_to_send TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1, approved_for_ai INTEGER NOT NULL DEFAULT 1, approved_for_production INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS appointments (id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id), conversation_id TEXT NOT NULL REFERENCES conversations(id), treatment_slug TEXT, date_time TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'confirmed', notes TEXT, created_at TEXT NOT NULL, updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS scheduled_jobs (id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id), conversation_id TEXT NOT NULL REFERENCES conversations(id), appointment_id TEXT REFERENCES appointments(id), job_type TEXT NOT NULL, scheduled_for TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, executed_at TEXT, error TEXT)`,
  `CREATE TABLE IF NOT EXISTS ai_events (id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE, conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE, event_type TEXT NOT NULL, title TEXT NOT NULL, details TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS available_slots (id TEXT PRIMARY KEY, date TEXT NOT NULL, time TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, UNIQUE(date, time))`,
  `CREATE TABLE IF NOT EXISTS human_tasks (id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE, conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE, type TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'NORMAL', status TEXT NOT NULL DEFAULT 'OPEN', title TEXT NOT NULL, reason TEXT, suggested_reply TEXT, assigned_to TEXT, due_at TEXT, resolved_at TEXT, resolved_by TEXT, resolution TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS lead_score_events (id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE, conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE, previous_score INTEGER NOT NULL, new_score INTEGER NOT NULL, reason_codes_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT, summary TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS provider_usage (id TEXT PRIMARY KEY, patient_id TEXT REFERENCES patients(id) ON DELETE SET NULL, conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL, provider TEXT NOT NULL, model TEXT NOT NULL, operation TEXT NOT NULL, status TEXT NOT NULL, latency_ms INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER, output_tokens INTEGER, estimated_cost_usd TEXT, error_code TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS lead_imports (id TEXT PRIMARY KEY, file_name TEXT NOT NULL, status TEXT NOT NULL, total_rows INTEGER NOT NULL DEFAULT 0, imported_rows INTEGER NOT NULL DEFAULT 0, skipped_rows INTEGER NOT NULL DEFAULT 0, error_rows INTEGER NOT NULL DEFAULT 0, errors_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, completed_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS message_templates (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, display_name TEXT, category TEXT NOT NULL DEFAULT 'MARKETING', language TEXT NOT NULL DEFAULT 'en', body TEXT NOT NULL, meta_template_name TEXT, status TEXT NOT NULL DEFAULT 'DRAFT', variables_json TEXT NOT NULL DEFAULT '[]', purpose TEXT, treatment_slug TEXT, active INTEGER NOT NULL DEFAULT 1, last_synced_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS campaigns (id TEXT PRIMARY KEY, name TEXT NOT NULL, template_id TEXT NOT NULL REFERENCES message_templates(id), status TEXT NOT NULL DEFAULT 'DRAFT', audience_json TEXT NOT NULL DEFAULT '{}', segment TEXT NOT NULL DEFAULT 'eligible_all', scheduled_for TEXT, rate_per_minute INTEGER NOT NULL DEFAULT 10, created_by TEXT NOT NULL DEFAULT 'Front Desk', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, started_at TEXT, completed_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS outbound_messages (id TEXT PRIMARY KEY, campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE, conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL, template_id TEXT REFERENCES message_templates(id) ON DELETE SET NULL, channel TEXT NOT NULL DEFAULT 'whatsapp', rendered_body TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'QUEUED', external_message_id TEXT, meta_message_id TEXT, scheduled_for TEXT NOT NULL, sent_at TEXT, delivered_at TEXT, read_at TEXT, replied_at TEXT, failed_at TEXT, failure_code TEXT, failure_message TEXT, error TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS webhook_events (id TEXT PRIMARY KEY, external_id TEXT NOT NULL UNIQUE, event_type TEXT NOT NULL, payload_hash TEXT NOT NULL, status TEXT NOT NULL, attempt_count INTEGER NOT NULL DEFAULT 1, error TEXT, created_at TEXT NOT NULL, processed_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_conversations_last_message ON conversations(last_message_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_patients_score ON patients(lead_score DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_due ON scheduled_jobs(status, scheduled_for)`,
  `CREATE INDEX IF NOT EXISTS idx_events_conversation_created ON ai_events(conversation_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_human_tasks_status_priority ON human_tasks(status, priority, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_score_events_patient_created ON lead_score_events(patient_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_entity_created ON audit_logs(entity_type, entity_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_provider_usage_created ON provider_usage(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_outbound_due ON outbound_messages(status, scheduled_for)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_campaign_patient ON outbound_messages(campaign_id, patient_id) WHERE campaign_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_slot ON appointments(date_time) WHERE status = 'confirmed'`,
];

const additiveColumns: Array<[string, string, string]> = [
  ["patients", "name_source", "TEXT NOT NULL DEFAULT 'whatsapp_profile'"],
  ["patients", "name_verified", "INTEGER NOT NULL DEFAULT 0"],
  ["patients", "whatsapp_id", "TEXT"],
  ["patients", "whatsapp_opt_in_status", "TEXT NOT NULL DEFAULT 'UNKNOWN'"],
  ["patients", "whatsapp_opt_in_date", "TEXT"],
  ["patients", "whatsapp_opt_in_source", "TEXT"],
  ["patients", "do_not_contact", "INTEGER NOT NULL DEFAULT 0"],
  ["patients", "invalid_phone", "INTEGER NOT NULL DEFAULT 0"],
  ["patients", "last_inbound_at", "TEXT"],
  ["patients", "last_outbound_at", "TEXT"],
  ["patients", "service_window_expires_at", "TEXT"],
  ["messages", "external_message_id", "TEXT"],
  ["content_items", "approved_for_ai", "INTEGER NOT NULL DEFAULT 1"],
  ["content_items", "approved_for_production", "INTEGER NOT NULL DEFAULT 0"],
  ["human_tasks", "resolved_by", "TEXT"],
  ["human_tasks", "resolution", "TEXT"],
  ["message_templates", "display_name", "TEXT"],
  ["message_templates", "variables_json", "TEXT NOT NULL DEFAULT '[]'"],
  ["message_templates", "purpose", "TEXT"],
  ["message_templates", "treatment_slug", "TEXT"],
  ["message_templates", "active", "INTEGER NOT NULL DEFAULT 1"],
  ["message_templates", "last_synced_at", "TEXT"],
  ["campaigns", "segment", "TEXT NOT NULL DEFAULT 'eligible_all'"],
  ["campaigns", "started_at", "TEXT"],
  ["campaigns", "completed_at", "TEXT"],
  ["outbound_messages", "payload_json", "TEXT NOT NULL DEFAULT '{}'"],
  ["outbound_messages", "meta_message_id", "TEXT"],
  ["outbound_messages", "delivered_at", "TEXT"],
  ["outbound_messages", "read_at", "TEXT"],
  ["outbound_messages", "replied_at", "TEXT"],
  ["outbound_messages", "failed_at", "TEXT"],
  ["outbound_messages", "failure_code", "TEXT"],
  ["outbound_messages", "failure_message", "TEXT"],
  ["webhook_events", "attempt_count", "INTEGER NOT NULL DEFAULT 1"],
  ["webhook_events", "error", "TEXT"],
];

function ensureAdditiveColumns() {
  const db = getSqlite();
  for (const [table, column, definition] of additiveColumns) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_external_id ON messages(external_message_id) WHERE external_message_id IS NOT NULL");
}

function ensureOperationalDefaults() {
  const db = getSqlite();
  const now = nowIso();
  const insert = db.prepare("INSERT OR IGNORE INTO message_templates (id,name,category,language,body,meta_template_name,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)");
  insert.run("tpl_general_reengagement", "general_reengagement_v1", "MARKETING", "en", "Hi {{firstName}}, this is Radiance Clinics, Bhubaneswar. You had previously contacted us regarding a consultation. If you would still like assistance, reply here and our team can help with the next step. Reply STOP to opt out.", null, "DRAFT", now, now);
  insert.run("tpl_hair_followup", "hair_enquiry_followup_v1", "MARKETING", "en", "Hi {{firstName}}, this is Radiance Clinics. If you would still like help arranging a consultation, reply here and our reception team will assist. Reply STOP to opt out.", null, "DRAFT", now, now);
  insert.run("tpl_skin_followup", "skin_enquiry_followup_v1", "MARKETING", "en", "Hi {{firstName}}, this is Radiance Clinics. If you would still like help arranging a consultation, reply here and our reception team will assist. Reply STOP to opt out.", null, "DRAFT", now, now);
  insert.run("tpl_appointment_reminder", "appointment_reminder_v1", "UTILITY", "en", "Hi {{firstName}}, this is a reminder about your confirmed consultation at Radiance Clinics. Reply here if you need timing assistance.", null, "DRAFT", now, now);
  insert.run("tpl_missed_appointment", "missed_appointment_followup_v1", "UTILITY", "en", "Hi {{firstName}}, we noticed you could not attend your consultation. Reply here if you would like reception to help find another time.", null, "DRAFT", now, now);
  const setting = db.prepare("INSERT OR IGNORE INTO settings (key,value,updated_at) VALUES (?,?,?)");
  setting.run("clinicOperatingHours", JSON.stringify({ monday: ["10:00", "18:30"], tuesday: ["10:00", "18:30"], wednesday: ["10:00", "18:30"], thursday: ["10:00", "18:30"], friday: ["10:00", "18:30"], saturday: ["10:00", "18:30"], sunday: null }), now);
  setting.run("appointmentSlotMinutes", "30", now);
  setting.run("humanCallScoreThreshold", "85", now);
  setting.run("humanLockMinutes", process.env.HUMAN_LOCK_MINUTES || "30", now);
  db.prepare(`INSERT OR IGNORE INTO conversation_state (conversation_id,created_at,updated_at)
    SELECT id,?,? FROM conversations`).run(now, now);
}

export function createSchema() {
  const db = getSqlite();
  for (const statement of schemaStatements) db.prepare(statement).run();
  ensureAdditiveColumns();
  ensureOperationalDefaults();
  db.pragma("optimize");
}

const seedPatients = [
  ["pat_rahul", "Rahul Sharma", "+91 90000 00001", null, null, null, null, 12, "COLD", "new", "test_fixture", "Fresh patient fixture for automated tests.", 1],
  ["pat_ananya", "Ananya Das", "+91 90000 00002", 27, "Acne scarring on cheeks", "acne_scars", "Skin", 82, "HOT", "qualified", "instagram", "27-year-old patient seeking options for acne scarring. Shared education and awaiting consultation choice.", 1],
  ["pat_rohit", "Rohit Mohanty", "+91 90000 00003", 34, "Increased hair fall for six months", "hair_loss", "Hair", 64, "WARM", "follow_up", "google_ads", "34-year-old with recent hair fall. Follow-up is due after initial enquiry.", 1],
  ["pat_sneha", "Sneha Pattnaik", "+91 90000 00004", 31, "Uneven tone and dark spots", "pigmentation", "Skin", 71, "HOT", "booking_offered", "website", "Interested in assessment for pigmentation and has been offered a consultation.", 1],
  ["pat_debashish", "Debashish Sahu", "+91 90000 00005", 30, "Hair thinning and PRP enquiry", "prp", "Hair", 92, "HOT", "booked", "whatsapp", "30-year-old enquiring about PRP. Consultation booked for tomorrow.", 1],
  ["pat_priyanka", "Priyanka Nayak", "+91 90000 00006", 36, "Facial patches believed to be melasma", "melasma", "Skin", 58, "WARM", "engaged", "manual", "Seeking general information about facial pigmentation; requires clinical assessment.", 1],
  ["pat_arjun", "Arjun Das", "+91 90000 00007", null, "General skin concern", "general_skin", "Skin", 31, "COLD", "human_required", "website", "New general skin enquiry requesting a receptionist callback.", 0]
] as const;

export function seedDatabase(force = false) {
  createSchema();
  const db = getSqlite();
  const count = (db.prepare("SELECT COUNT(*) AS count FROM patients").get() as { count: number }).count;
  if (count > 0 && !force) return { seeded: false, patients: count };

  const seed = db.transaction(() => {
    db.pragma("foreign_keys = OFF");
    for (const table of ["outbound_messages", "campaigns", "message_templates", "lead_imports", "provider_usage", "audit_logs", "lead_score_events", "human_tasks", "webhook_events", "scheduled_jobs", "appointments", "messages", "ai_events", "conversations", "patients", "content_items", "treatments", "available_slots", "settings"]) db.prepare(`DELETE FROM ${table}`).run();
    db.pragma("foreign_keys = ON");
    const now = nowIso();
    const insertTreatment = db.prepare("INSERT INTO treatments (id,name,slug,category,description,approved_response_guidance,booking_enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)");
    for (const item of knowledge.treatments) insertTreatment.run(`tr_${item.slug}`, item.name, item.slug, item.category, item.description, knowledge.clinic.safety, 1, now, now);

    const insertContent = db.prepare("INSERT INTO content_items (id,type,title,description,url,thumbnail_url,treatment_slug,tags_json,when_to_send,priority,active,approved_for_ai,approved_for_production,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?)");
    for (const item of content) {
      const approved = /(?:youtube\.com\/(?:watch\?v=8qYMw935MF8|@RadianceClinics)|youtu\.be\/8qYMw935MF8)/i.test(item.url);
      insertContent.run(item.id, item.type, item.title, item.description, item.url, item.thumbnailUrl, item.treatmentSlug, JSON.stringify(item.tags), item.whenToSend, item.priority, 1, Number(approved), now);
    }

    const insertPatient = db.prepare("INSERT INTO patients (id,name,phone,age,primary_concern,treatment_slug,treatment_category,lead_score,lead_temperature,lead_stage,source,ai_summary,ai_enabled,assigned_to,created_at,updated_at,last_contact_at,next_followup_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    const insertConversation = db.prepare("INSERT INTO conversations (id,patient_id,channel,status,unread_count,ai_enabled,last_message_at,created_at) VALUES (?,?,?,?,?,?,?,?)");
    const insertMessage = db.prepare("INSERT INTO messages (id,conversation_id,patient_id,direction,sender_type,message_type,content,delivery_status,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)");
    const insertEvent = db.prepare("INSERT INTO ai_events (id,patient_id,conversation_id,event_type,title,details,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?)");

    seedPatients.forEach((p, index) => {
      const [id, name, phone, age, concern, slug, category, score, temp, stage, source, summary, aiEnabled] = p;
      const conversationId = `con_${id.slice(4)}`;
      const messageTime = subMinutes(new Date(), (index + 1) * 11).toISOString();
      insertPatient.run(id, name, phone, age, concern, slug, category, score, temp, stage, source, summary, aiEnabled, aiEnabled ? "AI Reception" : "Front Desk", now, now, messageTime, index === 2 ? now : null);
      insertConversation.run(conversationId, id, "local", "open", index === 6 ? 1 : 0, aiEnabled, messageTime, now);
      if (id !== "pat_rahul") {
        const patientText = concern ? `Hi, I wanted to ask about ${String(concern).toLowerCase()}.` : "Hi, I need some help.";
        insertMessage.run(makeId("msg"), conversationId, id, "inbound", "patient", "text", patientText, "delivered", "{}", subMinutes(new Date(messageTime), 2).toISOString());
        const reply = aiEnabled ? "Thank you for sharing that. A consultation is the best way for the doctor to assess your concern properly. I can help you find a convenient time." : "I’ve alerted our reception team so a person can help you directly.";
        insertMessage.run(makeId("msg"), conversationId, id, "outbound", aiEnabled ? "ai" : "system", "text", reply, "delivered", "{}", messageTime);
        insertEvent.run(makeId("evt"), id, conversationId, aiEnabled ? "INTENT_DETECTED" : "HUMAN_ESCALATION", aiEnabled ? `${slug?.replaceAll("_", " ")} intent detected` : "Human attention requested", summary, "{}", messageTime);
      }
    });

    const tomorrow = format(addDays(new Date(), 1), "yyyy-MM-dd");
    const bookedAt = `${tomorrow}T11:00:00+05:30`;
    db.prepare("INSERT INTO appointments (id,patient_id,conversation_id,treatment_slug,date_time,status,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run("apt_debashish", "pat_debashish", "con_debashish", "prp", bookedAt, "confirmed", "Automated test fixture", now, now);
    insertEvent.run(makeId("evt"), "pat_debashish", "con_debashish", "APPOINTMENT_CREATED", "Consultation booked", "Tomorrow at 11:00 AM", "{}", now);

    const slotTimes = ["10:00", "10:30", "11:00", "11:30", "12:00", "16:00", "16:30", "17:00", "17:30", "18:00", "18:30"];
    const insertSlot = db.prepare("INSERT OR IGNORE INTO available_slots (id,date,time,active) VALUES (?,?,?,1)");
    for (let day = 0; day < 15; day += 1) {
      const date = format(addDays(new Date(), day), "yyyy-MM-dd");
      for (const time of slotTimes) insertSlot.run(`slot_${date}_${time.replace(":", "")}`, date, time);
    }
    const insertSetting = db.prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES (?,?,?)");
    const settings = {
      appointmentConfirmation: "true",
      appointmentReminder1: "true",
      appointmentReminder2: "true",
      noShowRecovery: "true",
      dormantLeadFollowup: "true"
    };
    Object.entries(settings).forEach(([key, value]) => insertSetting.run(key, value, now));
    const insertTemplate = db.prepare("INSERT OR IGNORE INTO message_templates (id,name,category,language,body,meta_template_name,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)");
    insertTemplate.run("tpl_consultation", "Consultation invitation", "MARKETING", "en", "Hi {{firstName}}, thank you for contacting Radiance Clinics. Would you like help finding a consultation time for {{concern}}? Reply STOP to opt out.", null, "DRAFT", now, now);
    insertTemplate.run("tpl_followup", "Gentle enquiry follow-up", "MARKETING", "en", "Hi {{firstName}}, we are checking whether you still need help with {{concern}}. Reply here for assistance or STOP to opt out.", null, "DRAFT", now, now);
  });
  seed();
  return { seeded: true, patients: seedPatients.length };
}

export function ensureDataDirectory() {
  fs.mkdirSync(path.join(process.cwd(), "data"), { recursive: true });
}
