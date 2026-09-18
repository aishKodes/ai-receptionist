import { getDatabase } from "@/db";
import { getSettings } from "@/lib/services/repository";
import { outreachEligibility } from "./service";

export type OutreachCandidate = { id: string; name: string; phone: string; conversationId: string; leadScore: number; priority: number; reasons: string[]; suggestedAction: "CALL" | "MANUAL_FOLLOWUP" | "WAIT" | "NO_CONTACT" | "DOCTOR_REVIEW"; lastMarketingAt: string | null };

export function marketingDay(now = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now); }
export function marketingLimit() { return Math.max(0, Math.min(1000, Number(process.env.AUTO_MARKETING_DAILY_LIMIT ?? getSettings().autoMarketingDailyLimit ?? 10) || 0)); }
export function cooldownDays() { return Math.max(1, Math.min(365, Number(process.env.MARKETING_OUTREACH_COOLDOWN_DAYS ?? getSettings().marketingOutreachCooldownDays ?? 7) || 7)); }

export function marketingUsed(day = marketingDay()) {
  const db = getDatabase();
  const row = db.prepare("SELECT used FROM marketing_daily_quota WHERE day=?").get(day) as { used: number } | undefined;
  if (row) return Number(row.used);
  const historic = db.prepare("SELECT COUNT(*) AS count FROM outbound_messages o JOIN message_templates t ON t.id=o.template_id WHERE t.category='MARKETING' AND o.status IN ('SENT','DELIVERED','READ','REPLIED') AND substr(o.sent_at,1,10)=?").get(day) as { count: number };
  return historic.count;
}

export function reserveMarketingContact(patientId: string): "RESERVED" | "COOLDOWN" | "LIMIT" {
  const db = getDatabase(); const day = marketingDay(); const limit = marketingLimit();
  const now = new Date();
  const until = new Date(now.getTime() + cooldownDays() * 86400000).toISOString();
  try {
    return db.transaction(() => {
      db.prepare("INSERT OR IGNORE INTO marketing_patient_cooldown (patient_id,reserved_until) VALUES (?,'1970-01-01T00:00:00.000Z')").run(patientId);
      const contact = db.prepare("UPDATE marketing_patient_cooldown SET reserved_until=? WHERE patient_id=? AND reserved_until<=?").run(until, patientId, now.toISOString());
      if (!contact.changes) return "COOLDOWN" as const;
      const used = marketingUsed(day);
      db.prepare("INSERT OR IGNORE INTO marketing_daily_quota (day,used) VALUES (?,?)").run(day, used);
      const quota = db.prepare("UPDATE marketing_daily_quota SET used=used+1 WHERE day=? AND used<?").run(day, limit);
      if (!quota.changes) throw new Error("MARKETING_LIMIT_REACHED");
      return "RESERVED" as const;
    })();
  } catch (error) {
    if (error instanceof Error && error.message === "MARKETING_LIMIT_REACHED") return "LIMIT";
    throw error;
  }
}

