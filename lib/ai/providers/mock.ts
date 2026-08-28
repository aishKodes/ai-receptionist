import { addDays, format } from "date-fns";
import type { AIProvider } from "./provider";
import { TreatmentSlugSchema, type ReceptionDecision, type ReceptionInput, type SummaryInput } from "@/lib/ai/schemas";

const treatmentRules: Array<[NonNullable<ReceptionDecision["treatmentSlug"]>, RegExp]> = [
  ["beard_transplant", /beard\s*(transplant|patch|density)/i],
  ["hair_transplant", /hair\s*transplant|front\s*hairline|baldness|bald\s*(patch|spot)/i],
  ["gfc", /\bgfc\b|growth factor concentrate/i],
  ["prp", /\bprp\b|platelet.rich plasma/i],
  ["acne_scars", /acne\s*scar|pimple\s*scar|skin texture/i],
  ["acne", /\bacne\b|\bpimples?\b|breakout/i],
  ["melasma", /\bmelasma\b|brown patches/i],
  ["pigmentation", /pigment|dark spots?|uneven tone/i],
  ["laser", /\blaser\b/i],
  ["anti_ageing", /anti.?age|fine lines?|wrinkles?/i],
  ["hair_loss", /hair\s*(fall|falling|loss|thin|thinning)|\bcrown\b/i],
  ["general_skin", /\bskin\b/i],
];

const treatmentName = (slug: string | null) => slug ? slug.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "your concern";

function parseTime(text: string) {
  const match = text.match(/\b(1[0-2]|0?[1-9])(?::|\.)([0-5]\d)\s*(am|pm)?\b/i) || text.match(/\b(1[0-2]|0?[1-9])\s*(am|pm)\b/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] && /^\d{2}$/.test(match[2]) ? match[2] : "00";
  const meridiem = (match[3] || (/[ap]m/i.test(match[2] || "") ? match[2] : "") || "").toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (!meridiem && hour < 8) hour += 12;
  return `${String(hour).padStart(2, "0")}:${minute}`;
}

export class MockProvider implements AIProvider {
  name = "mock" as const;
  model = "Radiance deterministic rules";

