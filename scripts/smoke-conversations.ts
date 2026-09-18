import dotenv from "dotenv";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

dotenv.config({ path: ".env.local", quiet: true });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "radiance-conversation-smoke-"));
process.env.RADIANCE_DB_PATH = path.join(temporary, "smoke.db");
process.env.DATABASE_PROVIDER = "sqlite";
process.env.MESSAGE_CHANNEL = "local";
process.env.AI_PROVIDER = "deepseek";
process.env.AI_FALLBACK_TO_MOCK = "true";

const { seedDatabase } = await import("@/lib/db/setup");
const { getSqlite } = await import("@/db");
const { ensurePatientForChannel, getPatientContext } = await import("@/lib/services/repository");
const { processIncomingMessage } = await import("@/lib/channels/pipeline");
const { importCsvLeads } = await import("@/lib/import/csv");
const { createCampaign, processOutboundOnce, startCampaign } = await import("@/lib/outreach/service");
const { outreachDryRun } = await import("@/lib/outreach/prioritization");

const scenarios = [
  { id: "english-exploratory", messages: ["Hi, I have acne. I am exploring options, not ready to book."] },
  { id: "hindi-acne", messages: ["मुझे मुंहासे हैं। उपचार के बारे में बताइए।"] },
  { id: "hinglish-hair", messages: ["Mere baal bahut jhad rahe hain, kya options hain?"] },
  { id: "odia", messages: ["ମୋର କେଶ ଝଡ଼ୁଛି। କେଉଁ ବିକଳ୍ପ ଅଛି?"] },
  { id: "price-objection", messages: ["What does a hair transplant cost? I am comparing options."] },
  { id: "trust-objection", messages: ["How can I trust your clinic and doctor?"] },
  { id: "need-to-think", messages: ["I need to think about it. Not planning to book now."] },
  { id: "booking-ready", messages: ["How much will it cost and can I come tomorrow evening?"] },
  { id: "call-request", messages: ["Can someone call me about a consultation?"] },
  { id: "long-language-switch", messages: ["I have hair loss for several years and I am comparing options.", "Recovery time worries me, and I am not ready to book.", "Hindi mein bolo. I was asking about recovery, not booking yet."] },
  { id: "content-relevance", messages: ["I am considering a hair transplant.", "Please send the hair transplant guide video."] },
  { id: "clinical-safety", messages: ["I have swelling after the procedure. Is it normal?"] },
];

try {
  seedDatabase(true);
  const report = [];
  for (const [index, scenario] of scenarios.entries()) {
    const phone = `+91987654${String(2000 + index)}`;
    const patient = ensurePatientForChannel({ phone, name: `Smoke ${index + 1}`, channel: "local" });
    for (const message of scenario.messages) await processIncomingMessage({ channel: "local", patientId: String(patient.patient.id), text: message, messageType: "text" });
    const context = getPatientContext(String(patient.patient.id))!;
    const latest = [...context.messages].reverse().find((message) => message.direction === "outbound");
    const humanTaskCount = (getSqlite().prepare("SELECT COUNT(*) AS count FROM human_tasks WHERE patient_id=?").get(patient.patient.id) as { count: number }).count;
    report.push({ case: scenario.id, phase: context.state.conversationPhase, action: context.state.nextBestAction, readiness: context.state.readinessScore, objection: context.state.primaryObjection, language: context.state.preferredLanguage, appointment: context.appointment?.status || null, contentSent: context.messages.filter((message) => message.contentItemId).length, humanTasks: humanTaskCount, reply: latest?.content || null });
  }
  const csv = "name,phone,concern,opt in\n" + Array.from({ length: 18 }, (_, i) => `Local Outreach ${i + 1},987655${String(1000 + i)},Hair transplant,yes`).join("\n");
  importCsvLeads("smoke-outreach.csv", csv);
  getSqlite().prepare("UPDATE patients SET lead_score=80,lead_temperature='HOT' WHERE source='csv_import'").run();
  getSqlite().prepare("UPDATE message_templates SET status='APPROVED',meta_template_name='general_reengagement_v1' WHERE id='tpl_general_reengagement'").run();
  const campaignId = createCampaign({ name: "Local smoke simulation", templateId: "tpl_general_reengagement" });
  const before = outreachDryRun(campaignId);
  const queued = startCampaign(campaignId).queued;
  const sent = (await processOutboundOnce(20)).sent;
  const after = outreachDryRun(campaignId);
  console.log(JSON.stringify({ conversations: report, outreach: { eligibleToday: before.eligibleToday, selected: before.selected.length, humanOpportunity: before.humanOpportunity.length, queued, sent, limit: after.limit, used: after.used, nextSelected: after.selected.length, humanAfterLimit: after.humanOpportunity.length } }, null, 2));
} finally {
  getSqlite().close();
  fs.rmSync(temporary, { recursive: true, force: true });
}
