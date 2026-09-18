import type { AIProvider } from "./providers/provider";
import type { ReceptionDecision, ReceptionInput } from "./schemas";
import { MockProvider } from "./providers/mock";
import { getProviderByName, providerStatus } from "./provider-factory";
import { shouldUseFallback, validateReceptionDecision } from "./decision-validator";
import { recordProviderUsage } from "@/lib/services/repository";

function languageMismatch(reply: string, language: unknown) {
  if (language === "HINDI") return !/\p{Script=Devanagari}/u.test(reply);
  if (language === "ODIA") return !/\p{Script=Oriya}/u.test(reply);
  if (language === "HINGLISH") return !/\b(?:hai|hain|aap|ke|ka|kya|baal|mein|ho|kar|liye|sakte|bilkul)\b/i.test(reply);
  return false;
}

type RouteMeta = { patientId?: string | null; conversationId?: string | null; complex?: boolean };
type RouteOptions = { primary?: AIProvider; fallback?: AIProvider; complex?: AIProvider; safeMock?: AIProvider };

async function attempt(provider: AIProvider, input: ReceptionInput, meta: RouteMeta, status = "SUCCESS", fallbackReason?: string) {
  const started = Date.now();
  try {
    const decision = validateReceptionDecision(await provider.generateReceptionDecision(input));
    recordProviderUsage({ ...meta, provider: provider.name, model: provider.model, operation: "reception_decision", status, latencyMs: Date.now() - started, ...provider.lastUsage, fallbackReason });
    return decision;
  } catch (error) {
    recordProviderUsage({ ...meta, provider: provider.name, model: provider.model, operation: "reception_decision", status: "ERROR", latencyMs: Date.now() - started, ...provider.lastUsage, errorCode: error instanceof Error ? error.name : "UNKNOWN", fallbackReason });
    throw error;
  }
}

export async function routeReceptionDecision(input: ReceptionInput, meta: RouteMeta = {}, options: RouteOptions = {}): Promise<{ decision: ReceptionDecision; provider: AIProvider; fallbackUsed: boolean; fallbackReason: string | null }> {
  const status = providerStatus();
  if (!options.primary && !status.primary.configured && status.configured !== "mock" && process.env.AI_FALLBACK_TO_MOCK === "false") throw new Error("Primary AI provider is not configured.");
  const primary = options.primary ?? getProviderByName(status.primary.provider, status.primary.model);
  const fallback = options.fallback ?? (status.fallback.enabled && status.fallback.configured ? getProviderByName(status.fallback.provider, status.fallback.model) : null);
  const complex = options.complex ?? (status.complex.enabled && status.complex.configured ? getProviderByName(status.complex.provider, status.complex.model) : null);
  const safeMock = options.safeMock ?? new MockProvider();
  const languageSensitive = input.patient.preferredLanguage === "ODIA" || /\p{Script=Oriya}/u.test(input.message);
  let reason: string | null = null;
  if (!languageSensitive) {
    try {
      const decision = await attempt(primary, input, meta);
      if (!fallback || (fallback.name === primary.name && fallback.model === primary.model) || (!shouldUseFallback(decision, input.message) && !languageMismatch(decision.reply, input.patient.preferredLanguage))) return { decision, provider: primary, fallbackUsed: false, fallbackReason: null };
      reason = languageMismatch(decision.reply, input.patient.preferredLanguage) ? "LANGUAGE_MISMATCH" : "LOW_CONFIDENCE";
    } catch { reason = "PRIMARY_ERROR_OR_INVALID_OUTPUT"; }
  } else reason = "ODIA_LANGUAGE";
  if (fallback && !(fallback.name === primary.name && fallback.model === primary.model)) {
    try {
      const decision = await attempt(fallback, input, meta, "FALLBACK", reason);
      const languageFailed = languageMismatch(decision.reply, input.patient.preferredLanguage);
      if ((!shouldUseFallback(decision, input.message) && !languageFailed) || (!meta.complex && !languageFailed) || !complex || (complex.name === fallback.name && complex.model === fallback.model)) return { decision, provider: fallback, fallbackUsed: true, fallbackReason: reason };
      reason = languageFailed ? "LANGUAGE_FALLBACK_MISMATCH" : "COMPLEX_LOW_CONFIDENCE";
    } catch { reason = "LANGUAGE_FALLBACK_ERROR_OR_INVALID_OUTPUT"; }
  }
  if (complex && (meta.complex || reason === "LANGUAGE_FALLBACK_MISMATCH" || (languageSensitive && reason === "LANGUAGE_FALLBACK_ERROR_OR_INVALID_OUTPUT")) && !(complex.name === fallback?.name && complex.model === fallback.model)) {
    try { return { decision: await attempt(complex, input, meta, "FALLBACK", reason || "COMPLEX_CASE"), provider: complex, fallbackUsed: true, fallbackReason: reason || "COMPLEX_CASE" }; } catch { /* safe continuity below */ }
  }
  if (process.env.AI_FALLBACK_TO_MOCK === "false") throw new Error("Reception AI is temporarily unavailable.");
  return { decision: await attempt(safeMock, input, meta, "SAFE_MOCK", reason || "PROVIDER_UNAVAILABLE"), provider: safeMock, fallbackUsed: primary.name !== "mock", fallbackReason: reason || "PROVIDER_UNAVAILABLE" };
}
