import type { ReceptionDecision, ReceptionInput, SummaryInput } from "@/lib/ai/schemas";

export interface AIProvider {
  name: "openai" | "gemini" | "deepseek" | "mock";
  model: string;
  generateReceptionDecision(input: ReceptionInput): Promise<ReceptionDecision>;
  summarizePatient(input: SummaryInput): Promise<string>;
  healthCheck(): Promise<{ connected: boolean; latency: number; model: string; message: string }>;
}
