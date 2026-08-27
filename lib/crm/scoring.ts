type PatientLike = { age?: number | null; primaryConcern?: string | null; treatmentSlug?: string | null; leadStage?: string; leadScore?: number };

export function temperatureFor(score: number) {
  if (score >= 70) return "HOT";
  if (score >= 40) return "WARM";
  return "COLD";
}

export function calculateLeadScore(patient: PatientLike, transcript: string[], stage?: string) {
  const all = transcript.join(" ").toLowerCase();
  let score = 10;
  if (patient.treatmentSlug && !["general_skin", "general_hair"].includes(patient.treatmentSlug)) score += 20;
  if (patient.age) score += 5;
  if ((patient.primaryConcern?.length ?? 0) > 24) score += 15;
  if (/\b(for|since)\b.*\b(month|year|week|day)s?\b/.test(all)) score += 5;
  if (/\b(price|cost|charges|estimate)\b/.test(all)) score += 10;
  if (/\b(appointment|consultation|come|visit|book)\b/.test(all)) score += 20;
  if (/\b(today|tomorrow|morning|evening|\d{1,2}[:.]?\d{0,2}\s*(am|pm)?)\b/.test(all)) score += 15;
  if (stage === "booked") score = Math.max(92, score);
  if (/not interested|stop messaging|do not contact/.test(all)) score -= 35;
  return Math.max(0, Math.min(100, score));
}
