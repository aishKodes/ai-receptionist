import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databasePath, getSqlite } from "@/db";
import { seedDatabase } from "@/lib/db/setup";
import { answerStaffCommand, findAuthorizedStaff, saveStaffContact } from "@/lib/product/staff-mode";
import { processIncomingMessage } from "@/lib/channels/pipeline";

beforeAll(() => seedDatabase(true));
afterAll(() => { getSqlite().close(); for (const suffix of ["", "-wal", "-shm"]) { try { fs.unlinkSync(`${databasePath}${suffix}`); } catch {} } });

describe("authorized staff command mode", () => {
  it("routes an authorized doctor to deterministic database answers", async () => {
    saveStaffContact({ name: "Clinic Doctor", phone: "9876543299", role: "DOCTOR", canViewSummaries: true, canViewAppointments: true, canReceiveDoctorReview: true, canApproveKnowledge: true });
    const doctor = findAuthorizedStaff("919876543299"); expect(doctor?.role).toBe("DOCTOR");
    expect(answerStaffCommand(doctor!, "Today?").answer).toMatch(/Today at Radiance:/);
    expect(answerStaffCommand(doctor!, "Hot leads?").answer).toMatch(/Top leads|no open hot leads/i);
    expect(answerStaffCommand(doctor!, "Appointments tomorrow?").answer).toMatch(/confirmed consultation/);
    const routed = await processIncomingMessage({ channel: "local", from: "919876543299", text: "Who needs me?", messageType: "text" });
    expect(routed.staffMode).toBe(true); expect(routed.intent).toBe("DOCTOR_REVIEWS");
  });
  it("never exposes staff mode to an unknown external number", async () => {
    expect(findAuthorizedStaff("919876543298")).toBeNull();
    const routed = await processIncomingMessage({ channel: "local", from: "919876543298", text: "Today?", messageType: "text" });
    expect(routed.staffMode).not.toBe(true);
  });
});
