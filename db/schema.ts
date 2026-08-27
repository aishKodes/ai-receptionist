import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
};

export const patients = sqliteTable("patients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
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
  source: text("source").notNull().default("demo"),
  campaign: text("campaign"),
  aiSummary: text("ai_summary"),
  assignedTo: text("assigned_to").default("AI Reception"),
  aiEnabled: integer("ai_enabled", { mode: "boolean" }).notNull().default(true),
  lastContactAt: text("last_contact_at"),
  nextFollowupAt: text("next_followup_at"),
  ...timestamps,
});

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  patientId: text("patient_id").notNull().references(() => patients.id, { onDelete: "cascade" }),
  channel: text("channel").notNull().default("local_demo"),
  status: text("status").notNull().default("open"),
  unreadCount: integer("unread_count").notNull().default(0),
  aiEnabled: integer("ai_enabled", { mode: "boolean" }).notNull().default(true),
  lastMessageAt: text("last_message_at").notNull(),
  createdAt: text("created_at").notNull(),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  patientId: text("patient_id").notNull().references(() => patients.id, { onDelete: "cascade" }),
  direction: text("direction").notNull(),
  senderType: text("sender_type").notNull(),
  messageType: text("message_type").notNull().default("text"),
  content: text("content").notNull(),
  mediaUrl: text("media_url"),
  contentItemId: text("content_item_id"),
  deliveryStatus: text("delivery_status").notNull().default("delivered"),
  metadataJson: text("metadata_json"),
  createdAt: text("created_at").notNull(),
});

export const treatments = sqliteTable("treatments", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  approvedResponseGuidance: text("approved_response_guidance").notNull(),
  bookingEnabled: integer("booking_enabled", { mode: "boolean" }).notNull().default(true),
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
  createdAt: text("created_at").notNull(),
});

export const appointments = sqliteTable("appointments", {
  id: text("id").primaryKey(),
  patientId: text("patient_id").notNull().references(() => patients.id),
  conversationId: text("conversation_id").notNull().references(() => conversations.id),
  treatmentSlug: text("treatment_slug"),
  dateTime: text("date_time").notNull(),
  status: text("status").notNull().default("confirmed"),
  notes: text("notes"),
  ...timestamps,
});

export const scheduledJobs = sqliteTable("scheduled_jobs", {
  id: text("id").primaryKey(),
  patientId: text("patient_id").notNull().references(() => patients.id),
  conversationId: text("conversation_id").notNull().references(() => conversations.id),
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
  patientId: text("patient_id").notNull().references(() => patients.id, { onDelete: "cascade" }),
  conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "cascade" }),
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
