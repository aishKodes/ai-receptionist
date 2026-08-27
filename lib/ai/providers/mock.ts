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
  model = "Radiance deterministic demo AI";

  async generateReceptionDecision(input: ReceptionInput): Promise<ReceptionDecision> {
    const text = input.message.trim();
    const existingTreatmentResult = TreatmentSlugSchema.safeParse(input.patient.treatmentSlug);
    const existingTreatment = existingTreatmentResult.success ? existingTreatmentResult.data : null;
    const detected = treatmentRules.find(([, rule]) => rule.test(text))?.[0] ?? existingTreatment;
    const ageMatch = text.match(/(?:i\s*(?:am|'m)|age(?:d)?(?:\s+is)?|aged)\s*(\d{1,2})\b/i);
    const durationMatch = text.match(/(?:for|since)\s+(?:almost\s+|about\s+|around\s+)?(\d+\s+(?:days?|weeks?|months?|years?))/i);
    const nameMatch = text.match(/(?:my name is|this is|i am|i'm)\s+([A-Z][a-z]{2,})(?!\s*\d)/);
    const isPrice = /\b(price|cost|charges?|how much|estimate)\b/i.test(text);
    const isThanks = /\b(thank|thanks)\b/i.test(text);
    const wantsHuman = /\b(human|receptionist|real person|speak to (?:the )?doctor|call me)\b/i.test(text);
    const isReschedule = /reschedule|change.*(?:time|appointment)/i.test(text);
    const isBooking = /\b(appointment|consultation|book|come|visit|today|tomorrow|morning|evening)\b/i.test(text);
    const time = parseTime(text);
    const preferredDate = /tomorrow/i.test(text) ? format(addDays(new Date(), 1), "yyyy-MM-dd") : /today/i.test(text) ? format(new Date(), "yyyy-MM-dd") : null;
    const concern = text.length > 30 && detected && !isPrice && !isBooking ? text.replace(/^hi[,!\s]*/i, "").replace(/i(?:'m| am)\s*\d{1,2}\s*(?:and)?/i, "").trim() : null;
    let intent: ReceptionDecision["intent"] = (detected as ReceptionDecision["intent"]) || "unknown";
    if (wantsHuman) intent = "human_request";
    else if (isReschedule) intent = "reschedule";
    else if (isPrice) intent = "pricing";
    else if (isBooking || time) intent = "booking";

    let reply = "Thank you for reaching out to Radiance Clinics. Could you briefly share the concern you’d like help with?";
    if (wantsHuman) reply = "Of course. I’m alerting the Radiance reception team so a person can assist you directly.";
    else if (isPrice) reply = "The final cost depends on your concern, the treatment plan and, where applicable, the procedure extent. The clinic team can give you an accurate estimate after a doctor’s assessment. I can help you book a consultation if you’d like.";
    else if (isBooking) reply = "I can help with that. I’ll check the clinic’s available consultation times for you.";
    else if (isThanks) {
      const appointment = input.patient.leadStage === "booked";
      reply = appointment ? `You’re welcome${input.patient.name ? `, ${String(input.patient.name).split(" ")[0]}` : ""}. Your consultation remains confirmed. Message anytime if you need help before your visit.` : "You’re very welcome. Message anytime if you’d like help with a consultation.";
    } else if (detected) {
      const name = treatmentName(detected);
      const variants = [
        `Thank you for explaining that. ${name} may be worth discussing with the doctor, but the right option depends on an in-person assessment. Have you tried any treatment for this concern before?`,
        `I understand. For ${name.toLowerCase()}, the doctor will first assess the pattern, history and current condition before recommending anything. I can also share a short, relevant guide.`,
        `Thanks for sharing those details. The next useful step for ${name.toLowerCase()} is a proper assessment so the doctor can advise you accurately. Would you like me to help with a consultation?`,
      ];
      reply = variants[text.length % variants.length];
    }

    return {
      reply,
      intent,
      extracted: { name: nameMatch?.[1] ?? null, age: ageMatch ? Number(ageMatch[1]) : null, gender: null, concern, duration: durationMatch?.[1] ?? null, preferredDate, preferredTime: time },
      leadStage: wantsHuman ? "human_required" : isBooking ? "appointment_requested" : isThanks && input.patient.leadStage === "booked" ? "booked" : detected ? "qualified" : "engaged",
      leadScore: Number(input.patient.leadScore ?? 10),
      treatmentSlug: detected,
      shouldSendContent: Boolean(detected && !isPrice && !isBooking && !isThanks),
      contentQuery: detected ? `${detected} ${text}` : null,
      shouldOfferBooking: isBooking,
      shouldEscalateHuman: wantsHuman,
      escalationReason: wantsHuman ? "Patient requested a person" : null,
      internalSummary: detected ? `Patient is discussing ${treatmentName(detected).toLowerCase()}.` : "Patient has started a general enquiry.",
    };
  }

  async summarizePatient(input: SummaryInput) {
    const concern = input.patient.primaryConcern || "a clinic consultation";
    const treatment = treatmentName(String(input.patient.treatmentSlug || "")).toLowerCase();
    return `${input.patient.age ? `${input.patient.age}-year-old patient` : "Patient"} enquiring about ${concern}. ${treatment ? `Current treatment interest is ${treatment}.` : "Treatment interest is not yet confirmed."} Lead stage: ${String(input.patient.leadStage || "new").replaceAll("_", " ")}.`;
  }

  async healthCheck() {
    return { connected: true, latency: 8, model: this.model, message: "Mock AI active — demo is fully functional." };
  }
}
