import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
};

export const patients = sqliteTable("patients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  nameSource: text("name_source").notNull().default("whatsapp_profile"),
  nameVerified: integer("name_verified", { mode: "boolean" })
    .notNull()
    .default(false),
  phone: text("phone").notNull().unique(),
  email: text("email"),
  age: integer("age"),
  gender: text("gender"),
  primaryConcern: text("primary_concern"),
  concernDuration: text("concern_duration"),
  treatmentCategory: text("treatment_category"),
  treatmentSlug: text("treatment_slug"),
  leadScore: integer("lead_score").notNull().default(10),
  leadTemperature: text("lead_temperature").notNull().default("COLD"),
  leadStage: text("lead_stage").notNull().default("new"),
  source: text("source").notNull().default("whatsapp"),
  campaign: text("campaign"),
  aiSummary: text("ai_summary"),
  contextNotes: text("context_notes"),
  previousInteraction: text("previous_interaction"),
  internalNotes: text("internal_notes"),
  leadPriority: text("lead_priority").notNull().default("NORMAL"),
  preferredLanguage: text("preferred_language").notNull().default("AUTO"),
  callbackAt: text("callback_at"),
  contactLifecycle: text("contact_lifecycle").notNull().default("LEAD"),
  lostReason: text("lost_reason"),
  reactivationScore: integer("reactivation_score").notNull().default(0),
  reactivationReasonsJson: text("reactivation_reasons_json")
    .notNull()
    .default("[]"),
  reactivationAction: text("reactivation_action").notNull().default("WAIT"),
  assignedTo: text("assigned_to").default("AI Reception"),
  aiEnabled: integer("ai_enabled", { mode: "boolean" }).notNull().default(true),
  whatsappId: text("whatsapp_id"),
  whatsappOptInStatus: text("whatsapp_opt_in_status")
    .notNull()
    .default("UNKNOWN"),
  whatsappOptInDate: text("whatsapp_opt_in_date"),
  whatsappOptInSource: text("whatsapp_opt_in_source"),
  doNotContact: integer("do_not_contact", { mode: "boolean" })
    .notNull()
    .default(false),
  invalidPhone: integer("invalid_phone", { mode: "boolean" })
    .notNull()
    .default(false),
  lastInboundAt: text("last_inbound_at"),
  lastOutboundAt: text("last_outbound_at"),
  serviceWindowExpiresAt: text("service_window_expires_at"),
  lastContactAt: text("last_contact_at"),
  nextFollowupAt: text("next_followup_at"),
  ...timestamps,
});

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  patientId: text("patient_id")
    .notNull()
    .references(() => patients.id, { onDelete: "cascade" }),
  channel: text("channel").notNull().default("whatsapp"),
  status: text("status").notNull().default("open"),
  unreadCount: integer("unread_count").notNull().default(0),
  aiEnabled: integer("ai_enabled", { mode: "boolean" }).notNull().default(true),
  lastMessageAt: text("last_message_at").notNull(),
  createdAt: text("created_at").notNull(),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  patientId: text("patient_id")
    .notNull()
    .references(() => patients.id, { onDelete: "cascade" }),
  direction: text("direction").notNull(),
  senderType: text("sender_type").notNull(),
  messageType: text("message_type").notNull().default("text"),
  content: text("content").notNull(),
  mediaUrl: text("media_url"),
  contentItemId: text("content_item_id"),
  deliveryStatus: text("delivery_status").notNull().default("delivered"),
  metadataJson: text("metadata_json"),
  externalMessageId: text("external_message_id"),
  createdAt: text("created_at").notNull(),
});

