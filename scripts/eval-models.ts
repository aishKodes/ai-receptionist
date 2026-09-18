import dotenv from "dotenv";
import { buildMinimalReceptionInput } from "@/lib/ai/context-builder";
import { estimateModelCostUsd } from "@/lib/ai/cost";
import { planTurn, sanitizePatientReply, unsafeFactualClaim } from "@/lib/ai/conversation-policy";
import { getProviderByName } from "@/lib/ai/provider-factory";

dotenv.config({ path: ".env.local", quiet: true });

type Case = { id: string; message: string; language: "ENGLISH" | "HINDI" | "HINGLISH" | "ODIA"; expectedIntent?: string; expectedAction: string; previousInterest?: string; prior?: string[] };
const cases: Case[] = [
  { id: "english-exploring", message: "I have acne and want to understand the options. I am not ready to book.", language: "ENGLISH", expectedIntent: "acne", expectedAction: "ANSWER" },
  { id: "hindi-acne", message: "मुझे मुंहासे हैं, क्या उपचार के विकल्प हैं?", language: "HINDI", expectedAction: "EDUCATE", previousInterest: "acne" },
  { id: "hinglish-hair", message: "Mere baal kaafi jhad rahe hain, kya options hain?", language: "HINGLISH", expectedAction: "EDUCATE", previousInterest: "hair_loss" },
  { id: "odia-information", message: "ମୋର କେଶ ଝଡ଼ୁଛି, କେଉଁ ବିକଳ୍ପ ଅଛି?", language: "ODIA", expectedAction: "EDUCATE", previousInterest: "hair_loss" },
  { id: "price-question", message: "What does a hair transplant cost? I am comparing options.", language: "ENGLISH", expectedIntent: "pricing", expectedAction: "HANDLE_OBJECTION", previousInterest: "hair_transplant" },
  { id: "trust-question", message: "How do I know I can trust the clinic and the doctor?", language: "ENGLISH", expectedAction: "HANDLE_OBJECTION", previousInterest: "hair_transplant" },
  { id: "thinking", message: "I need to think about it; please do not book anything yet.", language: "ENGLISH", expectedAction: "ANSWER", previousInterest: "acne" },
  { id: "booking-ready", message: "How much will it cost and can I come Saturday?", language: "ENGLISH", expectedIntent: "pricing", expectedAction: "OFFER_BOOKING", previousInterest: "hair_transplant", prior: ["I have frontal thinning", "The final price needs an assessment; no fixed price was provided"] },
  { id: "long-context", message: "Hindi mein bolo. I was asking about recovery, not booking yet.", language: "HINDI", expectedAction: "ANSWER", previousInterest: "hair_transplant", prior: ["My hair is thinning", "How long does recovery take?", "I am comparing clinics", "I need to speak with family", "I am not ready to book"] },
];
const models = [
  { provider: "deepseek", model: "deepseek-flash", hasKey: Boolean(process.env.DEEPSEEK_API_KEY) },
  { provider: "gemini", model: "gemini-3.1-flash-lite", hasKey: Boolean(process.env.GEMINI_API_KEY) },
  { provider: "gemini", model: "gemini-3.8-flash", hasKey: Boolean(process.env.GEMINI_API_KEY) },
];

function languageMatches(text: string, language: Case["language"]) {
  if (language === "ODIA") return /\p{Script=Oriya}/u.test(text);
  if (language === "HINDI") return /\p{Script=Devanagari}/u.test(text);
  if (language === "HINGLISH") return /\b(?:hai|hain|aap|ke|ka|kya|baal|mein|ho|kar|liye|sakte)\b/i.test(text) && !/\p{Script=Devanagari}/u.test(text);
  return !/\p{Script=Oriya}|\p{Script=Devanagari}/u.test(text);
}

