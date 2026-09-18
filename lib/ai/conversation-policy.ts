import type { ReceptionDecision } from "./schemas";

export const phases = ["DISCOVERY", "UNDERSTANDING", "EDUCATION", "TRUST_BUILDING", "OBJECTION_HANDLING", "CONSIDERATION", "SOFT_CONVERSION", "BOOKING", "POST_BOOKING", "HUMAN_HANDOFF"] as const;
export type ConversationPhase = typeof phases[number];
export const nextActions = ["ANSWER", "ASK_ONE_QUESTION", "EDUCATE", "SHARE_CONTENT", "BUILD_TRUST", "HANDLE_OBJECTION", "SOFT_BOOKING_OFFER", "OFFER_BOOKING", "WAIT", "CALL_RECOMMENDED", "HUMAN_CHAT", "DOCTOR_REVIEW"] as const;
export type NextBestAction = typeof nextActions[number];
export const objections = ["PRICE", "FEAR", "PAIN", "TRUST", "RESULTS", "TIME", "TRAVEL", "FAMILY_DECISION", "COMPARING_CLINICS", "NOT_READY", "NEEDS_DOCTOR", "UNKNOWN"] as const;
export type Objection = typeof objections[number];
export type Language = "AUTO" | "ENGLISH" | "HINDI" | "HINGLISH" | "ODIA";

export function explicitLanguage(text: string): Language | null {
  const t = text.trim();
  if (/(?:odia|oriya|odisha language|ଓଡ଼ିଆ).*(?:re|in|speak|talk|reply|bolo|katha|କଥା)|(?:speak|talk|reply|bolo|katha|କଥା).*(?:odia|oriya|ଓଡ଼ିଆ)|^(?:odia|oriya|ଓଡ଼ିଆ)[.!\s]*$/i.test(t)) return "ODIA";
  if (/(?:hinglish|hindi.?english).*(?:speak|talk|reply|bolo|mein|me)|(?:speak|talk|reply).*(?:hinglish)|^(?:hinglish)[.!\s]*$/i.test(t)) return "HINGLISH";
  if (/(?:hindi|हिंदी|हिन्दी).*(?:mein|me|in|speak|talk|reply|bolo|बोलो|बात)|(?:speak|talk|reply|bolo|बोलो|बात).*(?:hindi|हिंदी|हिन्दी)|^(?:hindi|हिंदी|हिन्दी)[.!\s]*$/i.test(t)) return "HINDI";
  if (/(?:english).*(?:please|in|speak|talk|reply|bolo)|(?:speak|talk|reply|bolo).*(?:english)|^(?:english|eng)[.!\s]*$/i.test(t)) return "ENGLISH";
  return null;
}

export function isPureLanguageRequest(text: string) {
  if (!explicitLanguage(text)) return false;
  const t = text.trim();
  if (t.length > 45 || /\b(?:hair|acne|skin|price|cost|recovery|appointment|booking|doctor|treatment|video|guide|problem|question|concern)\b/i.test(t)) return false;
  return !/[.!?।]\s*\S/.test(t);
}

export function languageFor(text: string, stored: unknown): Language {
  const explicit = explicitLanguage(text);
  if (explicit) return explicit;
  if (["ENGLISH", "HINDI", "HINGLISH", "ODIA"].includes(String(stored))) return stored as Language;
  if (/\p{Script=Oriya}/u.test(text)) return "ODIA";
  if (/\p{Script=Devanagari}/u.test(text)) return "HINDI";
  if (/\b(?:mujhe|mera|meri|hai|hain|chahiye|karna|baal|kya|kaise|bolo)\b/i.test(text)) return "HINGLISH";
  return "ENGLISH";
}

