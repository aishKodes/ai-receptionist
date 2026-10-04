import { makeId, nowIso } from "@/db";
import { addAudit, ready } from "@/lib/services/repository";

export type StaffContact = {
  id: string; name: string; phone: string; role: "DOCTOR" | "ADMIN" | "RECEPTION" | "MANAGER";
  canViewSummaries: number | boolean; canViewAppointments: number | boolean; canReceiveDoctorReview: number | boolean;
  canApproveKnowledge: number | boolean; canReceiveAlerts: number | boolean;
};

export function normalizeStaffPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `+91${digits}`;
  return null;
}

export function findAuthorizedStaff(value: string): StaffContact | null {
  const phone = normalizeStaffPhone(value);
  if (!phone) return null;
  const staff = ready().prepare(`SELECT id,name,phone,role,can_view_summaries AS canViewSummaries,can_view_appointments AS canViewAppointments,
    can_receive_doctor_review AS canReceiveDoctorReview,can_approve_knowledge AS canApproveKnowledge,can_receive_alerts AS canReceiveAlerts
    FROM authorized_staff_contacts WHERE phone=? AND active=1 LIMIT 1`).get(phone) as StaffContact | undefined;
  return staff || null;
}

export function saveStaffContact(input: { id?: string; name: string; phone: string; role: StaffContact["role"]; active?: boolean; canViewSummaries?: boolean; canViewAppointments?: boolean; canReceiveDoctorReview?: boolean; canApproveKnowledge?: boolean; canReceiveAlerts?: boolean }) {
  const phone = normalizeStaffPhone(input.phone);
  if (!phone) throw new Error("Enter a valid Indian mobile number.");
  const id = input.id || makeId("staff");
  const now = nowIso();
  ready().prepare(`INSERT INTO authorized_staff_contacts (id,name,phone,role,active,can_view_summaries,can_view_appointments,can_receive_doctor_review,can_approve_knowledge,can_receive_alerts,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(phone) DO UPDATE SET name=excluded.name,role=excluded.role,active=excluded.active,can_view_summaries=excluded.can_view_summaries,can_view_appointments=excluded.can_view_appointments,can_receive_doctor_review=excluded.can_receive_doctor_review,can_approve_knowledge=excluded.can_approve_knowledge,can_receive_alerts=excluded.can_receive_alerts,updated_at=excluded.updated_at`)
    .run(id, input.name.trim(), phone, input.role, Number(input.active !== false), Number(Boolean(input.canViewSummaries)), Number(Boolean(input.canViewAppointments)), Number(Boolean(input.canReceiveDoctorReview)), Number(Boolean(input.canApproveKnowledge)), Number(Boolean(input.canReceiveAlerts)), now, now);
  addAudit("STAFF_CONTACT_UPDATED", "authorized_staff_contact", id, `${input.role} contact configured`, "ADMIN");
  return id;
}

