import crypto from "node:crypto";
import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { databasePath, getSqlite } from "@/db";
import { seedDatabase } from "@/lib/db/setup";
import { routeReceptionDecision } from "@/lib/ai/router";
import type { AIProvider } from "@/lib/ai/providers/provider";
import type { ReceptionDecision } from "@/lib/ai/schemas";
import { normalizeIndianPhone } from "@/lib/channels/pipeline";
import { verifyMetaSignature } from "@/lib/channels/whatsapp-cloud";
import { importCsvLeads, validateCsvRows } from "@/lib/import/csv";
import { bookAppointment, createHumanTask, getAvailableSlots, getPatientContext, rescheduleAppointment, scheduleAppointmentJobs, setAiMode } from "@/lib/services/repository";
import { createCampaign, outreachEligibility, processOutboundOnce, startCampaign } from "@/lib/outreach/service";
import { GET as verifyWebhook, POST as receiveWebhook } from "@/app/api/whatsapp/webhook/route";

const goodDecision: ReceptionDecision = {
  reply: "Thank you. I can help with a consultation.", intent: "hair_transplant", treatmentSlug: "hair_transplant",
  extracted: { name: null, age: 29, gender: null, concern: "Frontal thinning", duration: "3 years", desiredDate: null, desiredTime: null },
  intentConfidence: 0.94, shouldOfferBooking: false, shouldSearchContent: true, contentQuery: "hair transplant",
  humanEscalation: { required: false, recommended: false, type: "none", priority: "low", reason: null },
  suggestedNextAction: "Offer approved education", internalSummary: "Patient is considering hair transplant.",
};

class StubProvider implements AIProvider {
  constructor(public name: AIProvider["name"], public model: string, private output: ReceptionDecision | Error) {}
  async generateReceptionDecision() { if (this.output instanceof Error) throw this.output; return this.output; }
  async summarizePatient() { return "Summary"; }
  async healthCheck() { return { connected: true, latency: 1, model: this.model, message: "Connected" }; }
}

beforeAll(() => seedDatabase(true));
afterAll(() => {
  getSqlite().close();
  for (const suffix of ["", "-wal", "-shm"]) { try { fs.unlinkSync(`${databasePath}${suffix}`); } catch {} }
});

describe("AI provider router", () => {
  const input = { message: "I am considering hair transplant", patient: { firstName: "Rahul" }, recentMessages: [], knowledge: "{}" };
  it("accepts a valid primary DeepSeek decision", async () => {
    const result = await routeReceptionDecision(input, {}, { primary: new StubProvider("deepseek", "test-deepseek", goodDecision), fallback: new StubProvider("gemini", "test-gemini", goodDecision) });
    expect(result.provider.name).toBe("deepseek"); expect(result.fallbackUsed).toBe(false);
  });
  it("uses Gemini when DeepSeek is malformed, empty, or unavailable", async () => {
    for (const error of [new Error("malformed JSON"), new Error("empty result"), new Error("timeout")]) {
      const result = await routeReceptionDecision(input, {}, { primary: new StubProvider("deepseek", "test-deepseek", error), fallback: new StubProvider("gemini", "test-gemini", goodDecision) });
      expect(result.provider.name).toBe("gemini"); expect(result.fallbackUsed).toBe(true);
    }
  });
  it("uses the safe mock when both providers are unavailable", async () => {
    const result = await routeReceptionDecision(input, {}, { primary: new StubProvider("deepseek", "test", new Error("down")), fallback: new StubProvider("gemini", "test", new Error("down")) });
    expect(result.provider.name).toBe("mock"); expect(result.decision.reply).toBeTruthy();
  });
});

describe("CSV + CRM safety", () => {
  it("normalizes Indian numbers consistently", () => {
    expect(normalizeIndianPhone("9876543210")).toBe("+919876543210");
    expect(normalizeIndianPhone("919876543210")).toBe("+919876543210");
    expect(normalizeIndianPhone("+91 98765 43210")).toBe("+919876543210");
    expect(normalizeIndianPhone("1234")).toBeNull();
  });
  it("detects duplicates, invalid phones, unknown consent, and escapes formulas", () => {
    const result = validateCsvRows("name,phone,notes,consent\nA,9876543210,=HYPERLINK(\"x\"),\nB,9876543210,same,no\nC,1234,+SUM(1),yes");
    expect(result.summary.duplicates).toBe(1); expect(result.summary.invalid).toBe(2); expect(result.summary.consentUnknown).toBe(1);
    expect(result.rows[0].formulaFields).toBe(1);
  });
  it("creates a patient and merges an existing match without deleting history", () => {
    const csv = "name,phone,concern,opt in\nImported One,9876543222,Hair thinning,yes";
    expect(importCsvLeads("one.csv", csv).imported).toBe(1);
    const first = getSqlite().prepare("SELECT id,whatsapp_opt_in_status AS consent FROM patients WHERE phone='+919876543222'").get() as { id: string; consent: string };
    expect(first.consent).toBe("CONFIRMED");
    expect(importCsvLeads("two.csv", csv, undefined, "merge").imported).toBe(1);
    expect((getSqlite().prepare("SELECT COUNT(*) AS count FROM patients WHERE phone='+919876543222'").get() as { count: number }).count).toBe(1);
  });
});

