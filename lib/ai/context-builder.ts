import knowledge from "@/data/radiance-knowledge.json";

const redact = (value: string) => value
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email removed]")
  .replace(/(?:\+?91[-\s]?)?[6-9]\d{9}\b/g, "[phone removed]")
  .slice(0, 1500);

export function buildMinimalReceptionInput(args: {
  message: string;
  patient: Record<string, unknown>;
  recentMessages: Array<{ senderType: string; content: string }>;
  appointment?: Record<string, unknown> | null;
}) {
  const firstName = args.patient.nameVerified ? String(args.patient.name || "").trim().split(/\s+/)[0].slice(0, 60) : null;
  return {
    message: redact(args.message),
    patient: {
      firstName,
      preferredLanguage: args.patient.preferredLanguage ?? "AUTO",
      age: args.patient.age ?? null,
      gender: args.patient.gender ?? null,
      knownConcern: args.patient.primaryConcern ?? null,
      concernDuration: args.patient.concernDuration ?? null,
      previousInterest: args.patient.treatmentSlug ?? null,
      stage: args.patient.leadStage ?? "new",
      appointment: args.appointment ? { dateTime: args.appointment.dateTime, status: args.appointment.status } : null,
    },
    recentMessages: args.recentMessages.slice(-10).map((item) => ({ senderType: item.senderType, content: redact(item.content) })),
    knowledge: JSON.stringify({ clinic: knowledge.clinic, treatments: knowledge.treatments }),
  };
}
