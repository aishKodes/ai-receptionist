import knowledge from "@/data/radiance-knowledge.json";
import { getDatabase } from "@/db";
import { getSettings } from "@/lib/services/repository";
import { appointmentConfiguration, appointmentConfigurationMissing } from "@/lib/scheduling/availability";
import { sessionConfigurationReady } from "@/lib/auth/session";

export type ReadinessStatus = "CONFIGURED" | "MISSING" | "INVALID" | "UNVERIFIED";
export type ReadinessCheck = { label: string; status: ReadinessStatus; detail?: string };
export type ReadinessSection = { title: string; checks: ReadinessCheck[] };

const configured = (label: string, value: unknown, detail?: string): ReadinessCheck => ({ label, status: value ? "CONFIGURED" : "MISSING", ...(detail ? { detail } : {}) });
const verified = (label: string, value: unknown, detail?: string): ReadinessCheck => ({ label, status: value === "true" ? "CONFIGURED" : "UNVERIFIED", ...(detail ? { detail } : {}) });

function databaseFacts() {
  try {
    const db = getDatabase();
    const approvedTemplates = db.prepare("SELECT COUNT(*) AS count FROM message_templates WHERE active=1 AND status='APPROVED'").get() as { count: number } | undefined;
    const approvedOutreach = db.prepare("SELECT COUNT(*) AS count FROM message_templates WHERE active=1 AND status='APPROVED' AND category='MARKETING' AND meta_template_name IS NOT NULL").get() as { count: number } | undefined;
    return { accessible: true, approvedTemplates: Number(approvedTemplates?.count || 0), approvedOutreach: Number(approvedOutreach?.count || 0) };
  } catch { return { accessible: false, approvedTemplates: 0, approvedOutreach: 0 }; }
}

function websiteValue() { return process.env.CLINIC_WEBSITE || ""; }

