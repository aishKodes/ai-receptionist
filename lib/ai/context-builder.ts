import knowledge from "@/data/radiance-knowledge.json";
import { getApprovedKnowledgeSnapshot } from "@/lib/product/pricing";

const redact = (value: string) =>
  value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email removed]")
    .replace(/(?:\+?91[-\s]?)?[6-9]\d{9}\b/g, "[phone removed]")
    .slice(0, 1500);

export function buildMinimalReceptionInput(args: {
  message: string;
  patient: Record<string, unknown>;
  recentMessages: Array<{ senderType: string; content: string }>;
  appointment?: Record<string, unknown> | null;
  state?: Record<string, unknown>;
}) {
  const firstName = args.patient.nameVerified
    ? String(args.patient.name || "")
        .trim()
        .split(/\s+/)[0]
        .slice(0, 60)
    : null;
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
      appointment: args.appointment
        ? {
            dateTime: args.appointment.dateTime,
            status: args.appointment.status,
          }
        : null,
      conversationPhase: args.state?.conversationPhase ?? "DISCOVERY",
      primaryObjection: args.state?.primaryObjection ?? null,
      readinessScore: args.state?.readinessScore ?? 0,
      rollingSummary: redact(String(args.state?.rollingSummary || "")).slice(
        0,
        700,
      ),
      conversionMemory: (() => {
        try {
          return JSON.parse(String(args.state?.conversionMemoryJson || "{}"));
        } catch {
          return {};
        }
      })(),
      structuredContext: {
        currentConcern: args.patient.primaryConcern ?? null,
        currentCategory: args.patient.treatmentCategory ?? null,
        treatmentInterest: args.patient.treatmentSlug ?? null,
        previousInteraction:
          redact(String(args.patient.previousInteraction || "")).slice(
            0,
            500,
          ) || null,
        leadContext:
          redact(String(args.patient.contextNotes || "")).slice(0, 700) || null,
        currentObjection: args.state?.primaryObjection ?? null,
        preferredLanguage:
          args.state?.preferredLanguage ??
          args.patient.preferredLanguage ??
          "AUTO",
        pendingAction: args.state?.pendingAction ?? null,
        nextAction: args.state?.nextBestAction ?? "ANSWER",
        priceDiscussed: String(args.state?.conversionMemoryJson || "").includes(
          '"priceDiscussed":true',
        ),
        consultationOffered: String(
          args.state?.conversionMemoryJson || "",
        ).includes('"appointmentDiscussed":true'),
      },
    },
    recentMessages: args.recentMessages.slice(-10).map((item) => ({
      senderType: item.senderType,
      content: redact(item.content),
    })),
    knowledge: JSON.stringify({
      clinic: knowledge.clinic,
      doctors: knowledge.doctors,
      appointment: knowledge.appointment,
      preparation: knowledge.preparation,
      approvedCatalog: getApprovedKnowledgeSnapshot(),
    }),
  };
}
