import { getDatabase, makeId } from "@/db";
import { getSettings } from "@/lib/services/repository";
import { outreachEligibility } from "./service";

export type ReactivationAction =
  "AUTO_WHATSAPP" | "CALL" | "MANUAL_WHATSAPP" | "WAIT" | "DO_NOT_CONTACT";
export type OutreachCandidate = {
  id: string;
  name: string;
  phone: string;
  conversationId: string;
  leadScore: number;
  priority: number;
  reasons: string[];
  reactivationAction: ReactivationAction;
  suggestedAction:
    "CALL" | "MANUAL_FOLLOWUP" | "WAIT" | "NO_CONTACT" | "DOCTOR_REVIEW";
  lastMarketingAt: string | null;
};

export type ReactivationInput = {
  leadScore?: number;
  treatmentSlug?: string | null;
  whatsappOptInStatus?: string;
  doNotContact?: boolean | number;
  invalidPhone?: boolean | number;
  leadStage?: string;
  lastContactAt?: string | null;
  inboundCount?: number;
  priceQuestions?: number;
  bookingQuestions?: number;
  callRequests?: number;
  missedAppointments?: number;
  activeAppointments?: number;
  activeHumanTasks?: number;
  marketingCount?: number;
  nextFollowupAt?: string | null;
};

export function calculateReactivationDecision(
  input: ReactivationInput,
  now = new Date(),
) {
  const reasons: string[] = [];
  if (
    Boolean(input.doNotContact) ||
    input.whatsappOptInStatus === "REVOKED" ||
    Boolean(input.invalidPhone)
  )
    return {
      score: 0,
      action: "DO_NOT_CONTACT" as const,
      reasons: ["Consent revoked, do-not-contact, or invalid number"],
    };
  if (["not_interested", "lost"].includes(String(input.leadStage)))
    return {
      score: 0,
      action: "DO_NOT_CONTACT" as const,
      reasons: ["Lead is closed or not interested"],
    };
  if (Number(input.activeAppointments))
    return {
      score: 0,
      action: "WAIT" as const,
      reasons: ["Consultation already booked"],
    };
  if (Number(input.activeHumanTasks))
    return {
      score: 0,
      action: "WAIT" as const,
      reasons: ["Staff is already handling this lead"],
    };
  const lastContactDays = input.lastContactAt
    ? (now.getTime() - new Date(input.lastContactAt).getTime()) / 86400000
    : 30;
  if (lastContactDays < 7)
    return {
      score: 10,
      action: "WAIT" as const,
      reasons: ["Recently contacted"],
    };
  let score = Math.round(Math.min(45, Number(input.leadScore || 0) * 0.45));
  if (Number(input.priceQuestions)) {
    score += 14;
    reasons.push("Asked pricing");
  }
  if (Number(input.bookingQuestions)) {
    score += 22;
    reasons.push("Previously requested appointment");
  }
  if (Number(input.callRequests)) {
    score += 20;
    reasons.push("Previously requested callback");
  }
  if (Number(input.missedAppointments)) {
    score += 18;
    reasons.push("Missed appointment without completed consultation");
  }
  if (Number(input.inboundCount) >= 3) {
    score += 8;
    reasons.push("Meaningful prior conversation");
  }
  if (
    ["hair_transplant", "beard_transplant"].includes(
      String(input.treatmentSlug),
    )
  ) {
    score += 12;
    reasons.push("High-value treatment interest");
  }
  if (
    input.nextFollowupAt &&
    new Date(input.nextFollowupAt).getTime() <= now.getTime()
  ) {
    score += 8;
    reasons.push("Follow-up due");
  }
  if (lastContactDays >= 14 && lastContactDays <= 60) {
    score += 10;
    reasons.push(`${Math.floor(lastContactDays)} days dormant`);
  }
  if (lastContactDays > 120) {
    score -= 12;
    reasons.push("Long-dormant lead");
  }
  if (Number(input.marketingCount)) {
    score -= Math.min(25, Number(input.marketingCount) * 9);
    reasons.push(
      `${Number(input.marketingCount)} prior follow-up attempt${Number(input.marketingCount) === 1 ? "" : "s"}`,
    );
  }
  score = Math.max(0, Math.min(100, score));
  if (
    Number(input.callRequests) ||
    (["hair_transplant", "beard_transplant"].includes(
      String(input.treatmentSlug),
    ) &&
      Number(input.bookingQuestions) &&
      score >= 72)
  )
    return { score, action: "CALL" as const, reasons };
  if (input.whatsappOptInStatus === "CONFIRMED" && score >= 50)
    return { score, action: "AUTO_WHATSAPP" as const, reasons };
  if (score >= 55)
    return {
      score,
      action: "MANUAL_WHATSAPP" as const,
      reasons: [...reasons, "Consent must be confirmed manually"],
    };
  return { score, action: "WAIT" as const, reasons };
}

