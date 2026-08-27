import { z } from "zod";

export const IntentSchema = z.enum([
  "hair_loss", "hair_transplant", "prp", "gfc", "beard_transplant",
  "acne", "acne_scars", "pigmentation", "melasma", "laser", "anti_ageing",
  "general_skin", "general_hair", "booking", "reschedule", "pricing", "human_request", "unknown"
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
    preferredDate: z.string().nullable(),
    preferredTime: z.string().nullable(),
  }),
  leadStage: z.enum(["new", "engaged", "qualified", "booking_offered", "appointment_requested", "booked", "follow_up", "human_required"]),
  leadScore: z.number().min(0).max(100),
  treatmentSlug: TreatmentSlugSchema.nullable(),
  shouldSendContent: z.boolean(),
  contentQuery: z.string().nullable(),
  shouldOfferBooking: z.boolean(),
  shouldEscalateHuman: z.boolean(),
  escalationReason: z.string().nullable(),
  internalSummary: z.string(),
});

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