  async generateReceptionDecision(input: ReceptionInput): Promise<ReceptionDecision> {
    const text = input.message.trim();
    const existingTreatmentResult = TreatmentSlugSchema.safeParse(input.patient.treatmentSlug ?? input.patient.previousInterest);
    const existingTreatment = existingTreatmentResult.success ? existingTreatmentResult.data : null;
    const detected = treatmentRules.find(([, rule]) => rule.test(text))?.[0] ?? existingTreatment;
    const ageMatch = text.match(/(?:i\s*(?:am|'m)|age(?:d)?(?:\s+is)?|aged)\s*(\d{1,2})\b/i);
    const durationMatch = text.match(/(?:for|since)\s+(?:almost\s+|about\s+|around\s+)?(\d+\s+(?:days?|weeks?|months?|years?))/i);
    const nameMatch = text.match(/(?:my name is|this is|i am|i'm)\s+([A-Z][a-z]{2,})(?!\s*\d)/);
    const isPrice = /\b(price|cost|charges?|how much|estimate)\b/i.test(text);
    const isThanks = /\b(thank|thanks)\b/i.test(text);
    const wantsCall = /\b(call me|call back|phone me)\b/i.test(text);
    const wantsHuman = wantsCall || /\b(human|receptionist|real person|speak to (?:the )?doctor)\b/i.test(text);
    const isReschedule = /reschedule|change.*(?:time|appointment)/i.test(text);
    const isCancellation = /cancel.*(?:appointment|booking)|cannot make it|can't make it/i.test(text);
    const isComplaint = /complaint|very unhappy|terrible service|refund/i.test(text);
    const isPostProcedure = /after (?:the )?(?:procedure|treatment|transplant)|post.?procedure|swelling|bleeding/i.test(text);
    const isBooking = /\b(appointment|consultation|book|come|visit|today|tomorrow|morning|evening)\b/i.test(text);
    const time = parseTime(text);
    const preferredDate = /tomorrow/i.test(text) ? format(addDays(new Date(), 1), "yyyy-MM-dd") : /today/i.test(text) ? format(new Date(), "yyyy-MM-dd") : null;
    const concern = text.length > 30 && detected && !isPrice && !isBooking ? text.replace(/^hi[,!\s]*/i, "").replace(/i(?:'m| am)\s*\d{1,2}\s*(?:and)?/i, "").trim() : null;
    let intent: ReceptionDecision["intent"] = (detected as ReceptionDecision["intent"]) || "unknown";
    if (wantsHuman) intent = "human_request";
    else if (isPostProcedure) intent = "post_procedure_concern";
    else if (isComplaint) intent = "complaint";
    else if (isCancellation) intent = "cancellation";
    else if (isReschedule) intent = "reschedule";
    else if (isPrice) intent = "pricing";
    else if (isBooking || time) intent = "appointment";

    let reply = "Thank you for reaching out to Radiance Clinics. Could you briefly share the concern you’d like help with?";
    if (wantsHuman) reply = "Of course. I’m alerting the Radiance reception team so a person can assist you directly.";
    else if (isPrice) reply = "The final cost depends on your concern, the treatment plan and, where applicable, the procedure extent. The clinic team can give you an accurate estimate after a doctor’s assessment. I can help you book a consultation if you’d like.";
    else if (isBooking) reply = "I can help with that. I’ll check the clinic’s available consultation times for you.";
    else if (isThanks) {
      const appointment = (input.patient.leadStage ?? input.patient.stage) === "booked" || (input.patient.appointment as { status?: string } | null)?.status === "confirmed";
      reply = appointment ? `You’re welcome${input.patient.firstName ? `, ${String(input.patient.firstName)}` : ""}. Your consultation remains confirmed. Message anytime if you need help before your visit.` : "You’re very welcome. Message anytime if you’d like help with a consultation.";
    } else if (detected) {
      const name = treatmentName(detected);
      const variants = [
        `Thank you for explaining that. ${name} may be worth discussing with the doctor, but the right option depends on an in-person assessment. Have you tried any treatment for this concern before?`,
        `I understand. For ${name.toLowerCase()}, the doctor will first assess the pattern, history and current condition before recommending anything. Have you tried any treatment for this concern before?`,
        `Thanks for sharing those details. The next useful step for ${name.toLowerCase()} is a proper assessment so the doctor can advise you accurately. Would you like me to help with a consultation?`,
      ];
      reply = variants[text.length % variants.length];
    }

    const language = String(input.patient.preferredLanguage || "ENGLISH");
    if (language === "HINDI") {
      if (wantsHuman) reply = "ज़रूर। मैं रिसेप्शन टीम को सूचित कर रहा हूँ ताकि कोई व्यक्ति आपकी सहायता कर सके।";
      else if (isPrice) reply = "अंतिम लागत आपकी समस्या, उपचार योजना और प्रक्रिया की सीमा पर निर्भर करती है। सही अनुमान डॉक्टर की जाँच के बाद ही दिया जा सकता है। चाहें तो मैं परामर्श बुक करने में मदद कर सकता हूँ।";
      else if (isBooking) reply = "ज़रूर। मैं क्लिनिक में उपलब्ध वास्तविक परामर्श समय देखता हूँ।";
      else if (isThanks) reply = "आपका स्वागत है। परामर्श से जुड़ी किसी भी मदद के लिए यहाँ संदेश भेज सकते हैं।";
      else if (detected) reply = "आपकी जानकारी के लिए धन्यवाद। सही उपचार डॉक्टर की जाँच के बाद ही तय किया जा सकता है। क्या आपने इस समस्या के लिए पहले कोई उपचार लिया है?";
      else reply = "Radiance Clinics से संपर्क करने के लिए धन्यवाद। कृपया अपनी समस्या के बारे में संक्षेप में बताएं।";
    } else if (language === "HINGLISH") {
      if (wantsHuman) reply = "Bilkul. Main reception team ko alert kar raha hoon, taaki koi person aapki help kar sake.";
      else if (isPrice) reply = "Final cost concern, treatment plan aur procedure ki extent par depend karti hai. Accurate estimate doctor assessment ke baad milega. Chahein to main consultation book karne mein help kar sakta hoon.";
      else if (isBooking) reply = "Bilkul. Main clinic ke actual available consultation slots check karta hoon.";
      else if (isThanks) reply = "You’re welcome. Consultation se related kisi bhi help ke liye yahin message kar sakte hain.";
      else if (detected) reply = "Details share karne ke liye thank you. Sahi treatment doctor assessment ke baad hi decide hoga. Kya aapne is concern ke liye pehle koi treatment liya hai?";
      else reply = "Radiance Clinics se contact karne ke liye thank you. Aap kis concern ke liye help chahte hain?";
    } else if (language === "ODIA") {
      if (wantsHuman) reply = "ନିଶ୍ଚୟ। ଆମ ରିସେପ୍ସନ୍ ଟିମ୍‌ର ଜଣେ ସଦସ୍ୟ ଆପଣଙ୍କୁ ସହାୟତା କରିବେ।";
      else if (isPrice) reply = "ଅନ୍ତିମ ଖର୍ଚ୍ଚ ଆପଣଙ୍କ ସମସ୍ୟା, ଚିକିତ୍ସା ଯୋଜନା ଏବଂ ପ୍ରକ୍ରିୟାର ପରିମାଣ ଉପରେ ନିର୍ଭର କରେ। ଡାକ୍ତରଙ୍କ ପରୀକ୍ଷା ପରେ ସଠିକ୍ ଆନୁମାନ ମିଳିବ।";
      else if (isBooking) reply = "ନିଶ୍ଚୟ। ମୁଁ କ୍ଲିନିକ୍‌ର ଉପଲବ୍ଧ ପରାମର୍ଶ ସମୟ ଯାଞ୍ଚ କରୁଛି।";
      else if (isThanks) reply = "ଆପଣଙ୍କୁ ସ୍ୱାଗତ। ପରାମର୍ଶ ସମ୍ବନ୍ଧୀୟ ସହାୟତା ପାଇଁ ଏଠାରେ ସନ୍ଦେଶ କରନ୍ତୁ।";
      else if (detected) reply = "ବିବରଣୀ ଦେଇଥିବାରୁ ଧନ୍ୟବାଦ। ଡାକ୍ତରଙ୍କ ପରୀକ୍ଷା ପରେ ଉପଯୁକ୍ତ ଚିକିତ୍ସା ନିର୍ଦ୍ଧାରଣ ହେବ। ଏହି ସମସ୍ୟା ପାଇଁ ପୂର୍ବରୁ କୌଣସି ଚିକିତ୍ସା ନେଇଛନ୍ତି କି?";
      else reply = "Radiance Clinics ସହ ଯୋଗାଯୋଗ କରିଥିବାରୁ ଧନ୍ୟବାଦ। ଦୟାକରି ଆପଣଙ୍କ ସମସ୍ୟା ବିଷୟରେ ସଂକ୍ଷେପରେ କୁହନ୍ତୁ।";
    }

    return {
      reply,
      intent,
      extracted: { name: nameMatch?.[1] ?? null, age: ageMatch ? Number(ageMatch[1]) : null, gender: null, concern, duration: durationMatch?.[1] ?? null, desiredDate: preferredDate, desiredTime: time },
      intentConfidence: detected || wantsHuman || isBooking || isPrice || isReschedule || isCancellation || isComplaint || isPostProcedure ? 0.96 : isThanks ? 0.85 : 0.42,
      treatmentSlug: detected,
      shouldSearchContent: Boolean(detected && !isPrice && !isBooking && !isThanks && !isPostProcedure),
      contentQuery: detected ? `${detected} ${text}` : null,
      shouldOfferBooking: isBooking,
      humanEscalation: {
        required: wantsHuman || isPostProcedure,
        recommended: wantsHuman || isPostProcedure || isComplaint,
        type: isPostProcedure ? "doctor_review" : isComplaint || (wantsHuman && !wantsCall) ? "chat" : wantsCall ? "call" : "none",
        priority: isPostProcedure ? "high" : isComplaint ? "high" : wantsHuman ? "normal" : "low",
        reason: wantsHuman ? "Patient requested a person" : isPostProcedure ? "Post-procedure concern requires clinical review" : isComplaint ? "Complaint requires staff follow-up" : null,
      },
      suggestedNextAction: isBooking ? "Check real appointment availability" : wantsHuman ? "Create a reception task" : detected ? "Answer briefly and offer relevant approved content" : "Ask one clarifying question",
      internalSummary: detected ? `Patient is discussing ${treatmentName(detected).toLowerCase()}.` : "Patient has started a general enquiry.",
    };
  }

  async summarizePatient(input: SummaryInput) {
    const concern = input.patient.primaryConcern || "a clinic consultation";
    const treatment = treatmentName(String(input.patient.treatmentSlug || "")).toLowerCase();
    return `${input.patient.age ? `${input.patient.age}-year-old patient` : "Patient"} enquiring about ${concern}. ${treatment ? `Current treatment interest is ${treatment}.` : "Treatment interest is not yet confirmed."} Lead stage: ${String(input.patient.leadStage || "new").replaceAll("_", " ")}.`;
  }

  async healthCheck() {
    return { connected: true, latency: 8, model: this.model, message: "Deterministic safety rules are active." };
  }
}
