import { makeId, nowIso } from "@/db";
import { getMessageChannel } from "@/lib/channels";
import {
  addAudit,
  addEvent,
  addMessage,
  createHumanTask,
  ensurePatientForChannel,
  getPatientContext,
  ready,
  updateConversationState,
  updatePatient,
} from "@/lib/services/repository";
import { normalizeStaffPhone } from "./staff-mode";

export const leadSources = [
  "GOOGLE_ORGANIC",
  "GOOGLE_ADS",
  "META_ADS",
  "INSTAGRAM",
  "WEBSITE",
  "GBP",
  "WHATSAPP",
  "PHONE",
  "REFERRAL",
  "MANUAL",
  "CSV",
  "OTHER",
] as const;
export const lostReasons = [
  "PRICE",
  "COMPARING_CLINICS",
  "TRUST",
  "TIMING",
  "FAMILY_DECISION",
  "FEAR",
  "NO_RESPONSE",
  "NOT_INTERESTED",
  "NOT_ELIGIBLE",
  "OTHER",
] as const;
export const approvalStatuses = [
  "DRAFT",
  "NEEDS_REVIEW",
  "APPROVED",
  "ARCHIVED",
] as const;

export function createManualLead(input: {
  name: string;
  phone: string;
  email?: string | null;
  source: string;
  primaryConcern?: string | null;
  treatmentCategory?: string | null;
  treatmentSlug?: string | null;
  context?: string | null;
  previousInteraction?: string | null;
  leadStatus?: string;
  leadPriority?: string;
  preferredLanguage?: string;
  followupAt?: string | null;
  callbackAt?: string | null;
  assignedTo?: string | null;
  whatsappConsent?: string;
  doNotContact?: boolean;
  internalNotes?: string | null;
  nextAction?: string;
}) {
  const phone = normalizeStaffPhone(input.phone);
  if (!phone) throw new Error("Enter a valid Indian mobile number.");
  const db = ready();
  if (db.prepare("SELECT id FROM patients WHERE phone=? LIMIT 1").get(phone))
    throw new Error("A lead with this phone number already exists.");
  const context = ensurePatientForChannel({
    phone,
    name: input.name.trim(),
    channel: "manual",
  });
  const patientId = String(context.patient.id);
  const conversationId = String(context.conversation.id);
  updatePatient(patientId, {
    name: input.name.trim(),
    nameSource: "manual",
    nameVerified: true,
    email: input.email || null,
    source: leadSources.includes(input.source as (typeof leadSources)[number])
      ? input.source
      : "MANUAL",
    primaryConcern: input.primaryConcern || null,
    treatmentCategory: input.treatmentCategory || null,
    treatmentSlug: input.treatmentSlug || null,
    contextNotes: input.context || null,
    previousInteraction: input.previousInteraction || null,
    internalNotes: input.internalNotes || null,
    leadStage: input.leadStatus || "new",
    leadPriority: input.leadPriority || "NORMAL",
    preferredLanguage: input.preferredLanguage || "AUTO",
    nextFollowupAt: input.followupAt || null,
    callbackAt: input.callbackAt || null,
    assignedTo: input.assignedTo || "AI Reception",
    whatsappOptInStatus: input.whatsappConsent || "UNKNOWN",
    doNotContact: Boolean(input.doNotContact),
    contactLifecycle: "LEAD",
  });
  updateConversationState(conversationId, {
    preferredLanguage: input.preferredLanguage || "AUTO",
    currentConcern: input.primaryConcern || null,
    currentTreatment: input.treatmentSlug || null,
    rollingSummary:
      [input.context, input.previousInteraction]
        .filter(Boolean)
        .join(" ")
        .slice(0, 1200) || null,
    nextBestAction:
      input.nextAction ||
      (input.callbackAt
        ? "CALL"
        : input.followupAt
          ? "MANUAL_FOLLOWUP"
          : "ANSWER"),
    nextActionReason: "Set during manual lead creation",
  });
  if (input.callbackAt)
    createHumanTask({
      patientId,
      conversationId,
      type: "CALLBACK",
      priority:
        input.leadPriority === "URGENT"
          ? "URGENT"
          : input.leadPriority === "HIGH"
            ? "HIGH"
            : "NORMAL",
      title: "Callback due",
      reason:
        input.context ||
        input.previousInteraction ||
        "Patient requested a callback",
      dueAt: input.callbackAt,
    });
  addEvent(
    patientId,
    conversationId,
    "LEAD_CREATED",
    "Manual lead created",
    "No automatic message was sent.",
    { source: input.source },
  );
  if (input.context || input.previousInteraction)
    addEvent(
      patientId,
      conversationId,
      "CONTEXT_UPDATED",
      "Lead context saved",
      "Internal context is available to reception without being quoted verbatim.",
    );
  addAudit(
    "LEAD_CREATED",
    "patient",
    patientId,
    "Manual lead created without outbound contact",
    "RECEPTION",
    { source: input.source },
  );
  return { patientId, conversationId };
}

