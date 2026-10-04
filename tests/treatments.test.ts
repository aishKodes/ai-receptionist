import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databasePath, getSqlite } from "@/db";
import { seedDatabase } from "@/lib/db/setup";
import {
  addAiFeedback,
  answerRadianceQuestion,
  createManualLead,
  getTreatmentCatalog,
  resolveDoctorReview,
  saveCatalogItem,
} from "@/lib/product/operations";
import {
  changeAppointment,
  createHumanTask,
  getPatientContext,
  updateHumanTask,
} from "@/lib/services/repository";
import {
  greetingInteraction,
  resolveInteractionInput,
} from "@/lib/product/interactions";
import { processPatientMessage } from "@/lib/ai/orchestrator";
import { getApprovedKnowledgeSnapshot } from "@/lib/product/pricing";
import { appointmentConfiguration } from "@/lib/scheduling/availability";

beforeAll(() => seedDatabase(true));
afterAll(() => {
  getSqlite().close();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(`${databasePath}${suffix}`);
    } catch {}
  }
});

describe("treatment catalog and lead context", () => {
  it("seeds the editable hair, skin and aesthetics hierarchy", () => {
    const catalog = getTreatmentCatalog();
    expect(catalog.categories).toHaveLength(3);
    expect(catalog.concerns.length).toBeGreaterThanOrEqual(18);
    expect(catalog.prices.length).toBeGreaterThanOrEqual(19);
  });
  it("creates a manual lead without outbound contact and preserves context", () => {
    const result = createManualLead({
      name: "Context Lead",
      phone: "9876543277",
      source: "MANUAL",
      primaryConcern: "Frontal recession",
      treatmentCategory: "Hair",
      treatmentSlug: "hair_transplant",
      context: "Asked price previously. Comparing clinics.",
      previousInteraction: "Called two weeks ago.",
      nextAction: "CALL",
    });
    const context = getPatientContext(result.patientId)!;
    expect(context.messages).toHaveLength(0);
    expect(context.patient.contextNotes).toContain("Asked price");
    expect(context.state.nextBestAction).toBe("CALL");
  });
  it("maps numeric choices to the same structured option", () => {
    expect(
      resolveInteractionInput("2", greetingInteraction().options)?.value,
    ).toBe("category:skin");
  });
  it("uses selectable choices only for a genuine booking-time decision", async () => {
    await processPatientMessage("pat_rahul", "Hi");
    expect(
      String(getPatientContext("pat_rahul")?.messages.at(-1)?.content),
    ).toContain("Ananya");
    await processPatientMessage("pat_rahul", "1");
    await processPatientMessage("pat_rahul", "4");
    await processPatientMessage("pat_rahul", "1");
    expect(
      String(getPatientContext("pat_rahul")?.messages.at(-1)?.content),
    ).toContain("₹45 per graft");
    await processPatientMessage("pat_rahul", "1");
    await processPatientMessage("pat_rahul", "2");
    const state = getPatientContext("pat_rahul")!.state;
    expect(state.pendingAction).toBe("collect_booking_time");
    expect(String(state.interactionOptionsJson)).toContain("time_");
  });
  it("keeps one next action for every active lead", () => {
    const missing = getSqlite()
      .prepare(
        "SELECT COUNT(*) AS count FROM patients p JOIN conversations c ON c.patient_id=p.id LEFT JOIN conversation_state cs ON cs.conversation_id=c.id WHERE p.lead_stage NOT IN ('lost','not_interested') AND (cs.next_best_action IS NULL OR cs.next_best_action='')",
      )
      .get() as { count: number };
    expect(missing.count).toBe(0);
  });
  it("keeps a doctor response patient-specific unless guidance is explicitly drafted", async () => {
    createHumanTask({
      patientId: "pat_ananya",
      conversationId: "con_ananya",
      type: "DOCTOR_REVIEW",
      priority: "HIGH",
      title: "Clinical question",
      reason: "Is this treatment suitable after a recent procedure?",
    });
    const review = getSqlite()
      .prepare(
        "SELECT id FROM doctor_reviews WHERE patient_id='pat_ananya' AND status='OPEN'",
      )
      .get() as { id: string };
    await resolveDoctorReview({
      reviewId: review.id,
      doctorResponse: "Ask them to come tomorrow morning.",
    });
    expect(
      (
        getSqlite()
          .prepare(
            "SELECT COUNT(*) AS count FROM knowledge_items WHERE source='DOCTOR_REVIEW'",
          )
          .get() as { count: number }
      ).count,
    ).toBe(0);
    expect(
      String(getPatientContext("pat_ananya")?.messages.at(-1)?.content),
    ).toMatch(/doctor would like you to visit/i);
  });
  it("allows only explicitly approved active guidance into the AI snapshot", () => {
    const id = saveCatalogItem("knowledge", {
      title: "Draft clinical guidance",
      content: "Draft-only claim",
      approvalStatus: "DRAFT",
      source: "TEST",
    });
    expect(JSON.stringify(getApprovedKnowledgeSnapshot())).not.toContain(
      "Draft-only claim",
    );
    saveCatalogItem("knowledge", {
      id,
      title: "Draft clinical guidance",
      content: "Approved clinic guidance",
      approvalStatus: "APPROVED",
      source: "TEST",
    });
    expect(JSON.stringify(getApprovedKnowledgeSnapshot())).toContain(
      "Approved clinic guidance",
    );
  });
  it("keeps Saturday closed and Sunday through Friday on the approved clinic schedule", () => {
    const schedule = appointmentConfiguration();
    expect(schedule.weekly.saturday).toHaveLength(0);
    expect(schedule.weekly.sunday).toEqual([{ start: "10:00", end: "18:00" }]);
  });
  it("creates no-show recovery state and offers a schedule-safe reschedule", async () => {
    changeAppointment("apt_debashish", "no_show");
    await processPatientMessage("pat_debashish", "Sorry I couldn't come");
    const context = getPatientContext("pat_debashish")!;
    expect(context.state.nextBestAction).toBe("CHECK_SLOTS");
    expect(String(context.messages.at(-1)?.content)).toContain("reschedule");
    expect(String(context.state.interactionOptionsJson)).not.toContain(
      "Saturday",
    );
    expect(
      (
        getSqlite()
          .prepare(
            "SELECT COUNT(*) AS count FROM scheduled_jobs WHERE appointment_id='apt_debashish' AND job_type='NO_SHOW_RECOVERY'",
          )
          .get() as { count: number }
      ).count,
    ).toBe(1);
  });
  it("stores timed callbacks and structured lost reasons", async () => {
    const lead = createManualLead({
      name: "Callback Lead",
      phone: "9876543266",
      source: "PHONE",
      primaryConcern: "Hair loss",
    });
    await processPatientMessage(lead.patientId, "Please call me after 6 pm");
    expect(getPatientContext(lead.patientId)?.patient.callbackAt).toBeTruthy();
    const task = getSqlite()
      .prepare(
        "SELECT id FROM human_tasks WHERE patient_id=? AND type='CALLBACK'",
      )
      .get(lead.patientId) as { id: string };
    updateHumanTask(
      task.id,
      "NOT_INTERESTED",
      "Front Desk",
      "Closed after call",
      "TIMING",
    );
    const patient = getPatientContext(lead.patientId)!.patient;
    expect(patient.leadStage).toBe("not_interested");
    expect(patient.lostReason).toBe("TIMING");
  });
  it("stores AI feedback and returns deterministic Ask Radiance data", () => {
    const message = getSqlite()
      .prepare(
        "SELECT id FROM messages WHERE patient_id='pat_ananya' AND sender_type='ai' LIMIT 1",
      )
      .get() as { id: string };
    addAiFeedback({
      messageId: message.id,
      patientId: "pat_ananya",
      rating: "NEEDS_IMPROVEMENT",
      reason: "Missed context",
    });
    expect(
      (
        getSqlite()
          .prepare(
            "SELECT COUNT(*) AS count FROM ai_feedback WHERE patient_id='pat_ananya'",
          )
          .get() as { count: number }
      ).count,
    ).toBe(1);
    expect(
      answerRadianceQuestion("How many callbacks are pending?").intent,
    ).toBe("CALLBACKS");
  });
});
