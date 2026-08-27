import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSqlite, nowIso } from "@/db";
import { addEvent, addMessage, bookAppointment, getPatientContext, scheduleAppointmentJobs, timeLabel, updatePatient } from "@/lib/services/repository";

const Schema = z.object({ action: z.enum(["book", "cancel"]), patientId: z.string(), date: z.string().optional(), time: z.string().optional(), appointmentId: z.string().optional() });

export async function POST(request: NextRequest) {
  try {
    const input = Schema.parse(await request.json());
    const context = getPatientContext(input.patientId);
    if (!context) return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    const conversationId = String(context.conversation.id);
    if (input.action === "cancel") {
      if (!input.appointmentId) throw new Error("Appointment id is required");
      getSqlite().prepare("UPDATE appointments SET status='cancelled',updated_at=? WHERE id=? AND patient_id=?").run(nowIso(), input.appointmentId, input.patientId);
      getSqlite().prepare("UPDATE scheduled_jobs SET status='cancelled' WHERE appointment_id=? AND status='pending'").run(input.appointmentId);
      updatePatient(input.patientId, { leadStage: "follow_up", nextFollowupAt: null });
      addEvent(input.patientId, conversationId, "APPOINTMENT_CANCELLED", "Appointment cancelled", "Updated by reception.");
      addMessage({ patientId: input.patientId, conversationId, direction: "outbound", senderType: "human", messageType: "system", content: "Your consultation has been cancelled. Message us whenever you would like help finding another time." });
      return NextResponse.json({ ok: true });
    }
    if (!input.date || !input.time) throw new Error("Date and time are required");
    const appointment = bookAppointment(input.patientId, conversationId, String(context.patient.treatmentSlug || "general_skin"), input.date, input.time);
    const schedule = scheduleAppointmentJobs(appointment);
    const copy = `Your consultation at Radiance Clinics, Bhubaneswar is confirmed for ${timeLabel(appointment.dateTime)}.`;
    addMessage({ patientId: input.patientId, conversationId, direction: "outbound", senderType: "human", messageType: "appointment", content: copy, metadata: { appointmentId: appointment.id, dateTime: appointment.dateTime, status: "confirmed" } });
    addEvent(input.patientId, conversationId, "APPOINTMENT_CREATED", "Appointment confirmed", timeLabel(appointment.dateTime));
    addEvent(input.patientId, conversationId, "FOLLOWUP_SCHEDULED", "Reminders scheduled", `Demo reminders in ${schedule.firstSeconds}s and ${schedule.secondSeconds}s.`);
    return NextResponse.json({ ok: true, appointment });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Appointment action failed" }, { status: 400 }); }
}
