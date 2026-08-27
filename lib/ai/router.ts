import type { AIProvider } from "./providers/provider";
import type { ReceptionDecision, ReceptionInput } from "./schemas";
import { MockProvider } from "./providers/mock";
import { getProviderByName, providerStatus } from "./provider-factory";
import { shouldUseFallback, validateReceptionDecision } from "./decision-validator";
import { recordProviderUsage } from "@/lib/services/repository";

type RouteMeta = { patientId?: string | null; conversationId?: string | null };
type RouteOptions = { primary?: AIProvider; fallback?: AIProvider; safeMock?: AIProvider };

async function attempt(provider: AIProvider, input: ReceptionInput, meta: RouteMeta, status = "SUCCESS") {
  const started = Date.now();
  try {
    const decision = validateReceptionDecision(await provider.generateReceptionDecision(input));
    recordProviderUsage({ ...meta, provider: provider.name, model: provider.model, operation: "reception_decision", status, latencyMs: Date.now() - started, ...provider.lastUsage });
    return decision;
  } catch (error) {
    recordProviderUsage({ ...meta, provider: provider.name, model: provider.model, operation: "reception_decision", status: "ERROR", latencyMs: Date.now() - started, ...provider.lastUsage, errorCode: error instanceof Error ? error.name : "UNKNOWN" });
    throw error;
  }
}

export async function routeReceptionDecision(input: ReceptionInput, meta: RouteMeta = {}, options: RouteOptions = {}): Promise<{ decision: ReceptionDecision; provider: AIProvider; fallbackUsed: boolean }> {
  const status = providerStatus();
  const primary = options.primary ?? getProviderByName(status.primary.provider, status.primary.model);
  const fallback = options.fallback ?? (status.fallback.enabled ? getProviderByName(status.fallback.provider, status.fallback.model) : null);
  const safeMock = options.safeMock ?? new MockProvider();

  try {
    const decision = await attempt(primary, input, meta);
    if (!fallback || fallback.name === primary.name || !shouldUseFallback(decision, input.message)) return { decision, provider: primary, fallbackUsed: false };
    try {
      return { decision: await attempt(fallback, input, meta, "FALLBACK"), provider: fallback, fallbackUsed: true };
    } catch { /* safe fallback below */ }
  } catch {
    if (fallback && fallback.name !== primary.name) {
      try { return { decision: await attempt(fallback, input, meta, "FALLBACK"), provider: fallback, fallbackUsed: true }; } catch { /* safe fallback below */ }
    }
  }

  if (process.env.AI_FALLBACK_TO_MOCK === "false") throw new Error("Reception AI is temporarily unavailable.");
  return { decision: await attempt(safeMock, input, meta, "SAFE_MOCK"), provider: safeMock, fallbackUsed: primary.name !== "mock", };
}
