type PatientLike = { age?: number | null; primaryConcern?: string | null; treatmentSlug?: string | null; leadStage?: string; leadScore?: number };

export function temperatureFor(score: number) {
  if (score >= 70) return "HOT";
  if (score >= 40) return "WARM";
  return "COLD";
}

export function calculateLeadScore(patient: PatientLike, transcript: string[], stage?: string) {
  return calculateLeadScoreWithReasons(patient, transcript, stage).score;
}

export function calculateLeadScoreWithReasons(patient: PatientLike, transcript: string[], stage?: string) {
  const all = transcript.join(" ").toLowerCase();
  let score = 10;
  const reasons: string[] = ["BASE:+10"];
  if (patient.treatmentSlug && !["general_skin", "general_hair"].includes(patient.treatmentSlug)) { score += 20; reasons.push("SPECIFIC_TREATMENT:+20"); }
  if (patient.age) { score += 5; reasons.push("AGE_CAPTURED:+5"); }
  if ((patient.primaryConcern?.length ?? 0) > 24) { score += 10; reasons.push("DETAILED_CONCERN:+10"); }
  if (/\b(for|since)\b.*\b(month|year|week|day)s?\b/.test(all)) { score += 5; reasons.push("DURATION_SHARED:+5"); }
  if (/\b(price|cost|charges|estimate)\b/.test(all)) { score += 10; reasons.push("PRICING_QUESTION:+10"); }
  if (/\b(thinking about|considering|interested in|want|need)\b.*\b(transplant|prp|gfc|laser|treatment)\b/.test(all)) { score += 20; reasons.push("STRONG_TREATMENT_INTENT:+20"); }
  if (/\b(appointment|consultation|come|visit|book)\b/.test(all)) { score += 20; reasons.push("APPOINTMENT_INTENT:+20"); }
  if (/\b(today|tomorrow|morning|evening|\d{1,2}[:.]?\d{0,2}\s*(am|pm)?)\b/.test(all)) { score += 20; reasons.push("SPECIFIC_DATE_TIME:+20"); }
  if (stage === "booked") { score = Math.max(92, score); reasons.push("APPOINTMENT_CONFIRMED:>=92"); }
  if (/not interested|stop messaging|do not contact/.test(all)) { score -= 30; reasons.push("NOT_INTERESTED:-30"); }
  return { score: Math.max(0, Math.min(100, score)), reasons };
}
