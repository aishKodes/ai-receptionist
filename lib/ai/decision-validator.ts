import { ReceptionDecisionSchema, type ReceptionDecision } from "./schemas";

export function validateReceptionDecision(value: unknown): ReceptionDecision {
  return ReceptionDecisionSchema.parse(value);
}

export function shouldUseFallback(decision: ReceptionDecision, message: string, threshold = Number(process.env.AI_CONFIDENCE_THRESHOLD || 0.58)) {
  return decision.intentConfidence < threshold || (decision.intent === "unknown" && message.trim().split(/\s+/).length > 5);
}