function istDay(offset = 0) {
  const now = new Date(Date.now() + offset * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

type StaffIntent = "TODAY" | "APPOINTMENTS_TOMORROW" | "HOT_LEADS" | "DOCTOR_REVIEWS" | "CALLBACKS" | "WEEK_CONSULTATIONS" | "HELP";

export function parseStaffIntent(message: string): StaffIntent {
  const text = message.toLowerCase().trim();
  if (/who needs me|doctor review|need(?:s)? doctor|cases? for me/.test(text)) return "DOCTOR_REVIEWS";
  if (/callback|calls? pending|call due/.test(text)) return "CALLBACKS";
  if (/appointments?.*tomorrow|tomorrow.*appointments?|consultations?.*tomorrow/.test(text)) return "APPOINTMENTS_TOMORROW";
  if (/hot leads?|serious.*leads?|valuable leads?|hair transplant leads?/.test(text)) return "HOT_LEADS";
  if (/consultations?.*(?:this )?week|how many.*week/.test(text)) return "WEEK_CONSULTATIONS";
  if (/^(today|today\?|what happened today|summary|daily summary)/.test(text)) return "TODAY";
  return "HELP";
}

function requirePermission(staff: StaffContact, allowed: boolean, permission: string) {
  if (!allowed && staff.role !== "ADMIN") throw new Error(`${staff.role} is not permitted to view ${permission}.`);
}

export function answerStaffCommand(staff: StaffContact, message: string) {
  const db = ready();
  const intent = parseStaffIntent(message);
  let answer: string;
  if (intent === "TODAY") {
    requirePermission(staff, Boolean(staff.canViewSummaries), "clinic summaries");
    const day = istDay();
    const stats = db.prepare(`SELECT
      (SELECT COUNT(*) FROM patients WHERE substr(created_at,1,10)=?) AS enquiries,
      (SELECT COUNT(*) FROM patients WHERE lead_temperature='HOT' AND lead_stage NOT IN ('lost','not_interested')) AS hot,
      (SELECT COUNT(*) FROM appointments WHERE substr(date_time,1,10)=? AND status='confirmed') AS booked,
      (SELECT COUNT(*) FROM human_tasks WHERE status='OPEN' AND type='CALL') AS calls,
      (SELECT COUNT(*) FROM doctor_reviews WHERE status='OPEN') AS reviews`).get(day, day) as Record<string, number>;
    answer = `Today at Radiance:\n${Number(stats.enquiries)} new enquiries\n${Number(stats.hot)} hot leads\n${Number(stats.booked)} consultations booked\n${Number(stats.calls)} calls pending\n${Number(stats.reviews)} cases need doctor review.`;
  } else if (intent === "APPOINTMENTS_TOMORROW") {
    requirePermission(staff, Boolean(staff.canViewAppointments), "appointments");
    const day = istDay(1);
    const count = (db.prepare("SELECT COUNT(*) AS count FROM appointments WHERE substr(date_time,1,10)=? AND status='confirmed'").get(day) as { count: number }).count;
    answer = `${Number(count)} confirmed consultation${Number(count) === 1 ? "" : "s"} tomorrow.`;
  } else if (intent === "HOT_LEADS") {
    requirePermission(staff, Boolean(staff.canViewSummaries), "lead summaries");
    const rows = db.prepare(`SELECT COALESCE(treatment_slug,'general enquiry') AS treatment,lead_score AS score,COALESCE(ai_summary,primary_concern,'Active enquiry') AS summary
      FROM patients WHERE lead_temperature='HOT' AND lead_stage NOT IN ('booked','lost','not_interested') ORDER BY lead_score DESC LIMIT 5`).all() as Array<Record<string, unknown>>;
    answer = rows.length ? `Top leads:\n${rows.map((row, index) => `${index + 1}. ${String(row.treatment).replaceAll("_", " ")} — ${Number(row.score)} — ${String(row.summary).slice(0, 90)}`).join("\n")}` : "There are no open hot leads right now.";
  } else if (intent === "DOCTOR_REVIEWS") {
    requirePermission(staff, Boolean(staff.canReceiveDoctorReview), "doctor-review cases");
    const rows = db.prepare("SELECT priority,question_summary AS questionSummary FROM doctor_reviews WHERE status='OPEN' ORDER BY CASE priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 ELSE 2 END,created_at LIMIT 5").all() as Array<Record<string, unknown>>;
    answer = rows.length ? `${rows.length} case${rows.length === 1 ? "" : "s"} need review:\n${rows.map((row, index) => `${index + 1}. ${row.priority} — ${String(row.questionSummary).slice(0, 110)}`).join("\n")}` : "No doctor-review cases are waiting.";
  } else if (intent === "CALLBACKS") {
    requirePermission(staff, Boolean(staff.canViewSummaries), "callback summaries");
    const count = (db.prepare("SELECT COUNT(*) AS count FROM patients WHERE callback_at IS NOT NULL AND callback_at<=? AND lead_stage NOT IN ('lost','not_interested')").get(nowIso()) as { count: number }).count;
    answer = `${Number(count)} callback${Number(count) === 1 ? " is" : "s are"} due.`;
  } else if (intent === "WEEK_CONSULTATIONS") {
    requirePermission(staff, Boolean(staff.canViewAppointments), "appointments");
    const start = istDay(); const end = istDay(7);
    const count = (db.prepare("SELECT COUNT(*) AS count FROM appointments WHERE substr(date_time,1,10)>=? AND substr(date_time,1,10)<? AND status IN ('confirmed','completed')").get(start, end) as { count: number }).count;
    answer = `${Number(count)} consultation${Number(count) === 1 ? "" : "s"} are confirmed or completed in the next seven days.`;
  } else {
    answer = "You can ask: Today? · Hot leads? · Appointments tomorrow? · Who needs me? · Any callbacks pending? · Consultations this week?";
  }
  const queryId = makeId("staffq");
  addAudit("STAFF_QUERY", "staff_query", queryId, `Deterministic ${intent} query returned`, "SYSTEM", { staffId: staff.id, role: staff.role, intent, returned: answer.slice(0, 500) });
  return { intent, answer };
}
