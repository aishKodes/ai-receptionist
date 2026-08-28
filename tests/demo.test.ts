import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databasePath, getSqlite } from "@/db";
import { seedDatabase } from "@/lib/db/setup";
import { processIncomingMessage } from "@/lib/channels/pipeline";
import { addMessage, createHumanTask, getPatientContext, setAiMode } from "@/lib/services/repository";
import { importCsvLeads } from "@/lib/import/csv";
import { createCampaign, processOutboundOnce, startCampaign } from "@/lib/outreach/service";

beforeAll(() => seedDatabase(true));
afterAll(() => {
  getSqlite().close();
  for (const suffix of ["", "-wal", "-shm"]) { try { fs.unlinkSync(`${databasePath}${suffix}`); } catch {} }
});

describe("complete production reception workflow", () => {
  it("runs enquiry → CRM → safe price → booking → handoff → CSV outreach → returning lead", async () => {
    await processIncomingMessage({ channel: "local", patientId: "pat_rahul", messageType: "text", text: "Hi, I'm 29 and my hair has become very thin from the front for almost 3 years. I am thinking about hair transplant." });
    let rahul = getPatientContext("pat_rahul")!;
    expect(rahul.patient).toMatchObject({ age: 29, treatmentSlug: "hair_transplant" });
    expect(Number(rahul.patient.leadScore)).toBeGreaterThanOrEqual(70);
    expect(rahul.messages.some((message) => message.contentItemId)).toBe(false);
    await processIncomingMessage({ channel: "local", patientId: "pat_rahul", messageType: "text", text: "Please share a hair transplant video guide." });
    rahul = getPatientContext("pat_rahul")!;
    expect(rahul.messages.some((message) => message.contentItemId)).toBe(true);

    await processIncomingMessage({ channel: "local", patientId: "pat_rahul", messageType: "text", text: "How much does it cost?" });
    rahul = getPatientContext("pat_rahul")!;
    expect(String(rahul.messages.at(-1)?.content)).toContain("final cost depends");
    expect(String(rahul.messages.at(-1)?.content)).not.toMatch(/₹|Rs\.?\s*\d/);

    await processIncomingMessage({ channel: "local", patientId: "pat_rahul", messageType: "text", text: "Can I come tomorrow evening?" });
    await processIncomingMessage({ channel: "local", patientId: "pat_rahul", messageType: "text", text: "5:30 works." });
    rahul = getPatientContext("pat_rahul")!;
    expect(rahul.appointment?.status).toBe("confirmed"); expect(Number(rahul.patient.leadScore)).toBeGreaterThanOrEqual(90);

    setAiMode("pat_rahul", false); rahul = getPatientContext("pat_rahul")!;
    addMessage({ patientId: "pat_rahul", conversationId: String(rahul.conversation.id), direction: "outbound", senderType: "human", content: "Reception here. I have reviewed your booking." });
    const before = rahul.messages.length; await processIncomingMessage({ channel: "local", patientId: "pat_rahul", messageType: "text", text: "Thank you" });
    expect(getPatientContext("pat_rahul")!.messages.length).toBe(before + 2); // human message was added after the snapshot, then inbound; no AI reply
    setAiMode("pat_rahul", true); await processIncomingMessage({ channel: "local", patientId: "pat_rahul", messageType: "text", text: "Thank you" });
    expect(String(getPatientContext("pat_rahul")!.messages.at(-1)?.content)).toContain("remains confirmed");

    const csv = "name,phone,concern,opt in,source\nReturning Lead,9876543288,Previous hair enquiry,yes,old_crm\nUnknown Consent,9876543287,Skin enquiry,,old_crm";
    expect(importCsvLeads("old-leads.csv", csv).imported).toBe(2);
    const returning = getSqlite().prepare("SELECT id FROM patients WHERE phone='+919876543288'").get() as { id: string };
    const campaignId = createCampaign({ name: "Old lead re-engagement", templateId: "tpl_general_reengagement" });
    expect(startCampaign(campaignId).queued).toBeGreaterThanOrEqual(1);
    expect((await processOutboundOnce()).sent).toBeGreaterThanOrEqual(1);
    await processIncomingMessage({ channel: "local", patientId: returning.id, messageType: "text", text: "Yes, I remember. Please call me about a consultation." });
    createHumanTask({ patientId: returning.id, conversationId: String(getPatientContext(returning.id)!.conversation.id), type: "CALL", priority: "HIGH", title: "Returning high-intent lead — call" });
    expect((getSqlite().prepare("SELECT COUNT(*) AS count FROM human_tasks WHERE patient_id=? AND type='CALL'").get(returning.id) as { count: number }).count).toBe(1);
    expect((getSqlite().prepare("SELECT COUNT(*) AS count FROM audit_logs").get() as { count: number }).count).toBeGreaterThan(5);
  });
});
