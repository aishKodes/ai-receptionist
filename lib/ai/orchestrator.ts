import { addDays, format } from "date-fns";
import knowledge from "@/data/radiance-knowledge.json";
import { checkSafety } from "./safety";
import { getProvider, providerStatus } from "./provider-factory";
import { MockProvider } from "./providers/mock";
import { calculateLeadScore, temperatureFor } from "@/lib/crm/scoring";
import { addEvent, addMessage, bookAppointment, getAvailableSlots, getPatientContext, scheduleAppointmentJobs, selectContent, timeLabel, treatmentCategory, updatePatient } from "@/lib/services/repository";

function displayTime(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  const h = hour % 12 || 12;
  return `${h}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

function parseMetadata(value: unknown) {
  try { return JSON.parse(String(value || "{}")) as Record<string, unknown>; } catch { return {}; }
}

export async function processPatientMessage(patientId: string, content: string) {
  const initial = getPatientContext(patientId);
  if (!initial) throw new Error("Patient not found");
  const conversationId = String(initial.conversation.id);
  console.log(`[INCOMING] ${initial.patient.name}: ${content}`);
  addMessage({ patientId, conversationId, direction: "inbound", senderType: "patient", content });
  addEvent(patientId, conversationId, "MESSAGE_RECEIVED", "Incoming message received", content.slice(0, 160));

  if (!initial.patient.aiEnabled || !initial.conversation.aiEnabled) return { mode: "human", replied: false };

  const safety = checkSafety(content);
  if (safety.escalate) {
    updatePatient(patientId, { aiEnabled: false, assignedTo: "Front Desk", leadStage: "human_required" });
    const db = (await import("@/db")).getSqlite();
    db.prepare("UPDATE conversations SET ai_enabled=0 WHERE id=?").run(conversationId);
    addEvent(patientId, conversationId, "HUMAN_ESCALATION", safety.emergency ? "Urgent medical escalation" : "Human attention required", safety.reason);
    addMessage({ patientId, conversationId, direction: "outbound", senderType: "ai", content: safety.reply!, metadata: { escalation: true, emergency: safety.emergency } });
    return { mode: "human", replied: true, escalation: true };
  }

  const refreshed = getPatientContext(patientId)!;
  const recentMessages = refreshed.messages.slice(-12).map((message) => ({ senderType: String(message.senderType), content: String(message.content) }));
  const providerInput = { message: content, patient: refreshed.patient, recentMessages, knowledge: JSON.stringify(knowledge) };
  let provider = getProvider();
  let decision;
  try {
    decision = await provider.generateReceptionDecision(providerInput);
  } catch (error) {
    console.error(`[AI] ${provider.name} failed: ${error instanceof Error ? error.message : "unknown error"}`);
    addEvent(patientId, conversationId, "PROVIDER_FALLBACK", "AI provider fallback activated", `${provider.name} was unavailable; the safe demo provider continued.`);
    if (!providerStatus().fallback) throw error;
    provider = new MockProvider();
    decision = await provider.generateReceptionDecision(providerInput);
  }
  if (provider.name !== "mock") {
    const guardrail = await new MockProvider().generateReceptionDecision(providerInput);
    if (guardrail.intent !== "unknown") decision.intent = guardrail.intent;
    decision.treatmentSlug = guardrail.treatmentSlug ?? decision.treatmentSlug;
    decision.extracted = Object.fromEntries(Object.entries(decision.extracted).map(([key, value]) => [key, guardrail.extracted[key as keyof typeof guardrail.extracted] ?? value])) as typeof decision.extracted;
    decision.shouldSendContent = guardrail.shouldSendContent;
    decision.contentQuery = guardrail.contentQuery ?? decision.contentQuery;
    decision.shouldOfferBooking = guardrail.shouldOfferBooking;
    decision.shouldEscalateHuman = guardrail.shouldEscalateHuman;
    decision.escalationReason = guardrail.escalationReason ?? decision.escalationReason;
    if (guardrail.leadStage !== "engaged" || decision.leadStage === "new") decision.leadStage = guardrail.leadStage;
    if (guardrail.intent === "pricing" || guardrail.intent === "human_request") decision.reply = guardrail.reply;
  }
  console.log(`[AI] provider=${provider.name} intent=${decision.intent} treatment=${decision.treatmentSlug || refreshed.patient.treatmentSlug || "unknown"}`);

  const changes: Record<string, unknown> = {};
  const slug = decision.treatmentSlug || (refreshed.patient.treatmentSlug as string | null);
  if (slug && slug !== refreshed.patient.treatmentSlug) {
    changes.treatmentSlug = slug;
    changes.treatmentCategory = treatmentCategory(slug);
    addEvent(patientId, conversationId, "INTENT_DETECTED", `Intent → ${slug.replaceAll("_", " ")}`, `Treatment interest classified as ${slug.replaceAll("_", " ")}.`);
  }
  if (decision.extracted.age && decision.extracted.age !== refreshed.patient.age) {
    changes.age = decision.extracted.age;
    addEvent(patientId, conversationId, "AGE_EXTRACTED", `Age → ${decision.extracted.age}`, `${refreshed.patient.age ?? "Not known"} → ${decision.extracted.age}`);
  }
  if (decision.extracted.name && (/^(New|Demo) Patient/i.test(String(refreshed.patient.name)) || /(?:my name is|this is)/i.test(content))) {
    changes.name = decision.extracted.name;
  }
  if (decision.extracted.concern && (!refreshed.patient.primaryConcern || /(?:actually|correction|not .*,)/i.test(content))) {
    const cleanConcern = decision.extracted.concern.length > 180 ? `${decision.extracted.concern.slice(0, 177)}…` : decision.extracted.concern;
    changes.primaryConcern = cleanConcern;
    addEvent(patientId, conversationId, "PATIENT_UPDATED", "Concern captured", cleanConcern);
  }
  if (decision.extracted.duration && decision.extracted.duration !== refreshed.patient.concernDuration) changes.concernDuration = decision.extracted.duration;
  changes.leadStage = decision.leadStage;
  updatePatient(patientId, changes);

  const afterFields = getPatientContext(patientId)!;
  const transcript = afterFields.messages.filter((message) => message.senderType === "patient").map((message) => String(message.content));
  const newScore = calculateLeadScore(afterFields.patient, transcript, decision.leadStage);
  const oldScore = Number(refreshed.patient.leadScore || 0);
  if (newScore !== oldScore) {
    updatePatient(patientId, { leadScore: newScore, leadTemperature: temperatureFor(newScore) });
    addEvent(patientId, conversationId, "LEAD_SCORE_CHANGED", `Lead score → ${newScore}`, `${oldScore} → ${newScore}`, { from: oldScore, to: newScore });
    console.log(`[CRM] leadScore ${oldScore} -> ${newScore}`);
  }

  const lastOffer = [...afterFields.messages].reverse().map((message) => parseMetadata(message.metadataJson)).find((meta) => Array.isArray(meta.slots));
  const selectedTime = decision.extracted.preferredTime;
  const offeredSlots = Array.isArray(lastOffer?.slots) ? lastOffer.slots.map(String) : [];
  if (selectedTime && lastOffer?.offeredDate && offeredSlots.includes(selectedTime)) {
    try {
      const appointment = bookAppointment(patientId, conversationId, slug, String(lastOffer.offeredDate), selectedTime);
      const schedule = scheduleAppointmentJobs(appointment);
      const patient = getPatientContext(patientId)!.patient;
      const reply = `Perfect, ${String(patient.name).split(" ")[0]}. Your consultation at Radiance Clinics, Bhubaneswar is confirmed for ${timeLabel(appointment.dateTime)}. If you need to change the time, just message here and I’ll help.`;
      addMessage({ patientId, conversationId, direction: "outbound", senderType: "ai", messageType: "appointment", content: reply, metadata: { appointmentId: appointment.id, dateTime: appointment.dateTime, status: "confirmed" } });
      addEvent(patientId, conversationId, "APPOINTMENT_CREATED", "Appointment confirmed", timeLabel(appointment.dateTime));
      addEvent(patientId, conversationId, "FOLLOWUP_SCHEDULED", "Reminders scheduled", `Demo reminders in ${schedule.firstSeconds}s and ${schedule.secondSeconds}s.`);
      console.log(`[APPOINTMENT] booked ${appointment.dateTime}`);
      return { mode: "ai", replied: true, appointment };
    } catch (error) {
      decision.reply = `${error instanceof Error ? error.message : "That time is unavailable"} I can show you the remaining options.`;
      decision.shouldOfferBooking = true;
    }
  }

  if (decision.shouldOfferBooking) {
    const offeredDate = decision.extracted.preferredDate || String(lastOffer?.offeredDate || format(addDays(new Date(), 1), "yyyy-MM-dd"));
    const period = /evening/i.test(content) ? "evening" : /morning/i.test(content) ? "morning" : null;
    const available = getAvailableSlots(offeredDate, period);
    const slots = (period === "evening" ? available.filter((slot) => slot >= "17:00") : available).slice(0, 3);
    if (slots.length) {
      decision.reply = `Yes — I checked the actual consultation calendar. ${format(new Date(`${offeredDate}T12:00:00`), "EEEE, d MMMM")} has ${slots.map(displayTime).join(", ")} available. Which time would suit you?`;
      decision.leadStage = "booking_offered";
      updatePatient(patientId, { leadStage: "booking_offered" });
      addEvent(patientId, conversationId, "BOOKING_OFFERED", "Consultation times offered", slots.map(displayTime).join(", "), { date: offeredDate, slots });
      console.log(`[APPOINTMENT] offered ${slots.join(", ")}`);
      addMessage({ patientId, conversationId, direction: "outbound", senderType: "ai", content: decision.reply, metadata: { offeredDate, slots } });
      addEvent(patientId, conversationId, "AI_REPLY_CREATED", "AI reply generated", `Provider: ${provider.name}`);
      return { mode: "ai", replied: true, slots };
    }
  }

  if (decision.shouldEscalateHuman) {
    updatePatient(patientId, { aiEnabled: false, assignedTo: "Front Desk", leadStage: "human_required" });
    const db = (await import("@/db")).getSqlite();
    db.prepare("UPDATE conversations SET ai_enabled=0 WHERE id=?").run(conversationId);
    addEvent(patientId, conversationId, "HUMAN_ESCALATION", "Patient requested reception", decision.escalationReason);
  }

  addMessage({ patientId, conversationId, direction: "outbound", senderType: "ai", content: decision.reply });
  addEvent(patientId, conversationId, "AI_REPLY_CREATED", "AI reply generated", `Provider: ${provider.name}`);

  if (decision.shouldSendContent) {
    const item = selectContent(conversationId, slug, decision.contentQuery);
    if (item) {
      const verifiedRadiance = /(?:youtube\.com|youtu\.be)\/(?:@RadianceClinics|watch\?v=8qYMw935MF8)/i.test(String(item.url));
      addMessage({ patientId, conversationId, direction: "outbound", senderType: "ai", messageType: String(item.type), content: String(item.description), mediaUrl: String(item.url), contentItemId: String(item.id), metadata: { title: item.title, demo: !verifiedRadiance, verifiedRadiance } });
      addEvent(patientId, conversationId, "CONTENT_SELECTED", "Relevant content selected", String(item.title), { contentItemId: item.id });
    }
  }

  const updated = getPatientContext(patientId)!;
  const summary = await new MockProvider().summarizePatient({ patient: updated.patient, messages: updated.messages.map((message) => ({ senderType: String(message.senderType), content: String(message.content) })) });
  updatePatient(patientId, { aiSummary: summary });
  return { mode: decision.shouldEscalateHuman ? "human" : "ai", replied: true };
}
