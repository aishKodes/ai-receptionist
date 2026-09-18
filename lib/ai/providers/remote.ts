import { z } from "zod";
import { ReceptionDecisionSchema, type ReceptionDecision, type ReceptionInput, type SummaryInput } from "@/lib/ai/schemas";
import { RECEPTION_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import type { AIProvider } from "./provider";

type RemoteName = "openai" | "gemini" | "deepseek";

const DECISION_CONTRACT = `Return exactly one JSON object with these fields and no additional commentary:
{
  "reply": "short patient-facing reply",
  "intent": "unknown",
  "extracted": { "name": null, "age": null, "gender": null, "concern": null, "duration": null, "desiredDate": null, "desiredTime": null },
  "intentConfidence": 0.5,
  "treatmentSlug": null,
  "shouldSearchContent": false,
  "contentQuery": null,
  "shouldOfferBooking": false,
  "humanEscalation": { "required": false, "recommended": false, "type": "none", "priority": "low", "reason": null },
  "suggestedNextAction": "Ask one clarifying question",
  "internalSummary": "short factual summary"
}

The intent value MUST be exactly one of: hair_loss, hair_transplant, prp, gfc, beard_transplant, acne, acne_scars, pigmentation, melasma, laser, anti_ageing, general_skin, general_hair, appointment, reschedule, cancellation, pricing, human_request, complaint, post_procedure_concern, unknown.
The treatmentSlug value MUST be null or exactly one of: hair_loss, hair_transplant, prp, gfc, beard_transplant, acne, acne_scars, pigmentation, melasma, laser, anti_ageing, general_skin, general_hair.
Use null for facts not reliably present in the latest message. If present, desiredDate must be YYYY-MM-DD and desiredTime must be HH:mm in 24-hour time. Never invent alternate labels or synonyms for enum values.`;

function extractJson(text: string) {
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Provider did not return JSON");
  return JSON.parse(cleaned.slice(start, end + 1));
}

export class RemoteProvider implements AIProvider {
  lastUsage?: { inputTokens?: number; outputTokens?: number; estimatedCostUsd?: number };
  constructor(public name: RemoteName, public model: string, private key: string) {}

  private addUsage(inputTokens?: number, outputTokens?: number) {
    this.lastUsage = { inputTokens: (this.lastUsage?.inputTokens || 0) + (inputTokens || 0), outputTokens: (this.lastUsage?.outputTokens || 0) + (outputTokens || 0) };
  }

  private async request(url: string, init: RequestInit) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(12000) });
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 1) return response;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error("Provider request failed.");
  }

  private async generateText(input: string, system = RECEPTION_SYSTEM_PROMPT) {
    if (this.name === "openai") {
      const response = await this.request("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.key}` },
        body: JSON.stringify({ model: this.model, instructions: system, input, reasoning: { effort: "low" }, text: { verbosity: "low" } }),
      });
      if (!response.ok) throw new Error(`OpenAI request failed (${response.status})`);
      const json = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }>; usage?: { input_tokens?: number; output_tokens?: number } };
      this.addUsage(json.usage?.input_tokens, json.usage?.output_tokens);
      return json.output_text || json.output?.flatMap((item) => item.content || []).map((item) => item.text || "").join("") || "";
    }
    if (this.name === "gemini") {
      const response = await this.request(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${encodeURIComponent(this.key)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: input }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.3 } }),
      });
      if (!response.ok) throw new Error(`Gemini request failed (${response.status})`);
      const json = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } };
      this.addUsage(json.usageMetadata?.promptTokenCount, (json.usageMetadata?.candidatesTokenCount || 0) + (json.usageMetadata?.thoughtsTokenCount || 0));
      return json.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    }
    const response = await this.request("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.key}` },
      body: JSON.stringify({ model: this.model, thinking: { type: "disabled" }, response_format: { type: "json_object" }, temperature: 0.3, messages: [{ role: "system", content: system }, { role: "user", content: input }] }),
    });
    if (!response.ok) throw new Error(`DeepSeek request failed (${response.status})`);
    const json = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    this.addUsage(json.usage?.prompt_tokens, json.usage?.completion_tokens);
    return json.choices?.[0]?.message?.content || "";
  }

  async generateReceptionDecision(input: ReceptionInput): Promise<ReceptionDecision> {
    this.lastUsage = undefined;
    const prompt = `${DECISION_CONTRACT}\n\nPatient context:\n${JSON.stringify(input.patient)}\nRecent messages:\n${JSON.stringify(input.recentMessages)}\nApproved clinic knowledge:\n${input.knowledge}\nLatest patient message:\n${input.message}`;
    const first = await this.generateText(prompt);
    const firstObject = extractJson(first);
    const parsed = ReceptionDecisionSchema.safeParse(firstObject);
    if (parsed.success) return parsed.data;
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    const repaired = await this.generateText(`${DECISION_CONTRACT}\n\nRepair the following JSON so every field and enum value exactly matches the contract. Validation issues: ${issues}\nInvalid JSON:\n${JSON.stringify(firstObject)}`, "You repair structured JSON. Follow the supplied contract exactly and return only the corrected JSON object.");
    return ReceptionDecisionSchema.parse(extractJson(repaired));
  }

  async summarizePatient(input: SummaryInput) {
    this.lastUsage = undefined;
    const text = await this.generateText(`Summarize this patient in at most 70 words using only supplied facts. Patient: ${JSON.stringify(input.patient)} Messages: ${JSON.stringify(input.messages)}`, "You create factual clinic reception summaries. Never diagnose or invent facts.");
    return z.string().min(1).max(800).parse(text.trim());
  }

  async healthCheck() {
    this.lastUsage = undefined;
    const start = Date.now();
    await this.generateText("Return a JSON object with one field: ok=true", "Return JSON only.");
    return { connected: true, latency: Date.now() - start, model: this.model, message: "Connected" };
  }
}