export function detectObjection(text: string): Objection | null {
  if (/\b(price|cost|expensive|afford|budget|charge|fees?|mehenga|kitna|ପଇସା|ଖର୍ଚ୍ଚ|कीमत|खर्च)\b/i.test(text)) return "PRICE";
  if (/\b(time|recovery|downtime|leave from work|busy|weekend)\b/i.test(text) && /\b(can't|cannot|concern|worried|long|too|need)\b/i.test(text)) return "TIME";
  if (/\b(scared|afraid|fear|nervous|worried|darr|डर|ଭୟ)\b/i.test(text)) return "FEAR";
  if (/\b(pain|painful|hurt|dard|दर्द|ଯନ୍ତ୍ରଣା)\b/i.test(text)) return "PAIN";
  if (/\b(trust|genuine|qualified|experience|credentials|real doctor|review|भरोसा)\b/i.test(text)) return "TRUST";
  if (/\b(results?|success|guarantee|permanent|काम करेगा)\b/i.test(text)) return "RESULTS";
  if (/\b(travel|far away|distance|out of town)\b/i.test(text)) return "TRAVEL";
  if (/\b(family|parents|spouse|husband|wife).*(?:ask|decide|discuss|permission)|(?:ask|discuss).*(?:family|parents|spouse)\b/i.test(text)) return "FAMILY_DECISION";
  if (/\b(compare|comparing|other clinics?|elsewhere|another clinic)\b/i.test(text)) return "COMPARING_CLINICS";
  if (/\b(think about it|need to think|not ready|just checking|just researching|only researching|later maybe|not planning|not booking yet|abhi nahi)\b/i.test(text)) return "NOT_READY";
  if (/\b(ask (?:the |a )?doctor|need (?:the |a )?doctor|suitab|medical advice)\b/i.test(text)) return "NEEDS_DOCTOR";
  return null;
}

export function explicitBookingRequest(text: string) {
  return /\b(book|appointment|consultation|available|availability|slots?|come (?:in|to|on|tomorrow|today|saturday|sunday|monday|tuesday|wednesday|thursday|friday)|visit (?:the|on|tomorrow|today)|reschedule|change.*(?:appointment|slot))\b/i.test(text)
    || /(?:अपॉइंटमेंट|परामर्श|ବୁକିଂ|ଆପଏଣ୍ଟମେଣ୍ଟ)/u.test(text);
}

export function requestedDateFromText(text: string, now = new Date()): string | null {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const base = new Date(`${today}T12:00:00+05:30`);
  const add = (days: number) => {
    const date = new Date(base.getTime() + days * 86400000);
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  };
  if (/\b(tomorrow|kal)\b/i.test(text)) return add(1);
  if (/\b(today|aaj)\b/i.test(text)) return add(0);
  const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const match = text.toLowerCase().match(/\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (match) {
    const current = new Date(`${today}T12:00:00+05:30`).getUTCDay();
    const target = weekdays.indexOf(match[2]);
    let delta = (target - current + 7) % 7;
    if (delta === 0 || match[1]) delta += 7;
    return add(delta);
  }
  return null;
}

export function selectOfferedSlot(text: string, slots: string[]): string | null {
  const t = text.trim().toLowerCase();
  const ordinal = /^(?:the\s+)?(?:first|1|1st)(?:\s+(?:one|slot))?$/.test(t) ? 0 : /^(?:the\s+)?(?:second|2|2nd)(?:\s+(?:one|slot))?$/.test(t) ? 1 : /^(?:the\s+)?(?:third|3|3rd)(?:\s+(?:one|slot))?$/.test(t) ? 2 : -1;
  if (ordinal >= 0) return slots[ordinal] || null;
  for (const slot of slots) {
    const [hours, minutes] = slot.split(":").map(Number);
    const hour12 = hours % 12 || 12;
    const meridiem = hours >= 12 ? "pm" : "am";
    const pattern = new RegExp(`\\b(?:${hours}|${hour12})(?::|\\.)?${minutes ? String(minutes).padStart(2, "0") : "(?:00)?"}\\s*(?:${meridiem})?\\b`, "i");
    if (pattern.test(t)) return slot;
  }
  return null;
}

export function isDeterministicYesNo(text: string, pendingQuestion: unknown) {
  return Boolean(pendingQuestion) && /^(?:yes|no|yep|nope|haan|han|nahi|नहीं|हाँ|ହଁ|ନା)[.!\s]*$/i.test(text.trim());
}

export type TurnPlan = {
  conversationPhase: ConversationPhase;
  patientIntent: string;
  intentConfidence: number;
  nextBestAction: NextBestAction;
  readinessScore: number;
  readinessReason: string;
  primaryObjection: Objection | null;
  humanRecommendation: "NONE" | "CALL" | "CHAT" | "DOCTOR_REVIEW";
  contentRecommendation: string | null;
  extractedFacts: ReceptionDecision["extracted"];
  allowBookingOffer: boolean;
  offerSlots: boolean;
  bookingDeclinedForNow: boolean;
  substantiveTurns: number;
};

function conversionMemory(state: Record<string, unknown>) {
  try {
    const parsed = JSON.parse(String(state.conversionMemoryJson || "{}"));
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

function meaningfulPatientTurn(text: string, decision: ReceptionDecision) {
  if (decision.treatmentSlug || decision.extracted.concern || decision.extracted.duration || decision.intent === "pricing") return true;
  return /\b(?:hair|skin|acne|pimple|pigment|prp|gfc|laser|transplant|recovery|result|cost|price|consultation)\b/i.test(text);
}

function laterBuyingSignal(text: string, decision: ReceptionDecision) {
  return explicitBookingRequest(text)
    || decision.intent === "pricing"
    || /\b(?:price|cost|fee|charges?|availability|available|recovery|downtime|when can i come|treatment soon|this week|next week|how long)\b/i.test(text);
}

export function planTurn(args: { message: string; decision: ReceptionDecision; state?: Record<string, unknown>; appointment?: Record<string, unknown> | null; leadScore?: number; contentAvailable?: boolean }): TurnPlan {
  const { message: text, decision, state = {}, appointment } = args;
  const objection = detectObjection(text);
  const explicitBooking = explicitBookingRequest(text) || decision.intent === "reschedule";
  const explicitCall = /\b(call me|call back|phone me|can (?:someone|somebody) call|speak on (?:the )?phone)\b/i.test(text);
  const clinical = decision.intent === "post_procedure_concern" || objection === "NEEDS_DOCTOR";
  const booked = appointment?.status === "confirmed" && !["reschedule", "cancellation"].includes(decision.intent);
  const notReady = objection === "NOT_READY" || /\b(no|not now|just asking|just checking|researching|exploring|information only|not planning|not booking yet|not ready|don't want to book|i'll think|i will think)\b/i.test(text);
  const memory = conversionMemory(state);
  const priorSubstantiveTurns = Number(memory.substantiveTurns || 0);
  const substantiveTurns = priorSubstantiveTurns + Number(meaningfulPatientTurn(text, decision));
  const buyingSignal = laterBuyingSignal(text, decision);
  const bookingDeclinedForNow = notReady ? true : Boolean(state.bookingDeclinedForNow) && !buyingSignal;
  const recentlyOfferedBooking = Boolean(memory.appointmentDiscussed) && ["SOFT_BOOKING_OFFER", "OFFER_BOOKING"].includes(String(memory.lastAction));
  const bookingOfferCoolingOff = recentlyOfferedBooking && !explicitBooking && !buyingSignal;
  const hasKnownConcern = Boolean(decision.treatmentSlug || state.currentTreatment || state.currentConcern);
  const persistentConcern = Boolean(decision.extracted.duration || /\b(?:for|since)\s+(?:almost\s+|about\s+|around\s+)?\d+\s+(?:days?|weeks?|months?|years?)\b/i.test(text));
  const qualifiedAndEngaged = hasKnownConcern && (substantiveTurns >= 2 || persistentConcern || decision.intent === "pricing");
  const prior = Number(state.readinessScore || 0);
  let readiness = booked ? 100
    : bookingDeclinedForNow ? Math.min(prior || 32, 32)
    : explicitBooking ? 88
    : decision.intent === "pricing" ? Math.max(48, Math.min(68, prior + 18))
    : qualifiedAndEngaged ? Math.max(48, Math.min(72, prior + (persistentConcern ? 24 : 18)))
    : hasKnownConcern ? Math.max(32, Math.min(44, prior + 12))
    : Math.max(25, Math.min(42, prior + 5));
  if (/\b(this week|as soon as possible|soon)\b/i.test(text) && explicitBooking) readiness = 94;
  if (explicitCall) readiness = Math.max(readiness, 70);
  const humanRecommendation = clinical ? "DOCTOR_REVIEW" : explicitCall ? "CALL" : decision.humanEscalation.required ? "CHAT" : "NONE";
  const requestedApprovedContent = Boolean(args.contentAvailable && decision.shouldSearchContent);
  const allowBookingOffer = !bookingDeclinedForNow && !bookingOfferCoolingOff && !requestedApprovedContent && humanRecommendation === "NONE" && !booked && (explicitBooking || readiness >= 45);
  const offerSlots = allowBookingOffer && (explicitBooking || readiness >= 65);
  const phase: ConversationPhase = humanRecommendation !== "NONE" && decision.humanEscalation.required ? "HUMAN_HANDOFF" : booked ? "POST_BOOKING" : bookingDeclinedForNow ? "CONSIDERATION" : offerSlots ? "BOOKING" : allowBookingOffer ? "SOFT_CONVERSION" : objection ? "OBJECTION_HANDLING" : state.conversationPhase === "DISCOVERY" && hasKnownConcern ? "UNDERSTANDING" : hasKnownConcern ? "EDUCATION" : "DISCOVERY";
  const action: NextBestAction = clinical ? "DOCTOR_REVIEW" : explicitCall ? "CALL_RECOMMENDED" : decision.humanEscalation.required ? "HUMAN_CHAT" : booked ? "ANSWER" : bookingDeclinedForNow ? "ANSWER" : requestedApprovedContent ? "SHARE_CONTENT" : offerSlots ? "OFFER_BOOKING" : allowBookingOffer ? "SOFT_BOOKING_OFFER" : objection ? "HANDLE_OBJECTION" : hasKnownConcern ? "EDUCATE" : "ASK_ONE_QUESTION";
  const readinessReason = booked ? "Consultation confirmed" : bookingDeclinedForNow ? "Patient asked not to pursue booking right now" : explicitBooking ? "Patient explicitly asked about an appointment" : offerSlots ? "Qualified concern with clear consultation intent" : allowBookingOffer ? "Concern is understood; a consultation is the useful next step" : decision.intent === "pricing" ? "Pricing question answered; assessment can clarify the exact estimate" : hasKnownConcern ? "One more useful detail may help before offering a consultation" : "Concern still being understood";
  return { conversationPhase: phase, patientIntent: decision.intent, intentConfidence: decision.intentConfidence, nextBestAction: action, readinessScore: readiness, readinessReason, primaryObjection: objection ?? (state.primaryObjection as Objection | null) ?? null, humanRecommendation, contentRecommendation: action === "SHARE_CONTENT" ? decision.contentQuery : null, extractedFacts: decision.extracted, allowBookingOffer, offerSlots, bookingDeclinedForNow, substantiveTurns };
}

export function removeBookingPressure(reply: string, plan: TurnPlan) {
  if (plan.allowBookingOffer || plan.conversationPhase === "POST_BOOKING") return reply;
  const sentences = reply.split(/(?<=[.!?।])\s+/).filter((sentence) => !/(?:would you like.*(?:book|consultation)|can (?:help you )?book|book (?:a|your)|(?:arrange|set up|schedule).*(?:consultation|appointment)|consultation (?:if you|whenever you)|consultation book|परामर्श बुक|ବୁକିଂ)/i.test(sentence));
  return sentences.join(" ").trim() || "I can help explain the options based on your question. A doctor would need to assess what is appropriate for you.";
}

export function unsafeFactualClaim(reply: string) {
  return /(?:₹|Rs\.?|INR)\s*\d|\b(?:guaranteed|100% success|permanent cure|doctor (?:has|personally) reviewed (?:your|this)|confirmed diagnosis)\b/i.test(reply);
}

export function sanitizePatientReply(reply: string, plan: TurnPlan, language: Language) {
  const pressureFree = removeBookingPressure(reply, plan);
  if (!unsafeFactualClaim(pressureFree)) return pressureFree;
  if (plan.primaryObjection === "PRICE") {
    if (language === "HINDI") return "अंतिम लागत आपकी समस्या और उपचार योजना पर निर्भर करती है। डॉक्टर की जाँच के बाद क्लिनिक सही अनुमान दे सकता है।";
    if (language === "HINGLISH") return "Final cost concern aur treatment plan par depend karti hai. Doctor assessment ke baad clinic accurate estimate de sakta hai.";
    if (language === "ODIA") return "ଅନ୍ତିମ ଖର୍ଚ୍ଚ ଆପଣଙ୍କ ସମସ୍ୟା ଓ ଚିକିତ୍ସା ଯୋଜନା ଉପରେ ନିର୍ଭର କରେ। ଡାକ୍ତରଙ୍କ ପରୀକ୍ଷା ପରେ କ୍ଲିନିକ୍ ସଠିକ୍ ଆନୁମାନ ଦେଇପାରିବ।";
    return "The final cost depends on your concern and treatment plan. The clinic can provide an accurate estimate after a doctor's assessment.";
  }
  if (plan.primaryObjection === "TRUST") {
    if (language === "HINDI") return "आपका भरोसे के बारे में पूछना बिल्कुल उचित है। Dr. Satyarth Prakash के पास 30 वर्षों से अधिक अनुभव है। आपके लिए सही उपचार डॉक्टर की जाँच के बाद ही तय किया जा सकता है।";
    if (language === "HINGLISH") return "Trust ke baare mein poochna bilkul reasonable hai. Dr. Satyarth Prakash ko 30 saal se zyada experience hai. Aapke liye sahi option doctor assessment ke baad hi decide hoga.";
    if (language === "ODIA") return "ଭରସା ବିଷୟରେ ପଚାରିବା ସ୍ୱାଭାବିକ। Dr. Satyarth Prakash ଙ୍କର ୩୦ ବର୍ଷରୁ ଅଧିକ ଅଭିଜ୍ଞତା ଅଛି। ଆପଣଙ୍କ ପାଇଁ ଉପଯୁକ୍ତ ବିକଳ୍ପ ଡାକ୍ତରଙ୍କ ପରୀକ୍ଷା ପରେ ନିର୍ଦ୍ଧାରିତ ହେବ।";
    return "It's reasonable to ask. Dr. Satyarth Prakash has more than 30 years of experience. A doctor would still need to assess your concern before recommending treatment.";
  }
  if (language === "HINDI") return "बिना जाँच के मैं परिणाम या उपयुक्तता का वादा नहीं कर सकता। डॉक्टर आपकी स्थिति देखकर सही मार्गदर्शन देंगे।";
  if (language === "HINGLISH") return "Bina assessment ke main result ya suitability promise nahi kar sakta. Doctor aapka concern dekhkar guide karenge.";
  if (language === "ODIA") return "ପରୀକ୍ଷା ବିନା ମୁଁ ଫଳାଫଳ କିମ୍ବା ଉପଯୁକ୍ତତାର ପ୍ରତିଶ୍ରୁତି ଦେଇପାରିବି ନାହିଁ। ଡାକ୍ତର ଯାଞ୍ଚ ପରେ ପରାମର୍ଶ ଦେବେ।";
  return "I can't promise a result or confirm suitability without an assessment. A doctor can advise after reviewing your concern.";
}
