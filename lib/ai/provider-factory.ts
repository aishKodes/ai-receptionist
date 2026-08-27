import type { AIProvider } from "./providers/provider";
import { MockProvider } from "./providers/mock";
import { DeepSeekProvider } from "./providers/deepseek";
import { GeminiProvider } from "./providers/gemini";
import { RemoteProvider } from "./providers/remote";

export function providerStatus() {
  const legacy = process.env.AI_PROVIDER?.toLowerCase();
  const primaryProvider = (legacy === "mock" ? "mock" : process.env.AI_PRIMARY_PROVIDER || legacy || "deepseek").toLowerCase();
  const primaryModel = process.env.AI_PRIMARY_MODEL || process.env.AI_MODEL || (primaryProvider === "deepseek" ? "deepseek-v4-flash" : primaryProvider === "gemini" ? "gemini-3.7-flash" : "Radiance deterministic demo AI");
  const fallbackProvider = (process.env.AI_FALLBACK_PROVIDER || "gemini").toLowerCase();
  const fallbackModel = process.env.AI_FALLBACK_MODEL || (fallbackProvider === "gemini" ? "gemini-3.7-flash" : "deepseek-v4-flash");
  const keyFor = (name: string) => name === "mock" || Boolean(name === "deepseek" ? process.env.DEEPSEEK_API_KEY : name === "gemini" ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY);
  return {
    configured: primaryProvider,
    active: primaryProvider,
    model: primaryModel,
    hasKey: keyFor(primaryProvider),
    primary: { provider: keyFor(primaryProvider) ? primaryProvider : "mock", model: keyFor(primaryProvider) ? primaryModel : "Radiance deterministic demo AI", configured: keyFor(primaryProvider) },
    fallback: { provider: keyFor(fallbackProvider) ? fallbackProvider : "mock", model: keyFor(fallbackProvider) ? fallbackModel : "Radiance deterministic demo AI", enabled: process.env.AI_ALLOW_FALLBACK !== "false", configured: keyFor(fallbackProvider) },
  };
}

export function getProviderByName(name: string, model?: string): AIProvider {
  if (name === "deepseek" && process.env.DEEPSEEK_API_KEY) return new DeepSeekProvider(model, process.env.DEEPSEEK_API_KEY);
  if (name === "gemini" && process.env.GEMINI_API_KEY) return new GeminiProvider(model, process.env.GEMINI_API_KEY);
  if (name === "openai" && process.env.OPENAI_API_KEY) return new RemoteProvider("openai", model || "gpt-5.6-terra", process.env.OPENAI_API_KEY);
  return new MockProvider();
}

export function getProvider(): AIProvider {
  const status = providerStatus();
  return getProviderByName(status.primary.provider, status.primary.model);
}