export function productionReadiness() {
  const settings = (() => { try { return getSettings(); } catch { return {} as Record<string, string>; } })();
  const facts = databaseFacts();
  const appointment = appointmentConfiguration(settings);
  const appointmentMissing = appointmentConfigurationMissing(appointment);
  const tokenType = settings.metaTokenType || "";
  const tokenStatus: ReadinessStatus = settings.metaTokenUsable === "false" ? "INVALID" : tokenType === "SYSTEM_USER" ? "CONFIGURED" : "UNVERIFIED";
  const tokenDetail = settings.metaTokenUsable === "false"
    ? "Meta rejected the currently configured token. A production System User token is required."
    : tokenType === "SYSTEM_USER" ? "Verified Meta System User token" : "Run the Meta credentials check; a System User token is required for production.";
  const mysqlConfigured = process.env.DATABASE_PROVIDER === "mysql" && Boolean(process.env.DATABASE_URL);
  const exactUrl = process.env.APP_URL === "https://crm.radianceclinics.com";
  const channelConfigured = process.env.MESSAGE_CHANNEL === "whatsapp" && process.env.WHATSAPP_ENABLED === "true";
  const sections: ReadinessSection[] = [
    { title: "Clinic", checks: [
      { label: "Clinic name", status: "CONFIGURED", detail: knowledge.clinic.name },
      { label: "City", status: "CONFIGURED", detail: knowledge.clinic.location },
      configured("Doctor name", knowledge.doctors[0]?.name),
      configured("Doctor display title", process.env.CLINIC_DOCTOR_TITLE || settings.clinicDoctorTitle),
      configured("Clinic phone", process.env.CLINIC_PHONE || settings.clinicPhone),
      configured("Clinic address", process.env.CLINIC_ADDRESS || settings.clinicAddress),
      configured("Website", websiteValue() || settings.clinicWebsite),
      { label: "Timezone", status: "CONFIGURED", detail: "Asia/Kolkata" },
    ] },
    { title: "Appointment configuration", checks: [
      { label: "Weekly consultation schedule", status: appointmentMissing.includes("Weekly consultation schedule") ? "MISSING" : "CONFIGURED" },
      { label: "Slot duration", status: appointmentMissing.includes("Slot duration") ? "MISSING" : "CONFIGURED" },
      { label: "Booking lead time", status: appointment.slotMinutes ? "CONFIGURED" : "MISSING" },
      { label: "Maximum advance booking days", status: appointmentMissing.includes("Maximum advance booking days") ? "MISSING" : "CONFIGURED" },
      { label: "Closed days", status: appointment.slotMinutes ? "CONFIGURED" : "MISSING", detail: appointment.slotMinutes ? "Configured in weekly calendar" : undefined },
      { label: "Special blocked dates", status: appointment.slotMinutes ? "CONFIGURED" : "MISSING", detail: appointment.slotMinutes ? "Supported in calendar settings" : undefined },
    ] },
    { title: "AI", checks: [
      configured("DeepSeek", process.env.DEEPSEEK_API_KEY),
      configured("Gemini", process.env.GEMINI_API_KEY),
      configured("Primary model", process.env.AI_PRIMARY_MODEL || process.env.AI_MODEL),
      configured("Fallback models", process.env.AI_LANGUAGE_FALLBACK_MODEL && process.env.AI_COMPLEX_FALLBACK_MODEL),
    ] },
    { title: "Meta", checks: [
      configured("App ID", process.env.META_APP_ID),
      configured("App Secret", process.env.META_APP_SECRET),
      configured("WABA ID", process.env.WHATSAPP_WABA_ID || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID),
      configured("Phone Number ID", process.env.WHATSAPP_PHONE_NUMBER_ID),
      { label: "Production phone", status: channelConfigured ? "CONFIGURED" : "UNVERIFIED", detail: channelConfigured ? "WhatsApp Cloud API enabled" : "WhatsApp delivery remains disabled in this environment" },
      configured("Access token", process.env.WHATSAPP_ACCESS_TOKEN),
      { label: "Token type", status: tokenStatus, detail: tokenDetail },
      configured("Webhook Verify Token", process.env.WHATSAPP_VERIFY_TOKEN),
      verified("Webhook subscription", settings.metaWabaSubscribed),
      verified("Phone registration", settings.metaPhoneRegistrationVerified),
      { label: "Template count", status: facts.approvedTemplates ? "CONFIGURED" : "UNVERIFIED", detail: facts.accessible ? `${facts.approvedTemplates} approved synced template(s)` : "Database unavailable" },
      { label: "Approved outreach templates", status: facts.approvedOutreach ? "CONFIGURED" : "MISSING", detail: facts.accessible ? `${facts.approvedOutreach} approved marketing template(s)` : "Database unavailable" },
    ] },
    { title: "Database", checks: [
      { label: "Provider", status: mysqlConfigured ? "CONFIGURED" : "MISSING", detail: mysqlConfigured ? "MySQL" : `Current environment uses ${process.env.DATABASE_PROVIDER || "SQLite"}; production requires MySQL` },
      configured("Production MySQL", mysqlConfigured),
      verified("Migration state", settings.productionMigrationVerified),
      { label: "Database connectivity", status: facts.accessible ? "CONFIGURED" : "INVALID" },
    ] },
    { title: "Authentication", checks: [
      configured("PIN hash", process.env.ADMIN_PIN_HASH),
      { label: "Session secret", status: sessionConfigurationReady() ? "CONFIGURED" : "MISSING" },
    ] },
    { title: "Deployment", checks: [
      { label: "APP_URL", status: exactUrl ? "CONFIGURED" : "INVALID", detail: exactUrl ? "https://crm.radianceclinics.com" : "Must be https://crm.radianceclinics.com" },
      verified("Production HTTPS", settings.productionHttpsVerified),
      verified("Health endpoint", settings.productionHealthVerified),
      verified("Public webhook", settings.metaWebhookVerified),
      { label: "Cron", status: process.env.CRON_SECRET && settings.productionCronVerified === "true" ? "CONFIGURED" : "UNVERIFIED" },
    ] },
  ];
  const blockers = sections.flatMap((section) => section.checks.filter((check) => check.status !== "CONFIGURED").map((check) => `${section.title}: ${check.label}`));
  return { status: blockers.length ? "BLOCKED" as const : "PRODUCTION READY" as const, sections, blockers };
}