async function evaluate(model: (typeof models)[number], item: Case) {
  if (!model.hasKey) return { case: item.id, success: false, error: "API_KEY_NOT_CONFIGURED" };
  const provider = getProviderByName(model.provider, model.model);
  const input = buildMinimalReceptionInput({ message: item.message, patient: { nameVerified: false, preferredLanguage: item.language, treatmentSlug: item.previousInterest, leadStage: "engaged" }, state: { conversationPhase: "CONSIDERATION", rollingSummary: item.prior?.join(". ") || "" }, recentMessages: (item.prior || []).map((content, index) => ({ senderType: index % 2 ? "ai" : "patient", content })) });
  const started = Date.now();
  try {
    const decision = await provider.generateReceptionDecision(input);
    const plan = planTurn({ message: item.message, decision });
    const safeReply = sanitizePatientReply(decision.reply, plan, item.language);
    const checks = {
      schema: true,
      language: languageMatches(safeReply, item.language),
      action: plan.nextBestAction === item.expectedAction,
      intent: !item.expectedIntent || decision.intent === item.expectedIntent || decision.treatmentSlug === item.expectedIntent,
      noHallucination: !unsafeFactualClaim(decision.reply),
      context: !item.prior?.length || !/(?:what is your concern|which concern|have you tried any treatment before)/i.test(safeReply),
      naturalnessProxy: safeReply.length >= 15 && safeReply.length <= 850 && !/(?:as an ai|choose option|press 1|book now)/i.test(safeReply),
    };
    const quality = Math.round(20 * Number(checks.schema) + 15 * Number(checks.language) + 25 * Number(checks.action) + 10 * Number(checks.intent) + 15 * Number(checks.noHallucination) + 10 * Number(checks.context) + 5 * Number(checks.naturalnessProxy));
    return { case: item.id, success: true, quality, checks, applicationGuarded: safeReply !== decision.reply, applicationSafe: !unsafeFactualClaim(safeReply), actualIntent: decision.intent, actualAction: plan.nextBestAction, latencyMs: Date.now() - started, inputTokens: provider.lastUsage?.inputTokens ?? null, outputTokens: provider.lastUsage?.outputTokens ?? null, estimatedCostUsd: estimateModelCostUsd(model.model, provider.lastUsage?.inputTokens, provider.lastUsage?.outputTokens) };
  } catch (error) {
    return { case: item.id, success: false, error: error instanceof Error ? error.message.replace(/(?:sk-|AIza)[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 180) : "Unknown provider failure", latencyMs: Date.now() - started };
  }
}

const results: Record<string, Array<Awaited<ReturnType<typeof evaluate>>>> = Object.fromEntries(models.map((model) => [model.model, []]));
for (const item of cases) {
  const round = await Promise.all(models.map((model) => evaluate(model, item)));
  round.forEach((result, index) => results[models[index].model].push(result));
  console.log(`Evaluated ${item.id} across 3 models.`);
}
const report = Object.fromEntries(models.map((model) => {
  const rows = results[model.model]; const successful = rows.filter((row) => row.success);
  const mean = (values: number[]) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 100) / 100 : null;
  return [model.model, { cases: rows.length, schemaSuccess: successful.length, qualityMean: mean(successful.map((row) => Number("quality" in row ? row.quality : 0))), latencyMeanMs: mean(successful.map((row) => Number("latencyMs" in row ? row.latencyMs : 0))), estimatedCostUsd: successful.reduce((sum, row) => sum + Number("estimatedCostUsd" in row ? row.estimatedCostUsd || 0 : 0), 0), results: rows }];
}));
console.log("MODEL_EVAL_SUMMARY", JSON.stringify(Object.fromEntries(models.map((model) => {
  const entry = report[model.model] as { cases: number; schemaSuccess: number; qualityMean: number | null; latencyMeanMs: number | null; estimatedCostUsd: number; results: Array<Awaited<ReturnType<typeof evaluate>>> };
  return [model.model, { cases: entry.cases, schemaSuccess: entry.schemaSuccess, qualityMean: entry.qualityMean, latencyMeanMs: entry.latencyMeanMs, estimatedCostUsd: entry.estimatedCostUsd, failures: entry.results.filter((row) => !row.success || ("quality" in row && Number(row.quality) < 100)).map((row) => ({ case: row.case, quality: "quality" in row ? row.quality : null, failedChecks: "checks" in row ? Object.entries(row.checks || {}).filter(([, passed]) => !passed).map(([name]) => name) : [], error: "error" in row ? row.error : null })) }];
}))));
console.log(JSON.stringify({ generatedAt: new Date().toISOString(), rubric: "Heuristic schema/language/action/intent/safety/context/naturalness-proxy scoring. Human review of actual replies remains necessary; prices are conservative paid-tier estimates, not invoices.", report }, null, 2));
