import "dotenv/config";
import { format, addDays } from "date-fns";
import { getSqlite, nowIso } from "@/db";
import { createSchema } from "@/lib/db/setup";

if (!process.argv.includes("--apply")) throw new Error("Pass --apply to perform the reviewed one-time production cleanup.");

createSchema();
const db = getSqlite();
const now = nowIso();
const fakePatientIds = (db.prepare(`SELECT id FROM patients WHERE
  phone LIKE '+91 90000 0000%' OR phone LIKE '+91 80000 %' OR
  name LIKE '%Demo%' OR name='Radiance Live Test' OR source IN ('demo','local_demo','mock_meta','test')`).all() as Array<{ id: string }>).map((row) => row.id);

const result = db.transaction(() => {
  for (const patientId of fakePatientIds) {
    db.prepare("DELETE FROM outbound_messages WHERE patient_id=?").run(patientId);
    db.prepare("DELETE FROM provider_usage WHERE patient_id=?").run(patientId);
    db.prepare("DELETE FROM lead_score_events WHERE patient_id=?").run(patientId);
    db.prepare("DELETE FROM human_tasks WHERE patient_id=?").run(patientId);
    db.prepare("DELETE FROM scheduled_jobs WHERE patient_id=?").run(patientId);
    db.prepare("DELETE FROM appointments WHERE patient_id=?").run(patientId);
    db.prepare("DELETE FROM messages WHERE patient_id=?").run(patientId);
    db.prepare("DELETE FROM ai_events WHERE patient_id=?").run(patientId);
    db.prepare("DELETE FROM audit_logs WHERE entity_id=? OR metadata_json LIKE ?").run(patientId, `%${patientId}%`);
    db.prepare("DELETE FROM patients WHERE id=?").run(patientId);
  }
  db.prepare("DELETE FROM campaigns").run();
  db.prepare("DELETE FROM lead_imports").run();
  db.prepare("DELETE FROM webhook_events").run();
  db.prepare("DELETE FROM content_items").run();
  const insertContent = db.prepare(`INSERT INTO content_items
    (id,type,title,description,url,thumbnail_url,treatment_slug,tags_json,when_to_send,priority,active,approved_for_ai,approved_for_production,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,1,1,1,?)`);
  insertContent.run("content_radiance_youtube_channel", "youtube", "Radiance Clinics YouTube channel", "Doctor-reviewed educational videos from Radiance Skin & Hair Clinics.", "https://www.youtube.com/@RadianceClinics", null, null, JSON.stringify(["radiance", "doctor reviewed", "education"]), "Only when a patient explicitly asks for clinic videos or educational resources", 10, now);
  insertContent.run("content_hair_transplant_guide", "youtube", "Hair transplant guide", "A doctor-reviewed guide to understanding hair-transplant consultation and treatment planning.", "https://youtu.be/8qYMw935MF8", null, "hair_transplant", JSON.stringify(["hair transplant", "guide", "consultation"]), "Only when a patient explicitly asks for a hair-transplant guide", 20, now);
  db.prepare("DELETE FROM settings WHERE key IN ('demoMode','reminder1Seconds','reminder2Seconds')").run();
  db.prepare("DELETE FROM available_slots").run();
  const insertSlot = db.prepare("INSERT INTO available_slots (id,date,time,active) VALUES (?,?,?,1)");
  const slotTimes = ["10:00", "10:30", "11:00", "11:30", "12:00", "16:00", "16:30", "17:00", "17:30", "18:00", "18:30"];
  for (let day = 0; day < 45; day += 1) {
    const date = format(addDays(new Date(), day), "yyyy-MM-dd");
    for (const time of slotTimes) insertSlot.run(`slot_${date}_${time.replace(":", "")}`, date, time);
  }
  return { removedTestPatients: fakePatientIds.length, approvedContentItems: 2, availableSlots: 45 * slotTimes.length };
})();

console.log(`[PRODUCTION CLEANUP] ${JSON.stringify(result)}`);
