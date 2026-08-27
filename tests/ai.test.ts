import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import { MockProvider } from "@/lib/ai/providers/mock";
import { checkSafety } from "@/lib/ai/safety";
import { calculateLeadScore, temperatureFor } from "@/lib/crm/scoring";
import { databasePath, getSqlite } from "@/db";
import { seedDatabase } from "@/lib/db/setup";
import { processPatientMessage } from "@/lib/ai/orchestrator";
import { getPatientContext } from "@/lib/services/repository";
import { processDueJobsOnce } from "@/lib/scheduling/worker";

beforeAll(() => seedDatabase(true));
afterAll(() => {
  getSqlite().close();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(`${databasePath}${suffix}`); } catch {}
  }
});

describe("Radiance reception intelligence", () => {
  it("classifies treatment and extracts reliable entities", async () => {
    const decision = await new MockProvider().generateReceptionDecision({
      message: "Hi, I'm 29 and my hair has become very thin from the front for almost 3 years. I am thinking about hair transplant.",
      patient: { name: "Rahul Sharma", leadScore: 12 }, recentMessages: [], knowledge: "",
    });
    expect(decision.treatmentSlug).toBe("hair_transplant");
    expect(decision.extracted.age).toBe(29);
    expect(decision.extracted.duration).toBe("3 years");
    expect(decision.shouldSearchContent).toBe(true);
  });

  it("uses deterministic safety escalation", () => {
    const result = checkSafety("I have breathing difficulty after the procedure");
    expect(result.emergency).toBe(true);
    expect(result.escalate).toBe(true);
    expect(result.reply).toContain("urgent medical attention");
  });

  it("keeps score and temperature deterministic", () => {
    const score = calculateLeadScore({ age: 29, treatmentSlug: "hair_transplant", primaryConcern: "Frontal thinning for almost three years" }, ["How much does it cost? Can I come tomorrow evening?"], "booking_offered");
    expect(score).toBeGreaterThanOrEqual(70);
    expect(temperatureFor(score)).toBe("HOT");
  });
});

describe("primary end-to-end demo pipeline", () => {
  it("captures CRM fields, safely answers price, offers slots and books", async () => {
    await processPatientMessage("pat_rahul", "Hi, I'm 29 and my hair has become very thin from the front for almost 3 years. I'm thinking about hair transplant.");
    let context = getPatientContext("pat_rahul")!;
    expect(context.patient.age).toBe(29);
    expect(context.patient.treatmentSlug).toBe("hair_transplant");
    expect(Number(context.patient.leadScore)).toBeGreaterThanOrEqual(70);
    const recommended = context.messages.find((message) => message.contentItemId);
    expect(recommended?.mediaUrl).toBe("https://www.youtube.com/watch?v=8qYMw935MF8");
    expect(JSON.parse(String(recommended?.metadataJson))).toMatchObject({ verifiedRadiance: true, demo: false });

    await processPatientMessage("pat_rahul", "How much does it cost?");
    context = getPatientContext("pat_rahul")!;
    const priceReply = String(context.messages.at(-1)?.content);
    expect(priceReply).toContain("final cost depends");
    expect(priceReply).not.toMatch(/₹|Rs\.?\s*\d|\d+,\d{3}/);

    await processPatientMessage("pat_rahul", "Can I come tomorrow evening?");
    context = getPatientContext("pat_rahul")!;
    expect(String(context.messages.at(-1)?.content)).toContain("5:30 PM");

    await processPatientMessage("pat_rahul", "5:30 works");
    context = getPatientContext("pat_rahul")!;
    expect(context.appointment?.status).toBe("confirmed");
    expect(context.patient.leadStage).toBe("booked");
    expect(Number(context.patient.leadScore)).toBeGreaterThanOrEqual(90);
    const jobs = getSqlite().prepare("SELECT * FROM scheduled_jobs WHERE patient_id='pat_rahul'").all() as Array<{ status: string }>;
    expect(jobs).toHaveLength(3);
    expect(jobs.filter((job) => job.status === "pending")).toHaveLength(2);

    await processPatientMessage("pat_rahul", "Thank you");
    context = getPatientContext("pat_rahul")!;
    expect(String(context.messages.at(-1)?.content)).toContain("remains confirmed");
    expect(context.patient.leadStage).toBe("booked");
  });

  it("executes a due reminder exactly once", async () => {
    const db = getSqlite();
    const job = db.prepare("SELECT id FROM scheduled_jobs WHERE patient_id='pat_rahul' AND status='pending' ORDER BY scheduled_for LIMIT 1").get() as { id: string };
    db.prepare("UPDATE scheduled_jobs SET scheduled_for=? WHERE id=?").run(new Date(Date.now() - 1000).toISOString(), job.id);
    expect((await processDueJobsOnce()).completed).toBe(1);
    expect((await processDueJobsOnce()).completed).toBe(0);
    const messages = db.prepare("SELECT COUNT(*) AS count FROM messages WHERE metadata_json LIKE ?").get(`%${job.id}%`) as { count: number };
    expect(messages.count).toBe(1);
  });
});