describe("outreach, appointments, and human mode", () => {
  it("excludes unknown/opted-out leads and queues each eligible patient once", async () => {
    expect(outreachEligibility({ phone: "+919876543210", whatsappOptInStatus: "UNKNOWN" }).reason).toBe("CONSENT_UNKNOWN");
    expect(outreachEligibility({ phone: "+919876543210", whatsappOptInStatus: "REVOKED", doNotContact: 1 }).reason).toBe("OPTED_OUT");
    const db = getSqlite();
    db.prepare("UPDATE patients SET whatsapp_opt_in_status='CONFIRMED',do_not_contact=0,invalid_phone=0 WHERE id='pat_rahul'").run();
    const campaignId = createCampaign({ name: "Phase 2 test", templateId: "tpl_general_reengagement" });
    const started = startCampaign(campaignId);
    expect(started.queued).toBeGreaterThanOrEqual(1);
    const queuedForRahul = (db.prepare("SELECT COUNT(*) AS count FROM outbound_messages WHERE campaign_id=? AND patient_id='pat_rahul'").get(campaignId) as { count: number }).count;
    expect(queuedForRahul).toBe(1);
    expect((await processOutboundOnce()).sent).toBeGreaterThanOrEqual(1);
  });
  it("prevents double booking, reschedules, and cancels old reminders", () => {
    const date = getSqlite().prepare("SELECT date FROM available_slots WHERE time='10:00' ORDER BY date LIMIT 1").get() as { date: string };
    expect(getAvailableSlots(date.date)).toContain("10:00");
    const one = bookAppointment("pat_rahul", "con_rahul", "hair_transplant", date.date, "10:00"); scheduleAppointmentJobs(one);
    expect(() => bookAppointment("pat_ananya", "con_ananya", "acne_scars", date.date, "10:00")).toThrow();
    const next = rescheduleAppointment(one.id, date.date, "10:30");
    expect(next.dateTime).toContain("10:30");
    const cancelled = (getSqlite().prepare("SELECT COUNT(*) AS count FROM scheduled_jobs WHERE appointment_id=? AND status='cancelled'").get(one.id) as { count: number }).count;
    expect(cancelled).toBeGreaterThan(0);
  });
  it("persists a human task and pauses/resumes AI with context", () => {
    const task = createHumanTask({ patientId: "pat_rahul", conversationId: "con_rahul", type: "CALL", priority: "HIGH", title: "Call now" });
    expect(task.id).toBeTruthy();
    setAiMode("pat_rahul", false); expect(Boolean(getPatientContext("pat_rahul")!.patient.aiEnabled)).toBe(false);
    setAiMode("pat_rahul", true); expect(Boolean(getPatientContext("pat_rahul")!.patient.aiEnabled)).toBe(true);
  });
});

describe("WhatsApp webhook security and idempotency", () => {
  it("verifies challenges and HMAC signatures", () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "verify-test"; process.env.META_APP_SECRET = "secret-test";
    const getRequest = new NextRequest("http://localhost/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-test&hub.challenge=12345");
    expect(verifyWebhook(getRequest).status).toBe(200);
    const raw = "{\"ok\":true}"; const signature = `sha256=${crypto.createHmac("sha256", "secret-test").update(raw).digest("hex")}`;
    expect(verifyMetaSignature(raw, signature, "secret-test")).toBe(true); expect(verifyMetaSignature(raw, "sha256=bad", "secret-test")).toBe(false);
  });
  it("normalizes incoming text, ignores duplicate events, and applies delivery statuses", async () => {
    process.env.META_APP_SECRET = "secret-test";
    const incoming = { entry: [{ changes: [{ value: { contacts: [{ profile: { name: "Webhook Demo" }, wa_id: "919876543288" }], messages: [{ id: "wamid.inbound.1", from: "919876543288", type: "text", text: { body: "Hi, I need a consultation" } }] } }] }] };
    const raw = JSON.stringify(incoming); const signature = `sha256=${crypto.createHmac("sha256", "secret-test").update(raw).digest("hex")}`;
    const request = () => new NextRequest("http://localhost/api/whatsapp/webhook", { method: "POST", body: raw, headers: { "x-hub-signature-256": signature, "content-type": "application/json" } });
    expect((await (await receiveWebhook(request())).json()).processed).toBe(1);
    expect((await (await receiveWebhook(request())).json()).processed).toBe(0);
    const patient = getSqlite().prepare("SELECT id FROM patients WHERE whatsapp_id='919876543288'").get() as { id: string };
    expect(getPatientContext(patient.id)!.messages.some((message) => message.externalMessageId === "wamid.inbound.1")).toBe(true);
    getSqlite().prepare("UPDATE messages SET external_message_id='wamid.out.1' WHERE id=(SELECT id FROM messages WHERE patient_id=? AND direction='outbound' ORDER BY created_at DESC LIMIT 1)").run(patient.id);
    const status = { entry: [{ changes: [{ value: { statuses: [{ id: "wamid.out.1", status: "read", timestamp: "1700000000" }] } }] }] };
    const statusRaw = JSON.stringify(status); const statusSig = `sha256=${crypto.createHmac("sha256", "secret-test").update(statusRaw).digest("hex")}`;
    await receiveWebhook(new NextRequest("http://localhost/api/whatsapp/webhook", { method: "POST", body: statusRaw, headers: { "x-hub-signature-256": statusSig } }));
    expect((getSqlite().prepare("SELECT delivery_status AS status FROM messages WHERE external_message_id='wamid.out.1'").get() as { status: string }).status).toBe("read");
  });
});
