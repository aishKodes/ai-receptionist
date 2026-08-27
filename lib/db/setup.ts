import fs from "node:fs";
import path from "node:path";
import { addDays, format, subMinutes } from "date-fns";
import { getSqlite, makeId, nowIso } from "@/db";
import knowledge from "@/data/radiance-knowledge.json";
import content from "@/data/radiance-content.json";

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS patients (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE, email TEXT, age INTEGER, gender TEXT, primary_concern TEXT, concern_duration TEXT, treatment_category TEXT, treatment_slug TEXT, lead_score INTEGER NOT NULL DEFAULT 10, lead_temperature TEXT NOT NULL DEFAULT 'COLD', lead_stage TEXT NOT NULL DEFAULT 'new', source TEXT NOT NULL DEFAULT 'demo', campaign TEXT, ai_summary TEXT, assigned_to TEXT DEFAULT 'AI Reception', ai_enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT, last_contact_at TEXT, next_followup_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE, channel TEXT NOT NULL DEFAULT 'local_demo', status TEXT NOT NULL DEFAULT 'open', unread_count INTEGER NOT NULL DEFAULT 0, ai_enabled INTEGER NOT NULL DEFAULT 1, last_message_at TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE, direction TEXT NOT NULL, sender_type TEXT NOT NULL, message_type TEXT NOT NULL DEFAULT 'text', content TEXT NOT NULL, media_url TEXT, content_item_id TEXT, delivery_status TEXT NOT NULL DEFAULT 'delivered', metadata_json TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS treatments (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, category TEXT NOT NULL, description TEXT NOT NULL, approved_response_guidance TEXT NOT NULL, booking_enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS content_items (id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, url TEXT NOT NULL, thumbnail_url TEXT, treatment_slug TEXT, tags_json TEXT NOT NULL DEFAULT '[]', when_to_send TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS appointments (id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id), conversation_id TEXT NOT NULL REFERENCES conversations(id), treatment_slug TEXT, date_time TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'confirmed', notes TEXT, created_at TEXT NOT NULL, updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS scheduled_jobs (id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id), conversation_id TEXT NOT NULL REFERENCES conversations(id), appointment_id TEXT REFERENCES appointments(id), job_type TEXT NOT NULL, scheduled_for TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, executed_at TEXT, error TEXT)`,
  `CREATE TABLE IF NOT EXISTS ai_events (id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE, conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE, event_type TEXT NOT NULL, title TEXT NOT NULL, details TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS available_slots (id TEXT PRIMARY KEY, date TEXT NOT NULL, time TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, UNIQUE(date, time))`,
  `CREATE INDEX IF NOT EXISTS idx_conversations_last_message ON conversations(last_message_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_patients_score ON patients(lead_score DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_due ON scheduled_jobs(status, scheduled_for)`,
  `CREATE INDEX IF NOT EXISTS idx_events_conversation_created ON ai_events(conversation_id, created_at DESC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_slot ON appointments(date_time) WHERE status = 'confirmed'`,
];

export function createSchema() {
  const db = getSqlite();
  for (const statement of schemaStatements) db.prepare(statement).run();
  db.pragma("optimize");
}

const seedPatients = [
  ["pat_rahul", "Rahul Sharma", "+91 90000 00001", null, null, null, null, 12, "COLD", "new", "demo", "Ready for the primary live demonstration.", 1],
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
    for (const table of ["scheduled_jobs", "appointments", "messages", "ai_events", "conversations", "patients", "content_items", "treatments", "available_slots", "settings"]) db.prepare(`DELETE FROM ${table}`).run();
    db.pragma("foreign_keys = ON");
    const now = nowIso();
    const insertTreatment = db.prepare("INSERT INTO treatments (id,name,slug,category,description,approved_response_guidance,booking_enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)");
    for (const item of knowledge.treatments) insertTreatment.run(`tr_${item.slug}`, item.name, item.slug, item.category, item.description, knowledge.clinic.safety, 1, now, now);

    const insertContent = db.prepare("INSERT INTO content_items (id,type,title,description,url,thumbnail_url,treatment_slug,tags_json,when_to_send,priority,active,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
    for (const item of content) insertContent.run(item.id, item.type, item.title, item.description, item.url, item.thumbnailUrl, item.treatmentSlug, JSON.stringify(item.tags), item.whenToSend, item.priority, 1, now);

    const insertPatient = db.prepare("INSERT INTO patients (id,name,phone,age,primary_concern,treatment_slug,treatment_category,lead_score,lead_temperature,lead_stage,source,ai_summary,ai_enabled,assigned_to,created_at,updated_at,last_contact_at,next_followup_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    const insertConversation = db.prepare("INSERT INTO conversations (id,patient_id,channel,status,unread_count,ai_enabled,last_message_at,created_at) VALUES (?,?,?,?,?,?,?,?)");
    const insertMessage = db.prepare("INSERT INTO messages (id,conversation_id,patient_id,direction,sender_type,message_type,content,delivery_status,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)");
    const insertEvent = db.prepare("INSERT INTO ai_events (id,patient_id,conversation_id,event_type,title,details,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?)");

    seedPatients.forEach((p, index) => {
      const [id, name, phone, age, concern, slug, category, score, temp, stage, source, summary, aiEnabled] = p;
      const conversationId = `con_${id.slice(4)}`;
      const messageTime = subMinutes(new Date(), (index + 1) * 11).toISOString();
      insertPatient.run(id, name, phone, age, concern, slug, category, score, temp, stage, source, summary, aiEnabled, aiEnabled ? "AI Reception" : "Front Desk", now, now, messageTime, index === 2 ? now : null);
      insertConversation.run(conversationId, id, "local_demo", "open", index === 6 ? 1 : 0, aiEnabled, messageTime, now);
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
    db.prepare("INSERT INTO appointments (id,patient_id,conversation_id,treatment_slug,date_time,status,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run("apt_debashish", "pat_debashish", "con_debashish", "prp", bookedAt, "confirmed", "Seeded demo appointment", now, now);
    insertEvent.run(makeId("evt"), "pat_debashish", "con_debashish", "APPOINTMENT_CREATED", "Consultation booked", "Tomorrow at 11:00 AM", "{}", now);

    const slotTimes = ["10:00", "10:30", "11:00", "11:30", "12:00", "16:00", "16:30", "17:00", "17:30", "18:00", "18:30"];
    const insertSlot = db.prepare("INSERT OR IGNORE INTO available_slots (id,date,time,active) VALUES (?,?,?,1)");
    for (let day = 0; day < 15; day += 1) {
      const date = format(addDays(new Date(), day), "yyyy-MM-dd");
      for (const time of slotTimes) insertSlot.run(`slot_${date}_${time.replace(":", "")}`, date, time);
    }
    const insertSetting = db.prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES (?,?,?)");
    const settings = {
      demoMode: process.env.DEMO_MODE ?? "true",
      reminder1Seconds: process.env.DEMO_REMINDER_1_SECONDS ?? "45",
      reminder2Seconds: process.env.DEMO_REMINDER_2_SECONDS ?? "90",
      appointmentConfirmation: "true",
      appointmentReminder1: "true",
      appointmentReminder2: "true",
      noShowRecovery: "true",
      dormantLeadFollowup: "true"
    };
    Object.entries(settings).forEach(([key, value]) => insertSetting.run(key, value, now));
  });
  seed();
  return { seeded: true, patients: seedPatients.length };
}

export function ensureDataDirectory() {
  fs.mkdirSync(path.join(process.cwd(), "data"), { recursive: true });
}
