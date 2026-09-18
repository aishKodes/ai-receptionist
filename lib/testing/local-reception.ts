import { getDatabase } from "@/db";
import { ensurePatientForChannel, getPatientContext, updatePatient } from "@/lib/services/repository";

const TEST_PHONE = "+919000009999";

export function localReceptionTestEnabled(hostname: string) {
  const host = hostname.split(":")[0].toLowerCase();
  return process.env.ENABLE_LOCAL_TEST_PANEL === "true" && (host === "localhost" || host === "127.0.0.1" || host === "::1");
}

export function ensureReceptionTestPatient() {
  const context = ensurePatientForChannel({ phone: TEST_PHONE, name: "Test Patient", channel: "local" });
  updatePatient(String(context.patient.id), { source: "local_test", name: "Test Patient", nameSource: "local_test", nameVerified: false });
  return getPatientContext(String(context.patient.id))!;
}

export function resetReceptionTestPatient() {
  const db = getDatabase();
  const patient = db.prepare("SELECT id FROM patients WHERE phone=? AND source='local_test'").get(TEST_PHONE) as { id: string } | undefined;
  if (!patient) return;
  const id = patient.id;
  db.transaction(() => {
    db.prepare("DELETE FROM outbound_messages WHERE patient_id=?").run(id);
    db.prepare("DELETE FROM provider_usage WHERE patient_id=?").run(id);
    db.prepare("DELETE FROM lead_score_events WHERE patient_id=?").run(id);
    db.prepare("DELETE FROM human_tasks WHERE patient_id=?").run(id);
    db.prepare("DELETE FROM scheduled_jobs WHERE patient_id=?").run(id);
    db.prepare("DELETE FROM appointments WHERE patient_id=?").run(id);
    db.prepare("DELETE FROM messages WHERE patient_id=?").run(id);
    db.prepare("DELETE FROM ai_events WHERE patient_id=?").run(id);
    db.prepare("DELETE FROM audit_logs WHERE entity_id=? OR metadata_json LIKE ?").run(id, `%${id}%`);
    db.prepare("DELETE FROM patients WHERE id=? AND source='local_test'").run(id);
  })();
}
