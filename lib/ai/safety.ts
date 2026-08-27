export type SafetyResult = { escalate: boolean; emergency: boolean; reason: string | null; reply: string | null };

const emergencyTerms = [
  "can't breathe", "cannot breathe", "breathing difficulty", "uncontrolled bleeding",
  "severe allergic", "anaphylaxis", "fainted", "unconscious", "chest pain",
];
const urgentTerms = ["severe infection", "pus and fever", "rapidly worsening", "post procedure swelling", "legal notice", "refund dispute", "threaten"];

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
  return { escalate: false, emergency: false, reason: null, reply: null };
}
