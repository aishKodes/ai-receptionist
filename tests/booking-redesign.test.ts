import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databasePath, getSqlite } from "@/db";
import { processPatientMessage } from "@/lib/ai/orchestrator";
import { seedDatabase } from "@/lib/db/setup";
import { ensurePatientForChannel, getPatientContext, updatePatient } from "@/lib/services/repository";
import { appointmentConfiguration, saveAppointmentConfiguration } from "@/lib/scheduling/availability";
import { dateForOffset } from "@/lib/scheduling/booking-policy";

beforeAll(() => seedDatabase(true));
afterAll(() => {
  getSqlite().close();
  for (const suffix of ["", "-wal", "-shm"]) { try { fs.unlinkSync(`${databasePath}${suffix}`); } catch {} }
});

function newLead(phone: string) {
  const context = ensurePatientForChannel({ name: "Booking Regression", phone: `+91${phone}`, channel: "local" });
  updatePatient(String(context.patient.id), { source: "local_test", primaryConcern: "Hair thinning", treatmentCategory: "Hair", treatmentSlug: "hair_loss" });
  return String(context.patient.id);
}

describe("Radiance natural booking regression", () => {
  it("answers a direct hair concern without sending a top-level menu", async () => {
    const patientId = newLead("9876543101");
    await processPatientMessage(patientId, "I have thinning around my crown");
    const reply = getPatientContext(patientId)!.messages.at(-1)!;
    expect(reply.content).not.toMatch(/Hair\s*\n.*Skin|1\. Hair/i);
    expect(reply.messageType).toBe("text");
  });

  it("confirms a fully specified date/time immediately and clears stale choices", async () => {
    const patientId = newLead("9876543102");
    await processPatientMessage(patientId, "I have thinning around my crown. Can I come tomorrow around 4?");
    let context = getPatientContext(patientId)!;
    expect(context.appointment?.status).toBe("confirmed");
    expect(context.appointment?.dateTime).toContain(`${dateForOffset(1)}T16:00`);
    expect(String(context.messages.at(-1)?.content)).toMatch(/confirmed/i);
    expect(String(context.messages.at(-1)?.content)).not.toMatch(/requested|awaiting|finalise/i);
    expect(context.state.pendingAction).toBeNull();
    expect(String(context.state.interactionOptionsJson)).toMatch(/Get directions|Reschedule|Cancel appointment/);
    expect(String(context.state.interactionOptionsJson)).not.toMatch(/Check consultation slots|assessment/i);

    await processPatientMessage(patientId, "Is my consultation booked?");
    context = getPatientContext(patientId)!;
    expect(String(context.messages.at(-1)?.content)).toMatch(/Yes\. You’re confirmed/i);
  });

  it("uses idempotency for the same booking and reschedules instead of creating a second active appointment", async () => {
    const patientId = newLead("9876543103");
    await processPatientMessage(patientId, "Tomorrow at 3 pm");
    await processPatientMessage(patientId, "Tomorrow at 3 pm");
    let rows = getSqlite().prepare("SELECT status FROM appointments WHERE patient_id=?").all(patientId) as Array<{ status: string }>;
    expect(rows.filter((row) => row.status === "confirmed")).toHaveLength(1);
    expect(String(getPatientContext(patientId)!.messages.at(-1)?.content)).toMatch(/already booked/i);

    await processPatientMessage(patientId, "Make it 4 pm");
    rows = getSqlite().prepare("SELECT status FROM appointments WHERE patient_id=?").all(patientId) as Array<{ status: string }>;
    expect(rows.filter((row) => row.status === "confirmed")).toHaveLength(1);
    expect(rows.filter((row) => row.status === "rescheduled")).toHaveLength(1);
    expect(getPatientContext(patientId)!.appointment?.dateTime).toContain("T16:00");

    await processPatientMessage(patientId, "Cancel it");
    expect(getPatientContext(patientId)!.appointment?.status).toBe("cancelled");
  });

  it("rejects closed dates and times outside 10 AM–6 PM without inserting an appointment", async () => {
    const patientId = newLead("9876543104");
    await processPatientMessage(patientId, "Tomorrow at 8 pm");
    expect(getPatientContext(patientId)!.appointment).toBeNull();
    expect(String(getPatientContext(patientId)!.messages.at(-1)?.content)).toMatch(/outside the clinic’s booking hours/i);

    const config = appointmentConfiguration();
    const closed = dateForOffset(2);
    saveAppointmentConfiguration({ ...config, closedDates: [...config.closedDates, closed] });
    await processPatientMessage(patientId, `Book me on ${closed} at 3 pm`);
    expect(getPatientContext(patientId)!.appointment).toBeNull();
    expect(String(getPatientContext(patientId)!.messages.at(-1)?.content)).toMatch(/closed/i);
  });

  it("accepts the inclusive 6 PM closing boundary and arbitrary times", async () => {
    const patientId = newLead("9876543105");
    await processPatientMessage(patientId, "Tomorrow at 6 pm");
    expect(getPatientContext(patientId)!.appointment?.status).toBe("confirmed");
    expect(getPatientContext(patientId)!.appointment?.dateTime).toContain("T18:00");
  });
});