export function rankOutreachCandidates(now = new Date()) {
  const db = getDatabase();
  const rows = db.prepare(`SELECT p.id,p.name,p.phone,p.lead_score AS leadScore,p.lead_stage AS leadStage,p.treatment_slug AS treatmentSlug,p.whatsapp_opt_in_status AS whatsappOptInStatus,p.do_not_contact AS doNotContact,p.invalid_phone AS invalidPhone,p.last_inbound_at AS lastInboundAt,p.last_contact_at AS lastContactAt,p.next_followup_at AS nextFollowupAt,c.id AS conversationId,c.last_message_at AS lastMessageAt,
    (SELECT MAX(sent_at) FROM outbound_messages o JOIN message_templates t ON t.id=o.template_id WHERE o.patient_id=p.id AND t.category='MARKETING' AND o.status IN ('SENT','DELIVERED','READ','REPLIED')) AS lastMarketingAt,
    (SELECT COUNT(*) FROM outbound_messages o JOIN message_templates t ON t.id=o.template_id WHERE o.patient_id=p.id AND t.category='MARKETING' AND o.status IN ('SENT','DELIVERED','READ','REPLIED')) AS marketingCount,
    (SELECT COUNT(*) FROM messages m WHERE m.patient_id=p.id AND m.sender_type='patient') AS inboundCount,
    (SELECT COUNT(*) FROM messages m WHERE m.patient_id=p.id AND m.sender_type='patient' AND (lower(m.content) LIKE '%price%' OR lower(m.content) LIKE '%cost%')) AS priceQuestions,
    (SELECT COUNT(*) FROM messages m WHERE m.patient_id=p.id AND m.sender_type='patient' AND (lower(m.content) LIKE '%appointment%' OR lower(m.content) LIKE '%book%' OR lower(m.content) LIKE '%consultation%')) AS bookingQuestions,
    (SELECT COUNT(*) FROM appointments a WHERE a.patient_id=p.id AND a.status='confirmed') AS activeAppointments,
    (SELECT COUNT(*) FROM human_tasks h WHERE h.patient_id=p.id AND h.status IN ('OPEN','ASSIGNED','CONTACTED') AND h.type IN ('CALL','CHAT','DOCTOR_REVIEW')) AS activeHumanTasks
    FROM patients p JOIN conversations c ON c.id=(SELECT c2.id FROM conversations c2 WHERE c2.patient_id=p.id ORDER BY c2.last_message_at DESC LIMIT 1)`).all() as Array<Record<string, unknown>>;
  const eligible: OutreachCandidate[] = []; const wait: Array<{ id: string; reason: string }> = [];
  for (const row of rows) {
    const gate = outreachEligibility(row);
    if (!gate.eligible) { wait.push({ id: String(row.id), reason: gate.reason }); continue; }
    const lastMarketingAt = row.lastMarketingAt ? String(row.lastMarketingAt) : null;
    const daysSinceMarketing = lastMarketingAt ? (now.getTime() - new Date(lastMarketingAt).getTime()) / 86400000 : Infinity;
    const reservation = db.prepare("SELECT reserved_until AS reservedUntil FROM marketing_patient_cooldown WHERE patient_id=?").get(row.id) as { reservedUntil: string } | undefined;
    const activeInbound = row.lastInboundAt && now.getTime() - new Date(String(row.lastInboundAt)).getTime() < 24 * 3600000;
    if (daysSinceMarketing < cooldownDays() || (reservation && new Date(reservation.reservedUntil).getTime() > now.getTime())) { wait.push({ id: String(row.id), reason: "COOLDOWN" }); continue; }
    if (Number(row.activeAppointments)) { wait.push({ id: String(row.id), reason: "ACTIVE_APPOINTMENT" }); continue; }
    if (Number(row.activeHumanTasks)) { wait.push({ id: String(row.id), reason: "STAFF_HANDLING" }); continue; }
    if (activeInbound) { wait.push({ id: String(row.id), reason: "ACTIVE_CONVERSATION" }); continue; }
    if (row.leadStage === "not_interested") { wait.push({ id: String(row.id), reason: "NOT_INTERESTED" }); continue; }
    const reasons: string[] = []; let priority = Number(row.leadScore || 0);
    if (Number(row.bookingQuestions)) { priority += 18; reasons.push("Previously asked about an appointment"); }
    if (Number(row.priceQuestions)) { priority += 10; reasons.push("Asked about pricing"); }
    if (Number(row.inboundCount) >= 3) { priority += 7; reasons.push("Meaningful prior conversation"); }
    if (row.nextFollowupAt && new Date(String(row.nextFollowupAt)).getTime() <= now.getTime()) { priority += 10; reasons.push("Follow-up due"); }
    if (["hair_transplant", "beard_transplant", "gfc"].includes(String(row.treatmentSlug))) { priority += 5; reasons.push("Specific treatment interest"); }
    if (Number(row.marketingCount)) { priority -= Math.min(25, Number(row.marketingCount) * 8); reasons.push("Previous outreach considered"); }
    const lastContact = row.lastContactAt ? (now.getTime() - new Date(String(row.lastContactAt)).getTime()) / 86400000 : Infinity;
    if (lastContact > 90) { priority -= 15; reasons.push("Older lead"); }
    if (!Number(row.inboundCount)) { priority -= 20; reasons.push("No prior patient engagement"); }
    const suggestedAction = Number(row.bookingQuestions) && priority >= 70 ? "CALL" : priority >= 50 ? "MANUAL_FOLLOWUP" : "WAIT";
    eligible.push({ id: String(row.id), name: String(row.name), phone: String(row.phone), conversationId: String(row.conversationId), leadScore: Number(row.leadScore || 0), priority: Math.max(0, Math.min(100, priority)), reasons, suggestedAction, lastMarketingAt });
  }
  eligible.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  return { eligible, wait };
}

export function outreachDryRun(campaignId?: string) {
  const { eligible, wait } = rankOutreachCandidates();
  const used = marketingUsed(); const limit = marketingLimit(); const available = Math.max(0, limit - used);
  const db = getDatabase();
  const campaign = campaignId ? db.prepare("SELECT t.category,t.status,t.meta_template_name AS metaTemplateName FROM campaigns c JOIN message_templates t ON t.id=c.template_id WHERE c.id=?").get(campaignId) as { category: string; status: string; metaTemplateName: string | null } | undefined : null;
  const templateReady = campaign ? campaign.category === "MARKETING" && campaign.status === "APPROVED" && Boolean(campaign.metaTemplateName) : false;
  const selected = eligible.slice(0, available);
  const humanOpportunity = eligible.slice(available).filter((item) => item.priority >= 50).slice(0, 12);
  return { day: marketingDay(), limit, used, available, eligibleToday: eligible.length, selected, humanOpportunity, waitCount: wait.length + Math.max(0, eligible.length - selected.length - humanOpportunity.length), blocked: wait, templateReady, sendsAllowed: templateReady && available > 0 };
}