export function marketingDay(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function marketingLimit() {
  return Math.max(
    0,
    Math.min(
      1000,
      Number(
        process.env.AUTO_MARKETING_DAILY_LIMIT ??
          getSettings().autoMarketingDailyLimit ??
          10,
      ) || 0,
    ),
  );
}
export function cooldownDays() {
  return Math.max(
    1,
    Math.min(
      365,
      Number(
        process.env.MARKETING_OUTREACH_COOLDOWN_DAYS ??
          getSettings().marketingOutreachCooldownDays ??
          7,
      ) || 7,
    ),
  );
}

export function marketingUsed(day = marketingDay()) {
  const db = getDatabase();
  const row = db
    .prepare("SELECT used FROM marketing_daily_quota WHERE day=?")
    .get(day) as { used: number } | undefined;
  if (row) return Number(row.used);
  const historic = db
    .prepare(
      "SELECT COUNT(*) AS count FROM outbound_messages o JOIN message_templates t ON t.id=o.template_id WHERE t.category='MARKETING' AND o.status IN ('SENT','DELIVERED','READ','REPLIED') AND substr(o.sent_at,1,10)=?",
    )
    .get(day) as { count: number };
  return historic.count;
}

export function reserveMarketingContact(
  patientId: string,
): "RESERVED" | "COOLDOWN" | "LIMIT" {
  const db = getDatabase();
  const day = marketingDay();
  const limit = marketingLimit();
  const now = new Date();
  const until = new Date(
    now.getTime() + cooldownDays() * 86400000,
  ).toISOString();
  try {
    return db.transaction(() => {
      db.prepare(
        "INSERT OR IGNORE INTO marketing_patient_cooldown (patient_id,reserved_until) VALUES (?,'1970-01-01T00:00:00.000Z')",
      ).run(patientId);
      const contact = db
        .prepare(
          "UPDATE marketing_patient_cooldown SET reserved_until=? WHERE patient_id=? AND reserved_until<=?",
        )
        .run(until, patientId, now.toISOString());
      if (!contact.changes) return "COOLDOWN" as const;
      const used = marketingUsed(day);
      db.prepare(
        "INSERT OR IGNORE INTO marketing_daily_quota (day,used) VALUES (?,?)",
      ).run(day, used);
      const quota = db
        .prepare(
          "UPDATE marketing_daily_quota SET used=used+1 WHERE day=? AND used<?",
        )
        .run(day, limit);
      if (!quota.changes) throw new Error("MARKETING_LIMIT_REACHED");
      return "RESERVED" as const;
    })();
  } catch (error) {
    if (error instanceof Error && error.message === "MARKETING_LIMIT_REACHED")
      return "LIMIT";
    throw error;
  }
}

export function rankOutreachCandidates(now = new Date()) {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT p.id,p.name,p.phone,p.lead_score AS leadScore,p.lead_stage AS leadStage,p.treatment_slug AS treatmentSlug,p.whatsapp_opt_in_status AS whatsappOptInStatus,p.do_not_contact AS doNotContact,p.invalid_phone AS invalidPhone,p.last_inbound_at AS lastInboundAt,p.last_contact_at AS lastContactAt,p.next_followup_at AS nextFollowupAt,p.reactivation_score AS previousReactivationScore,p.reactivation_action AS previousReactivationAction,c.id AS conversationId,c.last_message_at AS lastMessageAt,
    (SELECT MAX(sent_at) FROM outbound_messages o JOIN message_templates t ON t.id=o.template_id WHERE o.patient_id=p.id AND t.category='MARKETING' AND o.status IN ('SENT','DELIVERED','READ','REPLIED')) AS lastMarketingAt,
    (SELECT COUNT(*) FROM outbound_messages o JOIN message_templates t ON t.id=o.template_id WHERE o.patient_id=p.id AND t.category='MARKETING' AND o.status IN ('SENT','DELIVERED','READ','REPLIED')) AS marketingCount,
    (SELECT COUNT(*) FROM messages m WHERE m.patient_id=p.id AND m.sender_type='patient') AS inboundCount,
    (SELECT COUNT(*) FROM messages m WHERE m.patient_id=p.id AND m.sender_type='patient' AND (lower(m.content) LIKE '%price%' OR lower(m.content) LIKE '%cost%')) AS priceQuestions,
    (SELECT COUNT(*) FROM messages m WHERE m.patient_id=p.id AND m.sender_type='patient' AND (lower(m.content) LIKE '%appointment%' OR lower(m.content) LIKE '%book%' OR lower(m.content) LIKE '%consultation%')) AS bookingQuestions,
    (SELECT COUNT(*) FROM messages m WHERE m.patient_id=p.id AND m.sender_type='patient' AND (lower(m.content) LIKE '%call me%' OR lower(m.content) LIKE '%call back%')) AS callRequests,
    (SELECT COUNT(*) FROM appointments a WHERE a.patient_id=p.id AND a.status='no_show') AS missedAppointments,
    (SELECT COUNT(*) FROM appointments a WHERE a.patient_id=p.id AND a.status='confirmed') AS activeAppointments,
    (SELECT COUNT(*) FROM human_tasks h WHERE h.patient_id=p.id AND h.status IN ('OPEN','ASSIGNED','CONTACTED') AND h.type IN ('CALL','CHAT','DOCTOR_REVIEW')) AS activeHumanTasks
    FROM patients p JOIN conversations c ON c.id=(SELECT c2.id FROM conversations c2 WHERE c2.patient_id=p.id ORDER BY c2.last_message_at DESC LIMIT 1)`,
    )
    .all() as Array<Record<string, unknown>>;
  const eligible: OutreachCandidate[] = [];
  const wait: Array<{ id: string; reason: string }> = [];
  for (const row of rows) {
    const gate = outreachEligibility(row);
    if (!gate.eligible) {
      wait.push({ id: String(row.id), reason: gate.reason });
      continue;
    }
    const lastMarketingAt = row.lastMarketingAt
      ? String(row.lastMarketingAt)
      : null;
    const daysSinceMarketing = lastMarketingAt
      ? (now.getTime() - new Date(lastMarketingAt).getTime()) / 86400000
      : Infinity;
    const reservation = db
      .prepare(
        "SELECT reserved_until AS reservedUntil FROM marketing_patient_cooldown WHERE patient_id=?",
      )
      .get(row.id) as { reservedUntil: string } | undefined;
    const activeInbound =
      row.lastInboundAt &&
      now.getTime() - new Date(String(row.lastInboundAt)).getTime() <
        24 * 3600000;
    if (
      daysSinceMarketing < cooldownDays() ||
      (reservation &&
        new Date(reservation.reservedUntil).getTime() > now.getTime())
    ) {
      wait.push({ id: String(row.id), reason: "COOLDOWN" });
      continue;
    }
    if (Number(row.activeAppointments)) {
      wait.push({ id: String(row.id), reason: "ACTIVE_APPOINTMENT" });
      continue;
    }
    if (Number(row.activeHumanTasks)) {
      wait.push({ id: String(row.id), reason: "STAFF_HANDLING" });
      continue;
    }
    if (activeInbound) {
      wait.push({ id: String(row.id), reason: "ACTIVE_CONVERSATION" });
      continue;
    }
    if (row.leadStage === "not_interested") {
      wait.push({ id: String(row.id), reason: "NOT_INTERESTED" });
      continue;
    }
    const decision = calculateReactivationDecision(
      {
        ...row,
        doNotContact: Number(row.doNotContact),
        invalidPhone: Number(row.invalidPhone),
        leadScore: Number(row.leadScore),
        inboundCount: Number(row.inboundCount),
        priceQuestions: Number(row.priceQuestions),
        bookingQuestions: Number(row.bookingQuestions),
        callRequests: Number(row.callRequests),
        missedAppointments: Number(row.missedAppointments),
        activeAppointments: Number(row.activeAppointments),
        activeHumanTasks: Number(row.activeHumanTasks),
        marketingCount: Number(row.marketingCount),
        lastContactAt: row.lastContactAt ? String(row.lastContactAt) : null,
        nextFollowupAt: row.nextFollowupAt ? String(row.nextFollowupAt) : null,
        treatmentSlug: row.treatmentSlug ? String(row.treatmentSlug) : null,
        leadStage: String(row.leadStage),
        whatsappOptInStatus: String(row.whatsappOptInStatus),
      },
      now,
    );
    const suggestedAction =
      decision.action === "CALL"
        ? "CALL"
        : decision.action === "AUTO_WHATSAPP" ||
            decision.action === "MANUAL_WHATSAPP"
          ? "MANUAL_FOLLOWUP"
          : decision.action === "DO_NOT_CONTACT"
            ? "NO_CONTACT"
            : "WAIT";
    db.prepare(
      "UPDATE patients SET reactivation_score=?,reactivation_reasons_json=?,reactivation_action=?,updated_at=? WHERE id=?",
    ).run(
      decision.score,
      JSON.stringify(decision.reasons),
      decision.action,
      now.toISOString(),
      row.id,
    );
    if (
      Number(row.previousReactivationScore || 0) !== decision.score ||
      String(row.previousReactivationAction || "WAIT") !== decision.action
    ) {
      db.prepare(
        "INSERT INTO audit_logs (id,actor,action,entity_type,entity_id,summary,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?)",
      ).run(
        makeId("aud"),
        "SYSTEM",
        "OUTREACH_SCORED",
        "patient",
        row.id,
        `Reactivation ${decision.score} → ${decision.action}`,
        JSON.stringify({ patientId: row.id, reasons: decision.reasons }),
        now.toISOString(),
      );
    }
    eligible.push({
      id: String(row.id),
      name: String(row.name),
      phone: String(row.phone),
      conversationId: String(row.conversationId),
      leadScore: Number(row.leadScore || 0),
      priority: decision.score,
      reasons: decision.reasons,
      reactivationAction: decision.action,
      suggestedAction,
      lastMarketingAt,
    });
  }
  eligible.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  return { eligible, wait };
}

export function outreachDryRun(campaignId?: string) {
  const { eligible, wait } = rankOutreachCandidates();
  const used = marketingUsed();
  const limit = marketingLimit();
  const available = Math.max(0, limit - used);
  const db = getDatabase();
  const campaign = campaignId
    ? (db
        .prepare(
          "SELECT t.category,t.status,t.meta_template_name AS metaTemplateName FROM campaigns c JOIN message_templates t ON t.id=c.template_id WHERE c.id=?",
        )
        .get(campaignId) as
        | { category: string; status: string; metaTemplateName: string | null }
        | undefined)
    : null;
  const templateReady = campaign
    ? campaign.category === "MARKETING" &&
      campaign.status === "APPROVED" &&
      Boolean(campaign.metaTemplateName)
    : false;
  const automatic = eligible.filter(
    (item) => item.reactivationAction === "AUTO_WHATSAPP",
  );
  const selected = automatic.slice(0, available);
  const directHuman = eligible.filter(
    (item) =>
      item.reactivationAction === "CALL" ||
      item.reactivationAction === "MANUAL_WHATSAPP",
  );
  const humanOpportunity = [...directHuman, ...automatic.slice(available)]
    .filter(
      (item, index, list) =>
        list.findIndex((other) => other.id === item.id) === index &&
        item.priority >= 50,
    )
    .slice(0, 12);
  return {
    day: marketingDay(),
    limit,
    used,
    available,
    eligibleToday: eligible.length,
    selected,
    humanOpportunity,
    waitCount:
      wait.length +
      Math.max(0, eligible.length - selected.length - humanOpportunity.length),
    blocked: wait,
    templateReady,
    sendsAllowed: templateReady && available > 0,
  };
}
