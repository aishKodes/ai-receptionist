import { z } from "zod";

export const IntentSchema = z.enum([
  "hair_loss", "hair_transplant", "prp", "gfc", "beard_transplant",
  "acne", "acne_scars", "pigmentation", "melasma", "laser", "anti_ageing",
  "general_skin", "general_hair", "appointment", "reschedule", "cancellation", "pricing", "human_request", "complaint", "post_procedure_concern", "unknown"
]);

export const TreatmentSlugSchema = z.enum([
  "hair_loss", "hair_transplant", "prp", "gfc", "beard_transplant",
  "acne", "acne_scars", "pigmentation", "melasma", "laser", "anti_ageing",
  "general_skin", "general_hair"
]);

export const ReceptionDecisionSchema = z.object({
  reply: z.string().min(1).max(1200),
  intent: IntentSchema,
  extracted: z.object({
    name: z.string().nullable(),
    age: z.number().int().min(1).max(110).nullable(),
    gender: z.string().nullable(),
    concern: z.string().nullable(),
    duration: z.string().nullable(),
    desiredDate: z.string().nullable(),
    desiredTime: z.string().nullable(),
  }),
  intentConfidence: z.number().min(0).max(1),
  treatmentSlug: TreatmentSlugSchema.nullable(),
  shouldSearchContent: z.boolean(),
  contentQuery: z.string().nullable(),
  shouldOfferBooking: z.boolean(),
  humanEscalation: z.object({
    required: z.boolean(),
    recommended: z.boolean(),
    type: z.enum(["call", "chat", "doctor_review", "none"]),
    priority: z.enum(["urgent", "high", "normal", "low"]),
    reason: z.string().nullable(),
  }),
  suggestedNextAction: z.string().min(1).max(300),
  internalSummary: z.string().max(800),
}).strict();

export type ReceptionDecision = z.infer<typeof ReceptionDecisionSchema>;

export type ReceptionInput = {
  message: string;
  patient: Record<string, unknown>;
  recentMessages: Array<{ senderType: string; content: string }>;
  knowledge: string;
};

export type SummaryInput = {
  patient: Record<string, unknown>;
  messages: Array<{ senderType: string; content: string }>;
};

export const IncomingMessageSchema = z.object({
  patientId: z.string().min(1),
  content: z.string().trim().min(1).max(2000),
  senderType: z.enum(["patient", "human"]).default("patient"),
});

export const NormalizedInboundSchema = z.object({
  channel: z.enum(["local", "whatsapp"]),
  patientId: z.string().min(1).optional(),
  externalMessageId: z.string().max(200).optional(),
  from: z.string().min(8).max(30).optional(),
  profileName: z.string().max(120).optional(),
  messageType: z.enum(["text", "image", "video", "audio", "document", "interactive"]).default("text"),
  text: z.string().trim().max(4000).default(""),
  mediaId: z.string().max(300).optional(),
  mediaMimeType: z.string().max(120).optional(),
  timestamp: z.string().optional(),
});

export type NormalizedInbound = z.infer<typeof NormalizedInboundSchema>;