export function getTreatmentCatalog() {
  const db = ready();
  return {
    categories: db
      .prepare(
        "SELECT id,name,slug,description,status,active,sort_order AS sortOrder,created_at AS createdAt,updated_at AS updatedAt FROM treatment_categories ORDER BY sort_order,name",
      )
      .all(),
    concerns: db
      .prepare(
        "SELECT id,category_id AS categoryId,name,slug,description,treatment_slugs_json AS treatmentSlugsJson,approved_explanation AS approvedExplanation,benefits_json AS benefitsJson,conversation_options_json AS conversationOptionsJson,status,active,sort_order AS sortOrder,created_at AS createdAt,updated_at AS updatedAt FROM concerns ORDER BY sort_order,name",
      )
      .all(),
    treatments: db
      .prepare(
        "SELECT id,name,slug,category,description,approved_response_guidance AS approvedResponseGuidance,benefits_json AS benefitsJson,conversation_options_json AS conversationOptionsJson,approval_status AS approvalStatus,active,booking_enabled AS bookingEnabled,created_at AS createdAt,updated_at AS updatedAt FROM treatments ORDER BY category,name",
      )
      .all(),
    prices: db
      .prepare(
        "SELECT id,treatment_id AS treatmentId,concern_id AS concernId,pricing_type AS pricingType,min_price AS minPrice,max_price AS maxPrice,unit,currency,display_text AS displayText,pricing_note AS pricingNote,requires_assessment AS requiresAssessment,approved_for_patient_display AS approvedForPatientDisplay,source,approval_status AS approvalStatus,active,created_at AS createdAt,updated_at AS updatedAt FROM treatment_prices ORDER BY approval_status,treatment_id",
      )
      .all(),
    knowledge: db
      .prepare(
        "SELECT id,title,item_type AS itemType,treatment_id AS treatmentId,concern_id AS concernId,content,source,approval_status AS approvalStatus,approved_by AS approvedBy,approved_at AS approvedAt,active,created_at AS createdAt,updated_at AS updatedAt FROM knowledge_items ORDER BY created_at DESC",
      )
      .all(),
  };
}

