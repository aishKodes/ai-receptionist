import { addDays, format } from "date-fns";
import { checkSafety } from "./safety";
import { MockProvider } from "./providers/mock";
import { routeReceptionDecision } from "./router";
import { buildMinimalReceptionInput } from "./context-builder";
import { explicitBookingRequest, isDeterministicYesNo, isPureLanguageRequest, languageFor, planTurn, requestedDateFromText, sanitizePatientReply, selectOfferedSlot } from "./conversation-policy";
import { calculateLeadScoreWithReasons, temperatureFor } from "@/lib/crm/scoring";
import {
  addAudit, addEvent, addLeadScoreEvent, addMessage, bookAppointment, changeAppointment,
  createHumanTask, getAvailableSlots, getPatientContext, getSettings, scheduleAppointmentJobs, selectContent,
  setAiMode, timeLabel, treatmentCategory, updateConversationState, updatePatient, ready,
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

function safeFirstName(patient: Record<string, unknown>) {
  if (!patient.nameVerified) return null;
  const first = String(patient.name || "").trim().split(/\s+/)[0];
  if (!first || /^(?:radiance|clinic|patient|whatsapp|new|demo|test|unknown)$/i.test(first)) return null;
  return first;
}

function permitsEducationalContent(text: string, intent: string) {
  const normalized = text.trim().toLowerCase();
  if (/^(?:hi|hello|hey|thanks|thank you|ok|okay|yes|no|haan|han|nahi|english|hindi|hinglish|odia)[.!\s]*$/i.test(normalized)) return false;
  if (["appointment", "reschedule", "cancellation", "human_request"].includes(intent)) return false;
  return /\b(?:video|guide|youtube|resource)\b/i.test(normalized);
}

function languageAcknowledgement(language: string) {
  if (language === "HINDI") return "ज़रूर, अब मैं हिंदी में बात करूँगा। आप क्या जानना चाहेंगे?";
  if (language === "HINGLISH") return "Bilkul, ab Hinglish mein baat karte hain. Aap kya jaan-na chahenge?";
  if (language === "ODIA") return "ନିଶ୍ଚୟ, ଏବେ ମୁଁ ଓଡ଼ିଆରେ କଥା ହେବି। ଆପଣ କ'ଣ ଜାଣିବାକୁ ଚାହାଁନ୍ତି?";
  return "Of course, I’ll continue in English. What would you like to know?";
}

function slotOfferReply(language: string, dateLabel: string, slots: string[]) {
  const times = slots.map(displayTime).join(", ");
  if (language === "HINDI") return `मैंने क्लिनिक का वास्तविक कैलेंडर जाँच लिया है। ${dateLabel} को ${times} उपलब्ध हैं। कौन सा समय आपके लिए सुविधाजनक है?`;
  if (language === "HINGLISH") return `Maine clinic ka actual calendar check kiya hai. ${dateLabel} ko ${times} available hain. Kaunsa time aapke liye convenient rahega?`;
  if (language === "ODIA") return `ମୁଁ କ୍ଲିନିକ୍‌ର ପ୍ରକୃତ କ୍ୟାଲେଣ୍ଡର ଯାଞ୍ଚ କରିଛି। ${dateLabel} ରେ ${times} ଉପଲବ୍ଧ ଅଛି। କେଉଁ ସମୟ ଆପଣଙ୍କ ପାଇଁ ସୁବିଧାଜନକ?`;
  return `Yes — I checked the actual consultation calendar. ${dateLabel} has ${times} available. Which time would suit you?`;
}

function priceGuidance(language: string) {
  if (language === "HINDI") return "अंतिम लागत आपकी समस्या और उपचार योजना पर निर्भर करती है; डॉक्टर की जाँच के बाद सही अनुमान मिलेगा। ";
  if (language === "HINGLISH") return "Final cost concern aur treatment plan par depend karti hai; doctor assessment ke baad accurate estimate milega. ";
  if (language === "ODIA") return "ଅନ୍ତିମ ଖର୍ଚ୍ଚ ଆପଣଙ୍କ ସମସ୍ୟା ଓ ଚିକିତ୍ସା ଯୋଜନା ଉପରେ ନିର୍ଭର କରେ; ଡାକ୍ତରଙ୍କ ପରୀକ୍ଷା ପରେ ସଠିକ୍ ଆନୁମାନ ମିଳିବ। ";
  return "The final cost depends on your concern and treatment plan; the clinic can give an accurate estimate after a doctor's assessment. ";
}

function softBookingOffer(language: string) {
  if (language === "HINDI") return "अगर आप चाहें, तो मैं डॉक्टर से परामर्श के उपलब्ध समय देख सकता हूँ।";
  if (language === "HINGLISH") return "Agar aap chahein, main doctor consultation ke available times check kar sakta hoon.";
  if (language === "ODIA") return "ଆପଣ ଚାହିଁଲେ, ମୁଁ ଡାକ୍ତରଙ୍କ ପରାମର୍ଶ ପାଇଁ ଉପଲବ୍ଧ ସମୟ ଯାଞ୍ଚ କରିପାରିବି।";
  return "If you'd like, I can check the available consultation times so the doctor can assess this properly.";
}

function bookingDeclinedReply(language: string) {
  if (language === "HINDI") return "समझ गया — अभी बुकिंग का कोई दबाव नहीं है। जब चाहें, सामान्य जानकारी के लिए यहाँ संदेश कर सकते हैं।";
  if (language === "HINGLISH") return "Samajh gaya — abhi booking ka koi pressure nahi hai. Jab chahein, general information ke liye yahin message kar sakte hain.";
  if (language === "ODIA") return "ବୁଝିଲି — ଏବେ ବୁକିଂ ପାଇଁ କୌଣସି ଚାପ ନାହିଁ। ସାଧାରଣ ସୂଚନା ପାଇଁ ଯେକୌଣସି ସମୟରେ ଏଠାରେ ସନ୍ଦେଶ କରନ୍ତୁ।";
  return "Understood — there is no pressure to book. I can still help with general information whenever you need it.";
}

function alreadyOffersConsultation(reply: string) {
  return /(?:would you like|if you(?:'d| would) like|can (?:also )?help|available consultation times|book(?:ing)? (?:a )?(?:consultation|appointment)|consultation times)/i.test(reply);
}

function contentShareReply(language: string, title: string) {
  if (language === "HINDI") return `ज़रूर — यह ${title} है, जो आपने माँगा था।`;
  if (language === "HINGLISH") return `Bilkul — yeh ${title} hai, jo aapne maanga tha.`;
  if (language === "ODIA") return `ନିଶ୍ଚୟ — ଆପଣ ମାଗିଥିବା ${title} ଏଠାରେ ଅଛି।`;
  return `Of course — here is the ${title} you asked for.`;
}

function confirmationReply(language: string, firstName: string | null, dateLabel: string) {
  const nameEn = firstName ? `Thank you, ${firstName}. ` : "";
  if (language === "HINDI") return `${firstName ? `धन्यवाद, ${firstName}। ` : ""}Radiance Clinics, Bhubaneswar में आपका परामर्श ${dateLabel} के लिए पक्का है। समय बदलना हो तो यहीं संदेश करें।`;
  if (language === "HINGLISH") return `${firstName ? `Thank you, ${firstName}. ` : ""}Radiance Clinics, Bhubaneswar mein aapka consultation ${dateLabel} ke liye confirmed hai. Time change karna ho to yahin message karein.`;
  if (language === "ODIA") return `${firstName ? `ଧନ୍ୟବାଦ, ${firstName}। ` : ""}Radiance Clinics, Bhubaneswar ରେ ଆପଣଙ୍କ ପରାମର୍ଶ ${dateLabel} ପାଇଁ ନିଶ୍ଚିତ ହୋଇଛି। ସମୟ ବଦଳାଇବାକୁ ଏଠାରେ ସନ୍ଦେଶ କରନ୍ତୁ।`;
  return `${nameEn}Your consultation at Radiance Clinics, Bhubaneswar is confirmed for ${dateLabel}. If you need to change the time, just message here and I’ll help.`;
}

export async function processPatientMessage(patientId: string, content: string, options: { inboundAlreadyStored?: boolean; externalMessageId?: string | null; messageType?: string; mediaUrl?: string | null } = {}) {
  const initial = getPatientContext(patientId);
  if (!initial) throw new Error("Patient not found");
  const conversationId = String(initial.conversation.id);
  const language = languageFor(content, initial.state.preferredLanguage);
  updateConversationState(conversationId, { preferredLanguage: language });
  if (!options.inboundAlreadyStored) {
    addMessage({ patientId, conversationId, direction: "inbound", senderType: "patient", content, messageType: options.messageType, mediaUrl: options.mediaUrl, externalMessageId: options.externalMessageId });
  }
  addEvent(patientId, conversationId, "MESSAGE_RECEIVED", "Incoming message received", "Patient message accepted by the shared pipeline.");

  if (!initial.patient.aiEnabled || !initial.conversation.aiEnabled) return { mode: "human", replied: false };

  const safety = checkSafety(content);
  if (safety.escalate) {
    updateConversationState(conversationId, { conversationPhase: "HUMAN_HANDOFF", nextBestAction: "DOCTOR_REVIEW", nextActionReason: safety.reason });
    setAiMode(patientId, false, "SYSTEM");
    createHumanTask({ patientId, conversationId, type: "DOCTOR_REVIEW", priority: safety.emergency ? "URGENT" : "HIGH", title: safety.emergency ? "Urgent patient message" : "Clinical concern needs review", reason: safety.reason, suggestedReply: safety.reply });
    addMessage({ patientId, conversationId, direction: "outbound", senderType: "ai", content: safety.reply!, metadata: { escalation: true, emergency: safety.emergency } });
    addAudit("HUMAN_TAKEOVER", "patient", patientId, safety.reason || "Safety escalation", "SYSTEM");
    return { mode: "human", replied: true, escalation: true };
  }

  const refreshed = getPatientContext(patientId)!;
  const directReply = (reply: string, state: Record<string, unknown> = {}) => {
    addMessage({ patientId, conversationId, direction: "outbound", senderType: "ai", content: reply });
    updateConversationState(conversationId, state);
    addEvent(patientId, conversationId, "DETERMINISTIC_REPLY", "Reception replied without model call", String(state.nextBestAction || "ANSWER"));
    return { mode: "ai", replied: true };
  };
  if (/^(?:stop|unsubscribe|remove me|don't message me|do not message me|opt out)[.!\s]*$/i.test(content.trim())) {
    updatePatient(patientId, { doNotContact: true, whatsappOptInStatus: "REVOKED" });
    ready().prepare("UPDATE outbound_messages SET status='CANCELLED',error='Patient opted out' WHERE patient_id=? AND status='QUEUED'").run(patientId);
    return directReply("You have been opted out of promotional messages. We will not contact you for marketing unless you explicitly opt in again.", { nextBestAction: "WAIT", nextActionReason: "Patient opted out" });
  }
  if (isPureLanguageRequest(content)) {
    return directReply(languageAcknowledgement(language), { preferredLanguage: language, nextBestAction: "ANSWER", nextActionReason: "Patient requested a language change" });
  }
  if (/(?:cancel|रद्द|ବାତିଲ).*(?:appointment|booking|consultation|अपॉइंटमेंट|ଆପଏଣ୍ଟମେଣ୍ଟ)|(?:cannot|can't) make it/i.test(content) && refreshed.appointment?.status === "confirmed") {
    changeAppointment(String(refreshed.appointment.id), "cancel");
    addEvent(patientId, conversationId, "APPOINTMENT_CHANGED", "Appointment cancelled", "Patient requested cancellation.");
    addAudit("APPOINTMENT_CHANGED", "appointment", String(refreshed.appointment.id), "Appointment cancelled", "AI", { patientId });
    return directReply("Your consultation has been cancelled and its pending reminders have been stopped. If you need another time later, just message us here.", { conversationPhase: "CONSIDERATION", nextBestAction: "WAIT", pendingAction: null, offeredSlotsJson: "[]" });
  }
  if (/^(?:no|nope|nah|not now|not ready(?: to book)?|i(?:'| a)m just (?:asking|researching)|i(?:'| a)m(?: still)? thinking about it|i(?:'| i)ll think about it)[.!\s]*$/i.test(content.trim())) {
    return directReply(bookingDeclinedReply(language), {
      conversationPhase: "CONSIDERATION", readinessScore: 25, readinessReason: "Patient asked not to pursue booking right now",
      bookingDeclinedForNow: true, nextBestAction: "ANSWER", nextActionReason: "Patient declined booking for now",
      pendingAction: null, pendingQuestion: null, offeredSlotsJson: "[]",
    });
  }
  const directSlots = (() => { try { return JSON.parse(String(refreshed.state.offeredSlotsJson || "[]")) as string[]; } catch { return []; } })();
  const directSlot = directSlots.length && refreshed.state.pendingAction === "select_slot" ? selectOfferedSlot(content, directSlots) : null;
  if (directSlot && refreshed.state.requestedDate) {
    try {
      const appointment = bookAppointment(patientId, conversationId, String(refreshed.patient.treatmentSlug || "") || null, String(refreshed.state.requestedDate), directSlot);
      scheduleAppointmentJobs(appointment);
      updateConversationState(conversationId, { appointmentId: appointment.id, selectedSlot: directSlot, pendingAction: null, pendingQuestion: null, offeredSlotsJson: "[]", conversationPhase: "POST_BOOKING", readinessScore: 100, readinessReason: "Consultation confirmed", nextBestAction: "ANSWER" });
      addEvent(patientId, conversationId, "APPOINTMENT_CREATED", "Appointment confirmed", timeLabel(appointment.dateTime));
      addAudit("APPOINTMENT_CREATED", "appointment", appointment.id, "Consultation booked", "AI", { patientId });
      const result = directReply(confirmationReply(language, safeFirstName(refreshed.patient), timeLabel(appointment.dateTime)));
      return { ...result, appointment };
    } catch (error) { return directReply(`${error instanceof Error ? error.message : "That time is unavailable."} Please ask me to check the available times again.`, { pendingAction: null, offeredSlotsJson: "[]", nextBestAction: "ANSWER" }); }
  }
  if (isDeterministicYesNo(content, refreshed.state.pendingQuestion) && refreshed.state.pendingAction !== "select_slot") {
    const yes = /^(?:yes|yep|haan|han|हाँ|ହଁ)/i.test(content.trim());
    return directReply(yes ? "Thank you, that helps. Please tell me what you would like to know next." : "Understood. You can tell me what you would prefer to know instead.", { pendingQuestion: null, lastAssistantQuestion: null, nextBestAction: "ANSWER" });
  }
  if (/\b(call me|call back|phone me|can (?:someone|somebody) call|speak on (?:the )?phone)\b/i.test(content)) {
    createHumanTask({ patientId, conversationId, type: "CALL", priority: "HIGH", title: "Patient requested a call", reason: "Explicit callback request", suggestedReply: "A member of reception will call you. Please share a convenient time if needed." });
    return directReply("Of course. I’ve asked our reception team to call you. If there’s a convenient time, please let us know.", { conversationPhase: "HUMAN_HANDOFF", nextBestAction: "CALL_RECOMMENDED", nextActionReason: "Patient requested a call", readinessScore: 70 });
  }
  if (/\b(reschedule|change.*(?:appointment|slot|consultation|time))\b/i.test(content) && refreshed.appointment?.status === "confirmed") {
    const requestedDate = requestedDateFromText(content) || format(addDays(new Date(), 1), "yyyy-MM-dd");
    const slots = getAvailableSlots(requestedDate).slice(0, 3);
    if (slots.length) {
      updateConversationState(conversationId, { pendingAction: "select_slot", requestedDate, offeredSlotsJson: JSON.stringify(slots), conversationPhase: "BOOKING", nextBestAction: "OFFER_BOOKING", readinessScore: 88 });
      return directReply(slotOfferReply(language, format(new Date(`${requestedDate}T12:00:00`), "EEEE, d MMMM"), slots));
    }
  }
  const minimalInput = buildMinimalReceptionInput({
    message: content,
    patient: { ...refreshed.patient, preferredLanguage: language },
    appointment: refreshed.appointment as Record<string, unknown> | null,
    state: refreshed.state,
    recentMessages: refreshed.messages.slice(-12).map((message) => ({ senderType: String(message.senderType), content: String(message.content) })),
  });
  let routed;
  try {
    routed = await routeReceptionDecision(minimalInput, { patientId, conversationId, complex: refreshed.messages.length > 20 && Number(refreshed.patient.leadScore || 0) >= 70 });
  } catch {
    createHumanTask({ patientId, conversationId, type: "CHAT", priority: "HIGH", title: "Reception AI unavailable", reason: "All configured AI providers failed; staff follow-up is required." });
    updateConversationState(conversationId, { conversationPhase: "HUMAN_HANDOFF", nextBestAction: "HUMAN_CHAT", nextActionReason: "Provider failure" });
    const reply = language === "HINDI" ? "क्षमा करें, अभी मैं सही उत्तर नहीं दे पा रहा हूँ। मैंने रिसेप्शन टीम से आपसे संपर्क करने को कहा है।" : language === "HINGLISH" ? "Sorry, abhi main reliable answer nahi de pa raha hoon. Reception team ko follow-up ke liye bata diya hai." : language === "ODIA" ? "କ୍ଷମା କରିବେ, ଏବେ ମୁଁ ଭରସାଯୋଗ୍ୟ ଉତ୍ତର ଦେଇପାରୁନି। ରିସେପ୍ସନ୍ ଟିମ୍‌କୁ ଆପଣଙ୍କ ସହ ଯୋଗାଯୋଗ କରିବାକୁ କହିଛି।" : "I’m sorry, I can’t answer reliably just now. I’ve asked our reception team to follow up with you.";
    return directReply(reply);
  }
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
      shouldOfferBooking: decision.shouldOfferBooking,
      humanEscalation: guardrail.humanEscalation.required || guardrail.humanEscalation.recommended ? guardrail.humanEscalation : decision.humanEscalation,
      reply: ["pricing", "human_request", "post_procedure_concern"].includes(guardrail.intent) ? guardrail.reply : decision.reply,
    };
  }
  if (/\b(video|guide|youtube)\b/i.test(content)) {
    decision.shouldSearchContent = true;
    decision.contentQuery = content;
  }
  const candidateTreatment = decision.treatmentSlug || String(refreshed.patient.treatmentSlug || "") || null;
  const lastContentAt = refreshed.state.lastContentSentAt ? new Date(String(refreshed.state.lastContentSentAt)).getTime() : 0;
  const contentAllowed = decision.shouldSearchContent && permitsEducationalContent(content, decision.intent) && Date.now() - lastContentAt >= 24 * 60 * 60 * 1000;
  const candidateContent = contentAllowed ? selectContent(conversationId, candidateTreatment, decision.contentQuery) : null;
  const plan = planTurn({ message: content, decision, state: refreshed.state, appointment: refreshed.appointment, leadScore: Number(refreshed.patient.leadScore || 0), contentAvailable: Boolean(candidateContent) });
  const originalReply = decision.reply;
  decision.reply = sanitizePatientReply(decision.reply, plan, language);
  if (plan.nextBestAction === "SOFT_BOOKING_OFFER" && !alreadyOffersConsultation(decision.reply)) {
    decision.reply = `${decision.reply.trim()} ${softBookingOffer(language)}`;
  }
  if (decision.reply !== originalReply) addEvent(patientId, conversationId, "AI_REPLY_GUARDED", "Reply adjusted by safety policy", "Unsupported claims or booking pressure were removed.");
  decision.shouldOfferBooking = plan.offerSlots;
  if (routed.fallbackUsed) {
    addEvent(patientId, conversationId, "PROVIDER_FALLBACK", "AI provider fallback activated", routed.fallbackReason || "A secondary engine handled this turn.", { provider: routed.provider.name });
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
  if (decision.extracted.name && (/^(New|Demo|WhatsApp) Patient/i.test(String(refreshed.patient.name)) || /(?:my name is|this is|mera naam|ମୋ ନାମ|मेरा नाम)/i.test(content))) {
    changes.name = decision.extracted.name;
    changes.nameSource = "patient_explicit";
    changes.nameVerified = true;
  }
  if (decision.extracted.concern && (!refreshed.patient.primaryConcern || /(?:actually|correction|not .*,)/i.test(content))) {
    changes.primaryConcern = decision.extracted.concern.slice(0, 180);
    addEvent(patientId, conversationId, "PATIENT_UPDATED", "Concern captured", "The CRM concern summary was updated.");
  }
  if (decision.extracted.duration && decision.extracted.duration !== refreshed.patient.concernDuration) changes.concernDuration = decision.extracted.duration;
  changes.leadStage = stageFor(decision.intent, slug, String(refreshed.patient.leadStage || "new"), decision.humanEscalation.required);
  updatePatient(patientId, changes);
  updateConversationState(conversationId, {
    activeFlow: decision.intent,
    currentConcern: changes.primaryConcern ?? refreshed.patient.primaryConcern ?? null,
    currentTreatment: slug,
    requestedDate: decision.extracted.desiredDate ?? undefined,
    requestedTime: decision.extracted.desiredTime ?? undefined,
    requestedDayPart: /evening/i.test(content) ? "evening" : /morning/i.test(content) ? "morning" : undefined,
    conversationPhase: plan.conversationPhase, readinessScore: plan.readinessScore, readinessReason: plan.readinessReason,
    primaryObjection: plan.primaryObjection, nextBestAction: plan.nextBestAction, nextActionReason: plan.readinessReason,
    bookingDeclinedForNow: plan.bookingDeclinedForNow,
    pendingAction: plan.bookingDeclinedForNow ? null : undefined,
    offeredSlotsJson: plan.bookingDeclinedForNow ? "[]" : undefined,
    conversionMemoryJson: JSON.stringify({ concern: changes.primaryConcern ?? refreshed.patient.primaryConcern ?? null, treatment: slug, objection: plan.primaryObjection, priceDiscussed: decision.intent === "pricing" || String(refreshed.state.conversionMemoryJson || "").includes('"priceDiscussed":true'), appointmentDiscussed: plan.allowBookingOffer || String(refreshed.state.conversionMemoryJson || "").includes('"appointmentDiscussed":true'), bookingDeclinedForNow: plan.bookingDeclinedForNow, substantiveTurns: plan.substantiveTurns, lastAction: plan.nextBestAction }),
  });

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
    || (decision.intent === "pricing" && Boolean(slug) && scored.score >= callThreshold)
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
  const persistedSlots = (() => { try { return JSON.parse(String(afterFields.state.offeredSlotsJson || "[]")) as string[]; } catch { return []; } })();
  const offeredSlots = persistedSlots.length ? persistedSlots : Array.isArray(lastOffer?.slots) ? lastOffer.slots.map(String) : [];
  const ordinal = /^(?:the\s+)?(?:first|1|1st)(?:\s+(?:one|slot))?$/i.test(content.trim()) ? 0 : /^(?:the\s+)?(?:second|2|2nd)(?:\s+(?:one|slot))?$/i.test(content.trim()) ? 1 : /^(?:the\s+)?(?:third|3|3rd)(?:\s+(?:one|slot))?$/i.test(content.trim()) ? 2 : -1;
  const selectedTime = selectOfferedSlot(content, offeredSlots) || (ordinal >= 0 ? offeredSlots[ordinal] : null);
  const offeredDate = String(afterFields.state.requestedDate || lastOffer?.offeredDate || "");
  if (selectedTime && offeredDate && offeredSlots.includes(selectedTime)) {
    try {
      const appointment = bookAppointment(patientId, conversationId, slug, offeredDate, selectedTime);
      const schedule = scheduleAppointmentJobs(appointment);
      const patient = getPatientContext(patientId)!.patient;
      const firstName = safeFirstName(patient);
      const reply = confirmationReply(language, firstName, timeLabel(appointment.dateTime));
      addMessage({ patientId, conversationId, direction: "outbound", senderType: "ai", messageType: "appointment", content: reply, metadata: { appointmentId: appointment.id, dateTime: appointment.dateTime, status: "confirmed" } });
      updateConversationState(conversationId, { appointmentId: appointment.id, selectedSlot: selectedTime, pendingAction: null, pendingQuestion: null, lastAssistantQuestion: null, offeredSlotsJson: "[]" });
      addEvent(patientId, conversationId, "APPOINTMENT_CREATED", "Appointment confirmed", timeLabel(appointment.dateTime));
      addEvent(patientId, conversationId, "FOLLOWUP_SCHEDULED", "Reminders scheduled", `Reminders scheduled in ${schedule.firstSeconds}s and ${schedule.secondSeconds}s.`);
      addAudit("APPOINTMENT_CREATED", "appointment", appointment.id, "Consultation booked", "AI", { patientId });
      return { mode: "ai", replied: true, appointment };
    } catch (error) {
      decision.reply = `${error instanceof Error ? error.message : "That time is unavailable"} I can show you the remaining options.`;
      decision.shouldOfferBooking = true;
    }
  }

  if (decision.intent === "reschedule" && explicitBookingRequest(content)) decision.shouldOfferBooking = true;
  if (decision.shouldOfferBooking) {
    const offeredDate = requestedDateFromText(content) || decision.extracted.desiredDate || String(afterFields.state.requestedDate || lastOffer?.offeredDate || format(addDays(new Date(), 1), "yyyy-MM-dd"));
    const period = /evening/i.test(content) ? "evening" : /morning/i.test(content) ? "morning" : null;
    const available = getAvailableSlots(offeredDate, period);
    const slots = (period === "evening" ? available.filter((slot) => slot >= "17:00") : available).slice(0, 3);
    if (slots.length) {
      const reply = (/\b(price|cost|charges?|fees?|how much)\b/i.test(content) ? priceGuidance(language) : "") + slotOfferReply(language, format(new Date(`${offeredDate}T12:00:00`), "EEEE, d MMMM"), slots);
      updatePatient(patientId, { leadStage: "booking_offered" });
      updateConversationState(conversationId, { activeFlow: "booking", pendingAction: "select_slot", pendingQuestion: "Which consultation time would suit you?", lastAssistantQuestion: "Which consultation time would suit you?", requestedDate: offeredDate, requestedDayPart: period, offeredSlotsJson: JSON.stringify(slots) });
      addEvent(patientId, conversationId, "BOOKING_OFFERED", "Consultation times offered", slots.map(displayTime).join(", "), { date: offeredDate, slots });
      addMessage({ patientId, conversationId, direction: "outbound", senderType: "ai", content: reply, metadata: { offeredDate, slots } });
      addEvent(patientId, conversationId, "AI_REPLY_CREATED", "AI reply generated", `Provider: ${routed.provider.name}`);
      addAudit("AI_REPLIED", "conversation", conversationId, "Booking options sent", "AI", { patientId });
      return { mode: "ai", replied: true, slots };
    }
  }

  if (decision.humanEscalation.required || decision.humanEscalation.recommended) {
    const type = decision.humanEscalation.type === "doctor_review" ? "DOCTOR_REVIEW" : decision.humanEscalation.type === "call" ? "CALL" : "CHAT";
    createHumanTask({ patientId, conversationId, type, priority: decision.humanEscalation.priority.toUpperCase() as "URGENT" | "HIGH" | "NORMAL" | "LOW", title: decision.humanEscalation.type === "doctor_review" ? "Doctor review requested" : "Reception follow-up requested", reason: decision.humanEscalation.reason, suggestedReply: decision.reply });
    if (decision.humanEscalation.required) setAiMode(patientId, false, "SYSTEM");
  }

  const item = plan.nextBestAction === "SHARE_CONTENT" ? candidateContent : null;
  const sentMessage = addMessage({
    patientId,
    conversationId,
    direction: "outbound",
    senderType: "ai",
    messageType: item ? String(item.type) : "text",
    content: item ? `${contentShareReply(language, String(item.title))}\n\n${String(item.description)}` : decision.reply,
    mediaUrl: item ? String(item.url) : null,
    contentItemId: item ? String(item.id) : null,
    metadata: item ? { title: item.title, approvedForProduction: true } : {},
  });
  addEvent(patientId, conversationId, "AI_REPLY_CREATED", "AI reply generated", `Provider: ${routed.provider.name}`);
  addAudit("AI_REPLIED", "conversation", conversationId, "Reception reply generated", "AI", { patientId, provider: routed.provider.name });

  if (item) {
    const sentIds = (() => { try { return JSON.parse(String(afterFields.state.sentContentIdsJson || "[]")) as string[]; } catch { return []; } })();
    updateConversationState(conversationId, { sentContentIdsJson: JSON.stringify([...new Set([...sentIds, String(item.id)])]), lastContentSentAt: sentMessage.createdAt });
    addEvent(patientId, conversationId, "CONTENT_SELECTED", "Relevant approved content selected", String(item.title), { contentItemId: item.id });
  }

  const updated = getPatientContext(patientId)!;
  const summary = await new MockProvider().summarizePatient({ patient: updated.patient, messages: updated.messages.map((message) => ({ senderType: String(message.senderType), content: String(message.content) })) });
  updatePatient(patientId, { aiSummary: summary });
  updateConversationState(conversationId, { rollingSummary: summary, lastAssistantQuestion: decision.reply.trim().endsWith("?") ? decision.reply : null, pendingQuestion: decision.reply.trim().endsWith("?") ? decision.reply : null });
  return { mode: decision.humanEscalation.required ? "human" : "ai", replied: true };
}
