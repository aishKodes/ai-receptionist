import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { addDays, format } from "date-fns";
import mysql from "mysql2/promise";
import knowledge from "@/data/radiance-knowledge.json";

if (process.env.DATABASE_PROVIDER !== "mysql") throw new Error("Set DATABASE_PROVIDER=mysql before running production migrations.");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for MySQL migrations.");

const connection = await mysql.createConnection({
  uri: process.env.DATABASE_URL,
  multipleStatements: true,
  ssl: process.env.DATABASE_SSL === "false" ? undefined : { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" },
});
try {
  const migration = fs.readFileSync(path.join(process.cwd(), "migrations/mysql/0001_production.sql"), "utf8");
  await connection.query(migration);
  const now = new Date().toISOString();
  for (const item of knowledge.treatments) {
    await connection.execute(`INSERT INTO treatments (id,name,slug,category,description,approved_response_guidance,booking_enabled,created_at,updated_at)
      VALUES (?,?,?,?,?,?,1,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),category=VALUES(category),description=VALUES(description),approved_response_guidance=VALUES(approved_response_guidance),updated_at=VALUES(updated_at)`,
      [`tr_${item.slug}`, item.name, item.slug, item.category, item.description, knowledge.clinic.safety, now, now]);
  }
  const settings: Record<string, string> = {
    clinicName: "Radiance Skin & Hair Clinics",
    clinicLocation: "Bhubaneswar",
    timezone: "Asia/Kolkata",
    appointmentSlotMinutes: "30",
    humanCallScoreThreshold: "85",
    humanLockMinutes: process.env.HUMAN_LOCK_MINUTES || "30",
    appointmentConfirmation: "true",
    appointmentReminder1: "true",
    appointmentReminder2: "true",
    noShowRecovery: "true",
    dormantLeadFollowup: "true",
  };
  for (const [key, value] of Object.entries(settings)) {
    await connection.execute("INSERT IGNORE INTO settings (`key`,value,updated_at) VALUES (?,?,?)", [key, value, now]);
  }
  const content = [
    ["content_radiance_youtube_channel", "youtube", "Radiance Clinics YouTube channel", "Doctor-reviewed educational videos from Radiance Skin & Hair Clinics.", "https://www.youtube.com/@RadianceClinics", null, JSON.stringify(["radiance", "doctor reviewed", "education"]), "Only when a patient explicitly asks for clinic videos or educational resources", 10],
    ["content_hair_transplant_guide", "youtube", "Hair transplant guide", "A doctor-reviewed guide to understanding hair-transplant consultation and treatment planning.", "https://youtu.be/8qYMw935MF8", "hair_transplant", JSON.stringify(["hair transplant", "guide", "consultation"]), "Only when a patient explicitly asks for a hair-transplant guide", 20],
  ] as const;
  for (const item of content) {
    await connection.execute(`INSERT INTO content_items (id,type,title,description,url,treatment_slug,tags_json,when_to_send,priority,active,approved_for_ai,approved_for_production,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,1,1,1,?) ON DUPLICATE KEY UPDATE title=VALUES(title),description=VALUES(description),url=VALUES(url),treatment_slug=VALUES(treatment_slug),tags_json=VALUES(tags_json),when_to_send=VALUES(when_to_send),priority=VALUES(priority),active=1,approved_for_ai=1,approved_for_production=1`, [...item, now]);
  }
  const slotTimes = ["10:00", "10:30", "11:00", "11:30", "12:00", "16:00", "16:30", "17:00", "17:30", "18:00", "18:30"];
  for (let day = 0; day < 45; day += 1) {
    const date = format(addDays(new Date(), day), "yyyy-MM-dd");
    for (const time of slotTimes) await connection.execute("INSERT IGNORE INTO available_slots (id,`date`,`time`,active) VALUES (?,?,?,1)", [`slot_${date}_${time.replace(":", "")}`, date, time]);
  }
  console.log(`[MYSQL] Production schema and operational defaults completed (${knowledge.treatments.length} treatments, ${content.length} approved content items, ${45 * slotTimes.length} slots).`);
} finally {
  await connection.end();
}