export function saveCatalogItem(
  kind: "category" | "concern" | "treatment" | "price" | "knowledge",
  input: Record<string, unknown>,
) {
  const db = ready();
  const now = nowIso();
  const id = String(input.id || makeId(kind));
  if (kind === "category") {
    db.prepare(
      "INSERT INTO treatment_categories (id,name,slug,description,status,active,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(slug) DO UPDATE SET name=excluded.name,description=excluded.description,status=excluded.status,active=excluded.active,sort_order=excluded.sort_order,updated_at=excluded.updated_at",
    ).run(
      id,
      String(input.name),
      String(input.slug),
      input.description || null,
      String(input.status || "DRAFT"),
      Number(input.active !== false),
      Number(input.sortOrder || 0),
      now,
      now,
    );
  } else if (kind === "concern") {
    db.prepare(
      "INSERT INTO concerns (id,category_id,name,slug,description,treatment_slugs_json,approved_explanation,benefits_json,conversation_options_json,status,active,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(slug) DO UPDATE SET category_id=excluded.category_id,name=excluded.name,description=excluded.description,treatment_slugs_json=excluded.treatment_slugs_json,approved_explanation=excluded.approved_explanation,benefits_json=excluded.benefits_json,conversation_options_json=excluded.conversation_options_json,status=excluded.status,active=excluded.active,sort_order=excluded.sort_order,updated_at=excluded.updated_at",
    ).run(
      id,
      String(input.categoryId),
      String(input.name),
      String(input.slug),
      input.description || null,
      JSON.stringify(input.treatmentSlugs || []),
      input.approvedExplanation || null,
      JSON.stringify(input.benefits || []),
      JSON.stringify(input.conversationOptions || []),
      String(input.status || "NEEDS_REVIEW"),
      Number(input.active !== false),
      Number(input.sortOrder || 0),
      now,
      now,
    );
  } else if (kind === "treatment") {
    const status = String(input.approvalStatus || "DRAFT");
    db.prepare(
      "INSERT INTO treatments (id,name,slug,category,description,approved_response_guidance,benefits_json,conversation_options_json,approval_status,active,booking_enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(slug) DO UPDATE SET name=excluded.name,category=excluded.category,description=excluded.description,approved_response_guidance=excluded.approved_response_guidance,benefits_json=excluded.benefits_json,conversation_options_json=excluded.conversation_options_json,approval_status=excluded.approval_status,active=excluded.active,booking_enabled=excluded.booking_enabled,updated_at=excluded.updated_at",
    ).run(
      id,
      String(input.name),
      String(input.slug),
      String(input.category),
      String(input.description || ""),
      String(
        input.approvedResponseGuidance ||
          "Suitability and final treatment planning require doctor assessment.",
      ),
      JSON.stringify(input.benefits || []),
      JSON.stringify(input.conversationOptions || []),
      status,
      Number(input.active !== false && status !== "ARCHIVED"),
      Number(input.bookingEnabled !== false),
      now,
      now,
    );
  } else if (kind === "price") {
    const status = String(input.approvalStatus || "NEEDS_REVIEW");
    db.prepare(
      "INSERT INTO treatment_prices (id,treatment_id,concern_id,pricing_type,min_price,max_price,unit,currency,display_text,pricing_note,requires_assessment,approved_for_patient_display,source,approval_status,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET treatment_id=excluded.treatment_id,concern_id=excluded.concern_id,pricing_type=excluded.pricing_type,min_price=excluded.min_price,max_price=excluded.max_price,unit=excluded.unit,display_text=excluded.display_text,pricing_note=excluded.pricing_note,requires_assessment=excluded.requires_assessment,approved_for_patient_display=excluded.approved_for_patient_display,source=excluded.source,approval_status=excluded.approval_status,active=excluded.active,updated_at=excluded.updated_at",
    ).run(
      id,
      String(input.treatmentId),
      input.concernId || null,
      String(input.pricingType),
      input.minPrice ?? null,
      input.maxPrice ?? null,
      input.unit || null,
      "INR",
      String(input.displayText),
      input.pricingNote || null,
      Number(input.requiresAssessment !== false),
      Number(status === "APPROVED" && Boolean(input.approvedForPatientDisplay)),
      String(input.source || "ADMIN"),
      status,
      Number(input.active !== false),
      now,
      now,
    );
  } else {
    const status = String(input.approvalStatus || "DRAFT");
    db.prepare(
      "INSERT INTO knowledge_items (id,title,item_type,treatment_id,concern_id,content,source,approval_status,approved_by,approved_at,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,item_type=excluded.item_type,treatment_id=excluded.treatment_id,concern_id=excluded.concern_id,content=excluded.content,source=excluded.source,approval_status=excluded.approval_status,approved_by=excluded.approved_by,approved_at=excluded.approved_at,active=excluded.active,updated_at=excluded.updated_at",
    ).run(
      id,
      String(input.title),
      String(input.itemType || "GUIDANCE"),
      input.treatmentId || null,
      input.concernId || null,
      String(input.content),
      String(input.source || "ADMIN"),
      status,
      status === "APPROVED" ? String(input.approvedBy || "Doctor/Admin") : null,
      status === "APPROVED" ? now : null,
      Number(input.active !== false),
      now,
      now,
    );
  }
  addAudit(
    String(input.status || input.approvalStatus) === "APPROVED"
      ? "KNOWLEDGE_APPROVED"
      : "KNOWLEDGE_DRAFTED",
    kind,
    id,
    `${kind} saved`,
    "ADMIN",
  );
  return id;
}