export const conversationState = sqliteTable("conversation_state", {
  conversationId: text("conversation_id")
    .primaryKey()
    .references(() => conversations.id, { onDelete: "cascade" }),
  preferredLanguage: text("preferred_language").notNull().default("AUTO"),
  activeFlow: text("active_flow"),
  pendingQuestion: text("pending_question"),
  pendingAction: text("pending_action"),
  lastAssistantQuestion: text("last_assistant_question"),
  requestedDate: text("requested_date"),
  requestedTime: text("requested_time"),
  requestedDayPart: text("requested_day_part"),
  offeredSlotsJson: text("offered_slots_json").notNull().default("[]"),
  selectedSlot: text("selected_slot"),
  appointmentId: text("appointment_id"),
  currentConcern: text("current_concern"),
  currentTreatment: text("current_treatment"),
  previousTreatment: integer("previous_treatment", { mode: "boolean" })
    .notNull()
    .default(false),
  rollingSummary: text("rolling_summary"),
  sentContentIdsJson: text("sent_content_ids_json").notNull().default("[]"),
  lastContentSentAt: text("last_content_sent_at"),
  aiMode: text("ai_mode").notNull().default("AI"),
  humanLockUntil: text("human_lock_until"),
  conversationPhase: text("conversation_phase").notNull().default("DISCOVERY"),
  readinessScore: integer("readiness_score").notNull().default(0),
  readinessReason: text("readiness_reason"),
  primaryObjection: text("primary_objection"),
  nextBestAction: text("next_best_action").notNull().default("ANSWER"),
  nextActionReason: text("next_action_reason"),
  bookingDeclinedForNow: integer("booking_declined_for_now", {
    mode: "boolean",
  })
    .notNull()
    .default(false),
  conversionMemoryJson: text("conversion_memory_json").notNull().default("{}"),
  interactionType: text("interaction_type").notNull().default("NONE"),
  interactionOptionsJson: text("interaction_options_json")
    .notNull()
    .default("[]"),
  lastOptionSelected: text("last_option_selected"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const treatments = sqliteTable("treatments", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  approvedResponseGuidance: text("approved_response_guidance").notNull(),
  benefitsJson: text("benefits_json").notNull().default("[]"),
  conversationOptionsJson: text("conversation_options_json")
    .notNull()
    .default("[]"),
  approvalStatus: text("approval_status").notNull().default("APPROVED"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  bookingEnabled: integer("booking_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  ...timestamps,
});

export const contentItems = sqliteTable("content_items", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  url: text("url").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  treatmentSlug: text("treatment_slug"),
  tagsJson: text("tags_json").notNull().default("[]"),
  whenToSend: text("when_to_send").notNull(),
  priority: integer("priority").notNull().default(1),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  approvedForAi: integer("approved_for_ai", { mode: "boolean" })
    .notNull()
    .default(true),
  approvedForProduction: integer("approved_for_production", { mode: "boolean" })
    .notNull()
    .default(false),
  approvalStatus: text("approval_status").notNull().default("NEEDS_REVIEW"),
  createdAt: text("created_at").notNull(),
});

export const appointments = sqliteTable("appointments", {
  id: text("id").primaryKey(),
  patientId: text("patient_id")
    .notNull()
    .references(() => patients.id),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id),
  treatmentSlug: text("treatment_slug"),
  dateTime: text("date_time").notNull(),
  status: text("status").notNull().default("confirmed"),
  notes: text("notes"),
  bookingKey: text("booking_key"),
  ...timestamps,
});

export const scheduledJobs = sqliteTable("scheduled_jobs", {
  id: text("id").primaryKey(),
  patientId: text("patient_id")
    .notNull()
    .references(() => patients.id),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id),
  appointmentId: text("appointment_id").references(() => appointments.id),
  jobType: text("job_type").notNull(),
  scheduledFor: text("scheduled_for").notNull(),
  status: text("status").notNull().default("pending"),
  payloadJson: text("payload_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  executedAt: text("executed_at"),
  error: text("error"),
});

export const aiEvents = sqliteTable("ai_events", {
  id: text("id").primaryKey(),
  patientId: text("patient_id")
    .notNull()
    .references(() => patients.id, { onDelete: "cascade" }),
  conversationId: text("conversation_id").references(() => conversations.id, {
    onDelete: "cascade",
  }),
  eventType: text("event_type").notNull(),
  title: text("title").notNull(),
  details: text("details"),
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const availableSlots = sqliteTable("available_slots", {
  id: text("id").primaryKey(),
  date: text("date").notNull(),
  time: text("time").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const humanTasks = sqliteTable("human_tasks", {
  id: text("id").primaryKey(),
  patientId: text("patient_id")
    .notNull()
    .references(() => patients.id, { onDelete: "cascade" }),
  conversationId: text("conversation_id").references(() => conversations.id, {
    onDelete: "cascade",
  }),
  type: text("type").notNull(),
  priority: text("priority").notNull().default("NORMAL"),
  status: text("status").notNull().default("OPEN"),
  title: text("title").notNull(),
  reason: text("reason"),
  suggestedReply: text("suggested_reply"),
  assignedTo: text("assigned_to"),
  dueAt: text("due_at"),
  resolvedAt: text("resolved_at"),
  resolvedBy: text("resolved_by"),
  resolution: text("resolution"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const leadScoreEvents = sqliteTable("lead_score_events", {
  id: text("id").primaryKey(),
  patientId: text("patient_id")
    .notNull()
    .references(() => patients.id, { onDelete: "cascade" }),
  conversationId: text("conversation_id").references(() => conversations.id, {
    onDelete: "cascade",
  }),
  previousScore: integer("previous_score").notNull(),
  newScore: integer("new_score").notNull(),
  reasonCodesJson: text("reason_codes_json").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
});

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  summary: text("summary").notNull(),
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
});

export const providerUsage = sqliteTable("provider_usage", {
  id: text("id").primaryKey(),
  patientId: text("patient_id").references(() => patients.id, {
    onDelete: "set null",
  }),
  conversationId: text("conversation_id").references(() => conversations.id, {
    onDelete: "set null",
  }),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  operation: text("operation").notNull(),
  status: text("status").notNull(),
  latencyMs: integer("latency_ms").notNull().default(0),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  estimatedCostUsd: text("estimated_cost_usd"),
  errorCode: text("error_code"),
  fallbackReason: text("fallback_reason"),
  createdAt: text("created_at").notNull(),
});

export const leadImports = sqliteTable("lead_imports", {
  id: text("id").primaryKey(),
  fileName: text("file_name").notNull(),
  status: text("status").notNull(),
  totalRows: integer("total_rows").notNull().default(0),
  importedRows: integer("imported_rows").notNull().default(0),
  skippedRows: integer("skipped_rows").notNull().default(0),
  errorRows: integer("error_rows").notNull().default(0),
  errorsJson: text("errors_json").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at"),
});

export const messageTemplates = sqliteTable("message_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  displayName: text("display_name"),
  category: text("category").notNull().default("MARKETING"),
  language: text("language").notNull().default("en"),
  body: text("body").notNull(),
  metaTemplateName: text("meta_template_name"),
  status: text("status").notNull().default("DRAFT"),
  variablesJson: text("variables_json").notNull().default("[]"),
  purpose: text("purpose"),
  treatmentSlug: text("treatment_slug"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const campaigns = sqliteTable("campaigns", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  templateId: text("template_id")
    .notNull()
    .references(() => messageTemplates.id),
  status: text("status").notNull().default("DRAFT"),
  audienceJson: text("audience_json").notNull().default("{}"),
  segment: text("segment").notNull().default("eligible_all"),
  scheduledFor: text("scheduled_for"),
  ratePerMinute: integer("rate_per_minute").notNull().default(10),
  createdBy: text("created_by").notNull().default("Front Desk"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
});

export const outboundMessages = sqliteTable("outbound_messages", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").references(() => campaigns.id, {
    onDelete: "set null",
  }),
  patientId: text("patient_id")
    .notNull()
    .references(() => patients.id, { onDelete: "cascade" }),
  conversationId: text("conversation_id").references(() => conversations.id, {
    onDelete: "set null",
  }),
  templateId: text("template_id").references(() => messageTemplates.id, {
    onDelete: "set null",
  }),
  channel: text("channel").notNull().default("local"),
  renderedBody: text("rendered_body").notNull(),
  payloadJson: text("payload_json").notNull().default("{}"),
  status: text("status").notNull().default("QUEUED"),
  externalMessageId: text("external_message_id"),
  scheduledFor: text("scheduled_for").notNull(),
  sentAt: text("sent_at"),
  deliveredAt: text("delivered_at"),
  readAt: text("read_at"),
  repliedAt: text("replied_at"),
  failedAt: text("failed_at"),
  failureCode: text("failure_code"),
  failureMessage: text("failure_message"),
  metaMessageId: text("meta_message_id"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
});

export const webhookEvents = sqliteTable("webhook_events", {
  id: text("id").primaryKey(),
  externalId: text("external_id").notNull().unique(),
  eventType: text("event_type").notNull(),
  payloadHash: text("payload_hash").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  processedAt: text("processed_at"),
});

export const treatmentCategories = sqliteTable("treatment_categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  status: text("status").notNull().default("APPROVED"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
});

export const concerns = sqliteTable("concerns", {
  id: text("id").primaryKey(),
  categoryId: text("category_id")
    .notNull()
    .references(() => treatmentCategories.id),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  treatmentSlugsJson: text("treatment_slugs_json").notNull().default("[]"),
  approvedExplanation: text("approved_explanation"),
  benefitsJson: text("benefits_json").notNull().default("[]"),
  conversationOptionsJson: text("conversation_options_json")
    .notNull()
    .default("[]"),
  status: text("status").notNull().default("NEEDS_REVIEW"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
});

export const treatmentPrices = sqliteTable("treatment_prices", {
  id: text("id").primaryKey(),
  treatmentId: text("treatment_id").notNull(),
  concernId: text("concern_id"),
  pricingType: text("pricing_type").notNull(),
  minPrice: integer("min_price"),
  maxPrice: integer("max_price"),
  unit: text("unit"),
  currency: text("currency").notNull().default("INR"),
  displayText: text("display_text").notNull(),
  pricingNote: text("pricing_note"),
  requiresAssessment: integer("requires_assessment", { mode: "boolean" })
    .notNull()
    .default(true),
  approvedForPatientDisplay: integer("approved_for_patient_display", {
    mode: "boolean",
  })
    .notNull()
    .default(false),
  source: text("source").notNull(),
  approvalStatus: text("approval_status").notNull().default("NEEDS_REVIEW"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
});

export const knowledgeItems = sqliteTable("knowledge_items", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  itemType: text("item_type").notNull(),
  treatmentId: text("treatment_id"),
  concernId: text("concern_id"),
  content: text("content").notNull(),
  source: text("source").notNull(),
  approvalStatus: text("approval_status").notNull().default("DRAFT"),
  approvedBy: text("approved_by"),
  approvedAt: text("approved_at"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
});

export const authorizedStaffContacts = sqliteTable(
  "authorized_staff_contacts",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    phone: text("phone").notNull().unique(),
    role: text("role").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    canViewSummaries: integer("can_view_summaries", { mode: "boolean" })
      .notNull()
      .default(false),
    canViewAppointments: integer("can_view_appointments", { mode: "boolean" })
      .notNull()
      .default(false),
    canReceiveDoctorReview: integer("can_receive_doctor_review", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    canApproveKnowledge: integer("can_approve_knowledge", { mode: "boolean" })
      .notNull()
      .default(false),
    canReceiveAlerts: integer("can_receive_alerts", { mode: "boolean" })
      .notNull()
      .default(false),
    ...timestamps,
  },
);

export const doctorReviews = sqliteTable("doctor_reviews", {
  id: text("id").primaryKey(),
  patientId: text("patient_id")
    .notNull()
    .references(() => patients.id, { onDelete: "cascade" }),
  conversationId: text("conversation_id").references(() => conversations.id, {
    onDelete: "cascade",
  }),
  questionSummary: text("question_summary").notNull(),
  priority: text("priority").notNull().default("NORMAL"),
  status: text("status").notNull().default("OPEN"),
  doctorResponse: text("doctor_response"),
  patientReply: text("patient_reply"),
  saveAsGuidance: integer("save_as_guidance", { mode: "boolean" })
    .notNull()
    .default(false),
  resolvedAt: text("resolved_at"),
  ...timestamps,
});

export const aiFeedback = sqliteTable("ai_feedback", {
  id: text("id").primaryKey(),
  messageId: text("message_id")
    .notNull()
    .references(() => messages.id, { onDelete: "cascade" }),
  patientId: text("patient_id")
    .notNull()
    .references(() => patients.id, { onDelete: "cascade" }),
  rating: text("rating").notNull(),
  reason: text("reason"),
  notes: text("notes"),
  createdBy: text("created_by").notNull().default("Front Desk"),
  createdAt: text("created_at").notNull(),
});
