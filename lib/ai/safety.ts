export type SafetyResult = { escalate: boolean; emergency: boolean; reason: string | null; reply: string | null };

const emergencyTerms = [
  "can't breathe", "cannot breathe", "breathing difficulty", "uncontrolled bleeding",
  "severe allergic", "anaphylaxis", "fainted", "unconscious", "chest pain",
];
const urgentTerms = ["severe infection", "pus and fever", "rapidly worsening", "post procedure swelling", "legal notice", "refund dispute", "threaten"];
const clinicalReview = /\b(infection|infected|pus|wound|swelling|bleeding|rash after treatment|adverse reaction|side effect after|suitable for me|safe for me|am i a candidate|should i have (?:prp|gfc|laser|transplant))\b/i;

export function checkSafety(message: string): SafetyResult {
  const text = message.toLowerCase();
  if (emergencyTerms.some((term) => text.includes(term))) {
    return {
      escalate: true,
      emergency: true,
      reason: "Possible medical emergency",
      reply: "This may need urgent medical attention. Please seek immediate help from your nearest emergency service or hospital. I’m also alerting the Radiance reception team, but please do not wait for a chat response if symptoms are severe.",
    };
  }
  if (urgentTerms.some((term) => text.includes(term))) {
    return {
      escalate: true,
      emergency: false,
      reason: "Clinical or service concern requires staff review",
      reply: "I’m sorry you’re dealing with this. I’m pausing the automated conversation and alerting the Radiance reception team so a person can review this promptly.",
    };
  }
  if (clinicalReview.test(message)) {
    return {
      escalate: true,
      emergency: false,
      reason: "Clinical concern or suitability question requires doctor review",
      reply: "Thank you for explaining. A doctor needs to review this; I cannot assess it safely by chat. I’m alerting the clinical team. If symptoms are severe or worsening, please seek urgent local medical care.",
    };
  }
  return { escalate: false, emergency: false, reason: null, reply: null };
}