export function addAiFeedback(input: {
  messageId: string;
  patientId: string;
  rating: "GOOD" | "NEEDS_IMPROVEMENT";
  reason?: string | null;
  notes?: string | null;
}) {
  const message = ready()
    .prepare(
      "SELECT id FROM messages WHERE id=? AND patient_id=? AND sender_type='ai'",
    )
    .get(input.messageId, input.patientId);
  if (!message) throw new Error("AI message not found.");
  const id = makeId("feedback");
  ready()
    .prepare(
      "INSERT INTO ai_feedback (id,message_id,patient_id,rating,reason,notes,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      input.messageId,
      input.patientId,
      input.rating,
      input.reason || null,
      input.notes || null,
      "Front Desk",
      nowIso(),
    );
  addAudit(
    "AI_FEEDBACK",
    "message",
    input.messageId,
    input.rating,
    "RECEPTION",
    { patientId: input.patientId, reason: input.reason || null },
  );
  return id;
}

export async function resolveDoctorReview(input: {
  reviewId: string;
  doctorResponse: string;
  saveAsGuidance?: boolean;
}) {
  const db = ready();
  const review = db
    .prepare(
      "SELECT id,patient_id AS patientId,conversation_id AS conversationId,question_summary AS questionSummary,status FROM doctor_reviews WHERE id=?",
    )
    .get(input.reviewId) as Record<string, unknown> | undefined;
  if (!review || review.status !== "OPEN")
    throw new Error("Open doctor review not found.");
  const response = input.doctorResponse.trim();
  const patientReply = /(?:visit|come|tomorrow|morning|evening|clinic)/i.test(
    response,
  )
    ? "The doctor would like you to visit the clinic so this can be assessed properly. Would you like to book a consultation?"
    : `The clinical team has reviewed your question. ${response.replace(/\b(?:I|we)\s+(?:told|said|asked)\b/gi, "They advised").slice(0, 700)}`;
  const now = nowIso();
  db.prepare(
    "UPDATE doctor_reviews SET status='RESOLVED',doctor_response=?,patient_reply=?,save_as_guidance=?,resolved_at=?,updated_at=? WHERE id=?",
  ).run(
    response,
    patientReply,
    Number(Boolean(input.saveAsGuidance)),
    now,
    now,
    input.reviewId,
  );
  const context = getPatientContext(String(review.patientId));
  if (!context) throw new Error("Patient not found.");
  const delivery = await getMessageChannel().sendText({
    to: String(context.patient.phone),
    text: patientReply,
  });
  addMessage({
    patientId: String(review.patientId),
    conversationId: String(review.conversationId),
    direction: "outbound",
    senderType: "ai",
    content: patientReply,
    externalMessageId: delivery.id,
    deliveryStatus: delivery.status,
    metadata: { doctorReviewId: input.reviewId },
  });
  if (input.saveAsGuidance)
    saveCatalogItem("knowledge", {
      title: `Draft from review: ${String(review.questionSummary).slice(0, 90)}`,
      itemType: "CLINIC_GUIDANCE",
      content: response,
      source: "DOCTOR_REVIEW",
      approvalStatus: "DRAFT",
    });
  db.prepare(
    "UPDATE human_tasks SET status='RESOLVED',resolved_at=?,resolved_by='Doctor',resolution=?,updated_at=? WHERE patient_id=? AND type='DOCTOR_REVIEW' AND status='OPEN'",
  ).run(now, response, now, review.patientId);
  addAudit(
    "DOCTOR_REVIEW_RESOLVED",
    "doctor_review",
    input.reviewId,
    "Patient-specific response sent",
    "ADMIN",
    {
      patientId: review.patientId,
      guidanceDrafted: Boolean(input.saveAsGuidance),
    },
  );
  return { patientReply, guidanceDrafted: Boolean(input.saveAsGuidance) };
}

