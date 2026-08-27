import type { AIProvider } from "./providers/provider";
import { MockProvider } from "./providers/mock";
import { RemoteProvider } from "./providers/remote";

export function providerStatus() {
  const configured = (process.env.AI_PROVIDER || "auto").toLowerCase();
  let active = configured;
  if (configured === "auto") {
    if (process.env.OPENAI_API_KEY) active = "openai";
    else if (process.env.GEMINI_API_KEY) active = "gemini";
    else if (process.env.DEEPSEEK_API_KEY) active = "deepseek";
    else active = "mock";
  }
  const model = process.env.AI_MODEL || (active === "openai" ? "gpt-5.6-terra" : active === "gemini" ? "gemini-2.5-flash" : active === "deepseek" ? "deepseek-chat" : "Radiance deterministic demo AI");
  const hasKey = active === "mock" || Boolean(active === "openai" ? process.env.OPENAI_API_KEY : active === "gemini" ? process.env.GEMINI_API_KEY : process.env.DEEPSEEK_API_KEY);
  return { configured, active, model, hasKey, fallback: process.env.AI_FALLBACK_TO_MOCK !== "false" };
}

export function getProvider(): AIProvider {
  const status = providerStatus();
  if (!status.hasKey || status.active === "mock") return new MockProvider();
  const key = status.active === "openai" ? process.env.OPENAI_API_KEY! : status.active === "gemini" ? process.env.GEMINI_API_KEY! : process.env.DEEPSEEK_API_KEY!;
  return new RemoteProvider(status.active as "openai" | "gemini" | "deepseek", status.model, key);
}
