import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { addAudit, addEvent, addMessage, bookAppointment, changeAppointment, getPatientContext, rescheduleAppointment, scheduleAppointmentJobs, timeLabel } from "@/lib/services/repository";
import { enforceRateLimit, enforceSameOrigin } from "@/lib/security/http";

const Schema = z.object({ action: z.enum(["book", "cancel", "reschedule", "complete", "no_show"]), patientId: z.string(), date: z.string().optional(), time: z.string().optional(), appointmentId: z.string().optional() });

export async function POST(request: NextRequest) {
  try {
    enforceSameOrigin(request); enforceRateLimit(request, "appointments", 40);
    const input = Schema.parse(await request.json());
    const context = getPatientContext(input.patientId);
    if (!context) return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    const conversationId = String(context.conversation.id);
    if (["cancel", "complete", "no_show"].includes(input.action)) {
      if (!input.appointmentId) throw new Error("Appointment id is required");
      const status = input.action as "cancel" | "complete" | "no_show";
      changeAppointment(input.appointmentId, status);
      addEvent(input.patientId, conversationId, "APPOINTMENT_CHANGED", `Appointment ${status.replace("_", " ")}`, "Updated by reception.");
      addAudit("APPOINTMENT_CHANGED", "appointment", input.appointmentId, `Appointment ${status.replace("_", " ")}`, "RECEPTION", { patientId: input.patientId });
      if (status === "cancel") addMessage({ patientId: input.patientId, conversationId, direction: "outbound", senderType: "human", messageType: "system", content: "Your consultation has been cancelled. Message us whenever you would like help finding another time." });
      return NextResponse.json({ ok: true });
    }
    if (!input.date || !input.time) throw new Error("Date and time are required");
    const appointment = input.action === "reschedule" && input.appointmentId ? rescheduleAppointment(input.appointmentId, input.date, input.time) : bookAppointment(input.patientId, conversationId, String(context.patient.treatmentSlug || "general_skin"), input.date, input.time);
    const schedule = input.action === "reschedule" ? { firstSeconds: 0, secondSeconds: 0 } : scheduleAppointmentJobs(appointment);
    const copy = `Your consultation at Radiance Clinics, Bhubaneswar is confirmed for ${timeLabel(appointment.dateTime)}.`;
    addMessage({ patientId: input.patientId, conversationId, direction: "outbound", senderType: "human", messageType: "appointment", content: copy, metadata: { appointmentId: appointment.id, dateTime: appointment.dateTime, status: "confirmed" } });
    addEvent(input.patientId, conversationId, input.action === "reschedule" ? "APPOINTMENT_CHANGED" : "APPOINTMENT_CREATED", input.action === "reschedule" ? "Appointment rescheduled" : "Appointment confirmed", timeLabel(appointment.dateTime));
    addEvent(input.patientId, conversationId, "FOLLOWUP_SCHEDULED", "Reminders scheduled", `Demo reminders in ${schedule.firstSeconds}s and ${schedule.secondSeconds}s.`);
    return NextResponse.json({ ok: true, appointment });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Appointment action failed" }, { status: 400 }); }
}