export function answerRadianceQuestion(question: string) {
  const db = ready();
  const text = question.toLowerCase();
  let answer: string;
  let intent: string;
  if (/source.*(?:book|convert)|which source|most bookings/.test(text)) {
    intent = "SOURCE_BOOKINGS";
    const rows = db
      .prepare(
        "SELECT p.source,COUNT(DISTINCT p.id) AS leads,SUM(CASE WHEN a.status IN ('confirmed','completed') THEN 1 ELSE 0 END) AS appointments FROM patients p LEFT JOIN appointments a ON a.patient_id=p.id GROUP BY p.source ORDER BY appointments DESC,leads DESC",
      )
      .all() as Array<Record<string, unknown>>;
    answer = rows.length
      ? `Source performance (sample sizes shown):\n${rows.map((r) => `${r.source}: ${Number(r.appointments || 0)} appointments from ${Number(r.leads)} leads`).join("\n")}`
      : "No source data is available yet.";
  } else if (/objection|why.*lost|loss reasons?/.test(text)) {
    intent = "OBJECTIONS";
    const rows = db
      .prepare(
        "SELECT COALESCE(cs.primary_objection,p.lost_reason,'NONE') AS reason,COUNT(*) AS sample FROM patients p LEFT JOIN conversations c ON c.patient_id=p.id LEFT JOIN conversation_state cs ON cs.conversation_id=c.id GROUP BY COALESCE(cs.primary_objection,p.lost_reason,'NONE') ORDER BY sample DESC",
      )
      .all() as Array<Record<string, unknown>>;
    answer = `Recorded objections/loss reasons:\n${rows.map((r) => `${r.reason}: ${Number(r.sample)} leads`).join("\n")}`;
  } else if (/callback/.test(text)) {
    intent = "CALLBACKS";
    const count = (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM patients WHERE callback_at IS NOT NULL AND callback_at<=? AND lead_stage NOT IN ('lost','not_interested')",
        )
        .get(nowIso()) as { count: number }
    ).count;
    answer = `${Number(count)} callbacks are due.`;
  } else if (/valuable|hot leads?|best leads?/.test(text)) {
    intent = "TOP_LEADS";
    const rows = db
      .prepare(
        "SELECT name,treatment_slug AS treatment,lead_score AS score,reactivation_score AS reactivationScore FROM patients WHERE lead_stage NOT IN ('booked','lost','not_interested') ORDER BY lead_score DESC LIMIT 10",
      )
      .all() as Array<Record<string, unknown>>;
    answer = rows.length
      ? `Most valuable current leads:\n${rows.map((r, index) => `${index + 1}. ${r.name} — ${String(r.treatment || "general enquiry").replaceAll("_", " ")} — lead ${Number(r.score)} · reactivation ${Number(r.reactivationScore || 0)}`).join("\n")}`
      : "There are no open leads.";
  } else if (/treatment.*enquir|most enquir/.test(text)) {
    intent = "TREATMENT_ENQUIRIES";
    const rows = db
      .prepare(
        "SELECT COALESCE(treatment_slug,'unclassified') AS treatment,COUNT(*) AS sample FROM patients GROUP BY treatment_slug ORDER BY sample DESC",
      )
      .all() as Array<Record<string, unknown>>;
    answer = `Treatment enquiries (sample sizes shown):\n${rows.map((r) => `${String(r.treatment).replaceAll("_", " ")}: ${Number(r.sample)}`).join("\n")}`;
  } else {
    intent = "HELP";
    answer =
      "Ask about source bookings, treatment enquiries, objections, callbacks, or the most valuable current leads. Results are calculated from the CRM database.";
  }
  addAudit(
    "ASK_RADIANCE",
    "analytics_query",
    makeId("ask"),
    `Deterministic ${intent} query`,
    "ADMIN",
    { question: question.slice(0, 300), answer: answer.slice(0, 800) },
  );
  return { intent, answer };
}
