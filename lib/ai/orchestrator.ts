import { addDays, format } from "date-fns";
import { checkSafety } from "./safety";
import { MockProvider } from "./providers/mock";
import { routeReceptionDecision } from "./router";
import { buildMinimalReceptionInput } from "./context-builder";
import { calculateLeadScoreWithReasons, temperatureFor } from "@/lib/crm/scoring";
import {
  addAudit, addEvent, addLeadScoreEvent, addMessage, bookAppointment, changeAppointment,
  createHumanTask, getAvailableSlots, getPatientContext, getSettings, scheduleAppointmentJobs, selectContent,
  setAiMode, timeLabel, treatmentCategory, updatePatient,
} from "@/lib/services/repository";

function displayTime(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

function parseMetadata(value: unknown) {
  try { return JSON.parse(String(value || "{}")) as Record<string, unknown>; } catch { return {}; }
}

function stageFor(intent: string, treatment: string | null, previous: string, humanRequired: boolean) {
  if (humanRequired) return "human_required";
  if (previous === "booked" && !["cancellation", "reschedule"].includes(intent)) return "booked";
  if (intent === "appointment") return "appointment_requested";
  if (treatment) return "qualified";
  return previous === "new" ? "engaged" : previous;
}

export async function processPatientMessage(patientId: string, content: string, options: { inboundAlreadyStored?: boolean; externalMessageId?: string | null; messageType?: string; mediaUrl?: string | null } = {}) {
  const initial = getPatientContext(patientId);
  if (!initial) throw new Error("Patient not found");
  const conversationId = String(initial.conversation.id);
  if (!options.inboundAlreadyStored) {
    addMessage({ patientId, conversationId, direction: "inbound", senderType: "patient", content, messageType: options.messageType, mediaUrl: options.mediaUrl, externalMessageId: options.externalMessageId });
  }
  addEvent(patientId, conversationId, "MESSAGE_RECEIVED", "Incoming message received", "Patient message accepted by the shared pipeline.");

  if (!initial.patient.aiEnabled || !initial.conversation.aiEnabled) return { mode: "human", replied: false };

  const safety = checkSafety(content);
  if (safety.escalate) {
    setAiMode(patientId, false, "SYSTEM");
    createHumanTask({ patientId, conversationId, type: "DOCTOR_REVIEW", priority: safety.emergency ? "URGENT" : "HIGH", title: safety.emergency ? "Urgent patient message" : "Clinical concern needs review", reason: safety.reason, suggestedReply: safety.reply });
    addMessage({ patientId, conversationId, direction: "outbound", senderType: "ai", content: safety.reply!, metadata: { escalation: true, emergency: safety.emergency } });
    addAudit("HUMAN_TAKEOVER", "patient", patientId, safety.reason || "Safety escalation", "SYSTEM");
    return { mode: "human", replied: true, escalation: true };
  }

  const refreshed = getPatientContext(patientId)!;
  const minimalInput = buildMinimalReceptionInput({
    message: content,
    patient: refreshed.patient,
    appointment: refreshed.appointment as Record<string, unknown> | null,
    recentMessages: refreshed.messages.slice(-12).map((message) => ({ senderType: String(message.senderType), content: String(message.content) })),
  });
  const routed = await routeReceptionDecision(minimalInput, { patientId, conversationId });
  let decision = routed.decision;

  if (routed.provider.name !== "mock") {
    const guardrail = await new MockProvider().generateReceptionDecision(minimalInput);
    decision = {
      ...decision,
      intent: guardrail.intent !== "unknown" ? guardrail.intent : decision.intent,
      treatmentSlug: guardrail.treatmentSlug ?? decision.treatmentSlug,
      extracted: Object.fromEntries(Object.entries(decision.extracted).map(([key, value]) => [key, guardrail.extracted[key as keyof typeof guardrail.extracted] ?? value])) as typeof decision.extracted,
      shouldSearchContent: guardrail.shouldSearchContent,
      contentQuery: guardrail.contentQuery ?? decision.contentQuery,
      shouldOfferBooking: guardrail.shouldOfferBooking,
      humanEscalation: guardrail.humanEscalation.required || guardrail.humanEscalation.recommended ? guardrail.humanEscalation : decision.humanEscalation,
      reply: ["pricing", "human_request", "post_procedure_concern"].includes(guardrail.intent) ? guardrail.reply : decision.reply,
    };
  }
  if (routed.fallbackUsed) {
    addEvent(patientId, conversationId, "PROVIDER_FALLBACK", "AI provider fallback activated", "A safe secondary engine handled this turn.", { provider: routed.provider.name });
    addAudit("AI_PROVIDER_FALLBACK", "conversation", conversationId, `Fallback provider: ${routed.provider.name}`, "AI", { patientId });
  }

  const changes: Record<string, unknown> = {};
  const slug = decision.treatmentSlug || (refreshed.patient.treatmentSlug as string | null);
  if (slug && slug !== refreshed.patient.treatmentSlug) {
    changes.treatmentSlug = slug;
    changes.treatmentCategory = treatmentCategory(slug);
    addEvent(patientId, conversationId, "INTENT_DETECTED", `Intent → ${slug.replaceAll("_", " ")}`, "Treatment interest classified from the conversation.");
  }
  if (decision.extracted.age && decision.extracted.age !== refreshed.patient.age) {
    changes.age = decision.extracted.age;
    addEvent(patientId, conversationId, "AGE_EXTRACTED", `Age → ${decision.extracted.age}`, "Patient age captured from the current message.");
  }
  if (decision.extracted.name && (/^(New|Demo|WhatsApp) Patient/i.test(String(refreshed.patient.name)) || /(?:my name is|this is)/i.test(content))) changes.name = decision.extracted.name;
  if (decision.extracted.concern && (!refreshed.patient.primaryConcern || /(?:actually|correction|not .*,)/i.test(content))) {
    changes.primaryConcern = decision.extracted.concern.slice(0, 180);
    addEvent(patientId, conversationId, "PATIENT_UPDATED", "Concern captured", "The CRM concern summary was updated.");
  }
  if (decision.extracted.duration && decision.extracted.duration !== refreshed.patient.concernDuration) changes.concernDuration = decision.extracted.duration;
  changes.leadStage = stageFor(decision.intent, slug, String(refreshed.patient.leadStage || "new"), decision.humanEscalation.required);
  updatePatient(patientId, changes);

  const afterFields = getPatientContext(patientId)!;
  const transcript = afterFields.messages.filter((message) => message.senderType === "patient").map((message) => String(message.content));
  const scored = calculateLeadScoreWithReasons(afterFields.patient, transcript, String(changes.leadStage));
  const oldScore = Number(refreshed.patient.leadScore || 0);
  if (scored.score !== oldScore) {
    updatePatient(patientId, { leadScore: scored.score, leadTemperature: temperatureFor(scored.score) });
    addLeadScoreEvent(patientId, conversationId, oldScore, scored.score, scored.reasons);
    addEvent(patientId, conversationId, "LEAD_SCORE_CHANGED", `Lead score → ${scored.score}`, `${oldScore} → ${scored.score}`, { from: oldScore, to: scored.score, reasons: scored.reasons });
  }
  const callThreshold = Number(getSettings().humanCallScoreThreshold || 85);
  const callRecommended = /\b(call me|call back|speak on (?:the )?phone|treatment soon|this week)\b/i.test(content)
    || (decision.intent === "pricing" && Boolean(slug) && scored.score >= 60)
    || (decision.intent === "appointment" && Boolean(decision.extracted.desiredDate) && scored.score >= callThreshold);
  if (callRecommended && String(changes.leadStage) !== "booked") {
    createHumanTask({ patientId, conversationId, type: "CALL", priority: scored.score >= callThreshold ? "HIGH" : "NORMAL", title: scored.score >= callThreshold ? "High-intent lead — call now" : "Patient callback recommended", reason: `Deterministic rule: lead score ${scored.score}; intent ${decision.intent}.`, suggestedReply: "Thank you. A member of our reception team can call you to help with the next step. Please share a convenient time if needed." });
  }

  if (decision.intent === "cancellation" && refreshed.appointment?.status === "confirmed") {
    changeAppointment(String(refreshed.appointment.id), "cancel");
    const reply = "Your consultation has been cancelled and its pending reminders have been stopped. If you would like another time later, just message us here.";
    addMessage({ patientId, conversationId, direction: "outbound", senderType: "ai", messageType: "appointment", content: reply });
    addEvent(patientId, conversationId, "APPOINTMENT_CHANGED", "Appointment cancelled", "Patient requested cancellation.");
    addAudit("APPOINTMENT_CHANGED", "appointment", String(refreshed.appointment.id), "Appointment cancelled", "AI", { patientId });
    return { mode: "ai", replied: true, appointmentChanged: "cancelled" };
  }

  const lastOffer = [...afterFields.messages].reverse().map((message) => parseMetadata(message.metadataJson)).find((meta) => Array.isArray(meta.slots));
  const selectedTime = decision.extracted.desiredTime;
  const offeredSlots = Array.isArray(lastOffer?.slots) ? lastOffer.slots.map(String) : [];
  if (selectedTime && lastOffer?.offeredDate && offeredSlots.includes(selectedTime)) {
    try {
      const appointment = bookAppointment(patientId, conversationId, slug, String(lastOffer.offeredDate), selectedTime);
      const schedule = scheduleAppointmentJobs(appointment);
      const patient = getPatientContext(patientId)!.patient;
      const reply = `Perfect, ${String(patient.name).split(" ")[0]}. Your consultation at Radiance Clinics, Bhubaneswar is confirmed for ${timeLabel(appointment.dateTime)}. If you need to change the time, just message here and I’ll help.`;
      addMessage({ patientId, conversationId, direction: "outbound", senderType: "ai", messageType: "appointment", content: reply, metadata: { appointmentId: appointment.id, dateTime: appointment.dateTime, status: "confirmed" } });
      addEvent(patientId, conversationId, "APPOINTMENT_CREATED", "Appointment confirmed", timeLabel(appointment.dateTime));
      addEvent(patientId, conversationId, "FOLLOWUP_SCHEDULED", "Reminders scheduled", `Reminders scheduled in ${schedule.firstSeconds}s and ${schedule.secondSeconds}s.`);
      addAudit("APPOINTMENT_CREATED", "appointment", appointment.id, "Consultation booked", "AI", { patientId });
      return { mode: "ai", replied: true, appointment };
    } catch (error) {
      decision.reply = `${error instanceof Error ? error.message : "That time is unavailable"} I can show you the remaining options.`;
      decision.shouldOfferBooking = true;
    }
  }

  if (decision.intent === "reschedule") decision.shouldOfferBooking = true;
  if (decision.shouldOfferBooking) {
    const offeredDate = decision.extracted.desiredDate || String(lastOffer?.offeredDate || format(addDays(new Date(), 1), "yyyy-MM-dd"));
    const period = /evening/i.test(content) ? "evening" : /morning/i.test(content) ? "morning" : null;
    const available = getAvailableSlots(offeredDate, period);
    const slots = (period === "evening" ? available.filter((slot) => slot >= "17:00") : available).slice(0, 3);
    if (slots.length) {
      const reply = `Yes — I checked the actual consultation calendar. ${format(new Date(`${offeredDate}T12:00:00`), "EEEE, d MMMM")} has ${slots.map(displayTime).join(", ")} available. Which time would suit you?`;
      updatePatient(patientId, { leadStage: "booking_offered" });
      addEvent(patientId, conversationId, "BOOKING_OFFERED", "Consultation times offered", slots.map(displayTime).join(", "), { date: offeredDate, slots });
      addMessage({ patientId, conversationId, direction: "outbound", senderType: "ai", content: reply, metadata: { offeredDate, slots } });
      addEvent(patientId, conversationId, "AI_REPLY_CREATED", "AI reply generated", `Provider: ${routed.provider.name}`);
      addAudit("AI_REPLIED", "conversation", conversationId, "Booking options sent", "AI", { patientId });
      return { mode: "ai", replied: true, slots };
    }
  }

  if (decision.humanEscalation.required || decision.humanEscalation.recommended) {
    const type = decision.humanEscalation.type === "doctor_review" ? "DOCTOR_REVIEW" : decision.humanEscalation.type === "call" ? "CALL" : "CHAT_TAKEOVER";
    createHumanTask({ patientId, conversationId, type, priority: decision.humanEscalation.priority.toUpperCase() as "URGENT" | "HIGH" | "NORMAL" | "LOW", title: decision.humanEscalation.type === "doctor_review" ? "Doctor review requested" : "Reception follow-up requested", reason: decision.humanEscalation.reason, suggestedReply: decision.reply });
    if (decision.humanEscalation.required) setAiMode(patientId, false, "SYSTEM");
  }

  addMessage({ patientId, conversationId, direction: "outbound", senderType: "ai", content: decision.reply });
  addEvent(patientId, conversationId, "AI_REPLY_CREATED", "AI reply generated", `Provider: ${routed.provider.name}`);
  addAudit("AI_REPLIED", "conversation", conversationId, "Reception reply generated", "AI", { patientId, provider: routed.provider.name });

  if (decision.shouldSearchContent) {
    const item = selectContent(conversationId, slug, decision.contentQuery);
    if (item) {
      const verifiedRadiance = /(?:youtube\.com|youtu\.be)\/(?:@RadianceClinics|watch\?v=8qYMw935MF8)/i.test(String(item.url));
      addMessage({ patientId, conversationId, direction: "outbound", senderType: "ai", messageType: String(item.type), content: String(item.description), mediaUrl: String(item.url), contentItemId: String(item.id), metadata: { title: item.title, demo: !verifiedRadiance, verifiedRadiance } });
      addEvent(patientId, conversationId, "CONTENT_SELECTED", "Relevant approved content selected", String(item.title), { contentItemId: item.id });
    }
  }

  const updated = getPatientContext(patientId)!;
  const summary = await new MockProvider().summarizePatient({ patient: updated.patient, messages: updated.messages.map((message) => ({ senderType: String(message.senderType), content: String(message.content) })) });
  updatePatient(patientId, { aiSummary: summary });
  return { mode: decision.humanEscalation.required ? "human" : "ai", replied: true };
}
