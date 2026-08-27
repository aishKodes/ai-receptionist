import { getSqlite, makeId, nowIso } from "@/db";
import { getMessageChannel } from "@/lib/channels";
import { addAudit, addEvent, addMessage, getPatientContext } from "@/lib/services/repository";

type EligiblePatient = { id: string; name: string; phone: string; conversationId: string; whatsappOptInStatus: string; doNotContact: number; invalidPhone: number };

export function outreachEligibility(patient: { whatsappOptInStatus?: unknown; doNotContact?: unknown; invalidPhone?: unknown; phone?: unknown }) {
  if (Boolean(patient.invalidPhone)) return { eligible: false, reason: "INVALID_NUMBER" };
  if (Boolean(patient.doNotContact) || patient.whatsappOptInStatus === "REVOKED") return { eligible: false, reason: "OPTED_OUT" };
  if (patient.whatsappOptInStatus !== "CONFIRMED") return { eligible: false, reason: "CONSENT_UNKNOWN" };
  const digits = String(patient.phone || "").replace(/\D/g, "");
  const local = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
  if (!local.match(/^[6-9]\d{9}$/)) return { eligible: false, reason: "INVALID_NUMBER" };
  return { eligible: true, reason: "ELIGIBLE" };
}

export function getOutreachOverview() {
  const db = getSqlite();
  const campaigns = db.prepare("SELECT c.id,c.name,c.status,c.audience_json AS audienceJson,c.scheduled_for AS scheduledFor,c.rate_per_minute AS ratePerMinute,c.created_by AS createdBy,c.created_at AS createdAt,c.updated_at AS updatedAt,t.id AS templateId,t.name AS templateName,t.status AS templateStatus,COUNT(o.id) AS total,SUM(CASE WHEN o.status='QUEUED' THEN 1 ELSE 0 END) AS queued,SUM(CASE WHEN o.status IN ('SENT','DELIVERED','READ','REPLIED') THEN 1 ELSE 0 END) AS sent,SUM(CASE WHEN o.status='DELIVERED' THEN 1 ELSE 0 END) AS delivered,SUM(CASE WHEN o.status='READ' THEN 1 ELSE 0 END) AS read,SUM(CASE WHEN o.status='REPLIED' THEN 1 ELSE 0 END) AS replied,SUM(CASE WHEN o.status='FAILED' THEN 1 ELSE 0 END) AS failed FROM campaigns c JOIN message_templates t ON t.id=c.template_id LEFT JOIN outbound_messages o ON o.campaign_id=c.id GROUP BY c.id ORDER BY c.created_at DESC").all();
  const templates = db.prepare("SELECT id,name,COALESCE(display_name,name) AS displayName,category,language,body,meta_template_name AS metaTemplateName,status,variables_json AS variablesJson,purpose,treatment_slug AS treatmentSlug,active,last_synced_at AS lastSyncedAt,created_at AS createdAt,updated_at AS updatedAt FROM message_templates WHERE active=1 ORDER BY name").all();
  const patients = db.prepare("SELECT p.id,p.name,p.phone,p.whatsapp_opt_in_status AS whatsappOptInStatus,p.do_not_contact AS doNotContact,p.invalid_phone AS invalidPhone,c.id AS conversationId FROM patients p JOIN conversations c ON c.patient_id=p.id GROUP BY p.id ORDER BY p.name").all() as EligiblePatient[];
  const eligibility = { eligible: 0, consentUnknown: 0, optedOut: 0, invalid: 0 };
  patients.forEach((patient) => {
    const result = outreachEligibility(patient);
    if (result.eligible) eligibility.eligible += 1;
    else if (result.reason === "CONSENT_UNKNOWN") eligibility.consentUnknown += 1;
    else if (result.reason === "OPTED_OUT") eligibility.optedOut += 1;
    else eligibility.invalid += 1;
  });
  return { campaigns, templates, eligibility };
}

export function createCampaign(args: { name: string; templateId: string; audience?: Record<string, unknown>; scheduledFor?: string | null }) {
  const db = getSqlite();
  const template = db.prepare("SELECT id FROM message_templates WHERE id=?").get(args.templateId);
  if (!template) throw new Error("Select a valid message template.");
  const now = nowIso(), id = makeId("campaign");
  db.prepare("INSERT INTO campaigns (id,name,template_id,status,audience_json,scheduled_for,rate_per_minute,created_by,created_at,updated_at) VALUES (?,?,?,'DRAFT',?,?,?,?,?,?)").run(id, args.name.slice(0, 160), args.templateId, JSON.stringify(args.audience || {}), args.scheduledFor ?? null, Math.max(1, Math.min(60, Number(process.env.OUTREACH_MESSAGES_PER_MINUTE || 5))), "Front Desk", now, now);
  addAudit("OUTREACH_CAMPAIGN_CREATED", "campaign", id, `Campaign created: ${args.name}`, "ADMIN");
  return id;
}

function renderTemplate(body: string, patient: { name: string }) {
  return body.replaceAll("{{firstName}}", patient.name.split(/\s+/)[0] || "there").replaceAll("{{concern}}", "a consultation").slice(0, 1500);
}

export function startCampaign(campaignId: string) {
  const db = getSqlite();
  const campaign = db.prepare("SELECT c.id,c.status,c.template_id AS templateId,c.scheduled_for AS scheduledFor,t.body,t.status AS templateStatus,t.meta_template_name AS metaTemplateName FROM campaigns c JOIN message_templates t ON t.id=c.template_id WHERE c.id=?").get(campaignId) as { id: string; status: string; templateId: string; scheduledFor: string | null; body: string; templateStatus: string; metaTemplateName: string | null } | undefined;
  if (!campaign) throw new Error("Campaign not found.");
  if (!["DRAFT", "READY", "PAUSED"].includes(campaign.status)) throw new Error("Campaign cannot be started from its current status.");
  const channel = getMessageChannel();
  if (channel.name === "whatsapp" && campaign.templateStatus !== "APPROVED") throw new Error("WhatsApp campaigns require a Meta-approved template.");
  const patients = db.prepare("SELECT p.id,p.name,p.phone,p.whatsapp_opt_in_status AS whatsappOptInStatus,p.do_not_contact AS doNotContact,p.invalid_phone AS invalidPhone,c.id AS conversationId FROM patients p JOIN conversations c ON c.patient_id=p.id GROUP BY p.id").all() as EligiblePatient[];
  let queued = 0;
  db.transaction(() => {
    for (const patient of patients) {
      if (!outreachEligibility(patient).eligible) continue;
      const existing = db.prepare("SELECT id FROM outbound_messages WHERE campaign_id=? AND patient_id=?").get(campaignId, patient.id);
      if (existing) continue;
      db.prepare("INSERT INTO outbound_messages (id,campaign_id,patient_id,conversation_id,template_id,channel,rendered_body,status,scheduled_for,created_at) VALUES (?,?,?,?,?,?,?,'QUEUED',?,?)").run(makeId("out"), campaignId, patient.id, patient.conversationId, campaign.templateId, channel.name, renderTemplate(campaign.body, patient), campaign.scheduledFor || nowIso(), nowIso());
      queued += 1;
    }
    db.prepare("UPDATE campaigns SET status='RUNNING',started_at=COALESCE(started_at,?),updated_at=? WHERE id=?").run(nowIso(), nowIso(), campaignId);
  })();
  addAudit("OUTREACH_QUEUED", "campaign", campaignId, `${queued} eligible messages queued`, "ADMIN");
  return { queued };
}

export function setCampaignStatus(campaignId: string, status: "PAUSED" | "CANCELLED") {
  const db = getSqlite();
  db.transaction(() => {
    const result = db.prepare("UPDATE campaigns SET status=?,updated_at=? WHERE id=? AND status NOT IN ('COMPLETED','CANCELLED')").run(status, nowIso(), campaignId);
    if (!result.changes) throw new Error("Campaign is already complete or unavailable.");
    if (status === "CANCELLED") db.prepare("UPDATE outbound_messages SET status='CANCELLED',error='Campaign cancelled' WHERE campaign_id=? AND status='QUEUED'").run(campaignId);
  })();
  addAudit(`OUTREACH_${status}`, "campaign", campaignId, `Campaign ${status.toLowerCase()}`, "ADMIN");
}

export async function sendCampaignTest(campaignId: string, patientId: string) {
  const db = getSqlite();
  const campaign = db.prepare("SELECT c.id,c.template_id AS templateId,t.body,t.status AS templateStatus,t.meta_template_name AS metaTemplateName,t.language FROM campaigns c JOIN message_templates t ON t.id=c.template_id WHERE c.id=?").get(campaignId) as { id: string; templateId: string; body: string; templateStatus: string; metaTemplateName: string | null; language: string } | undefined;
  const context = getPatientContext(patientId);
  if (!campaign || !context) throw new Error("Campaign or test patient not found.");
  const channel = getMessageChannel();
  if (channel.name === "whatsapp" && (campaign.templateStatus !== "APPROVED" || !campaign.metaTemplateName)) throw new Error("A Meta-approved template is required for a live WhatsApp test.");
  const text = renderTemplate(campaign.body, { name: String(context.patient.name) });
  const result = channel.name === "whatsapp" && channel.sendTemplate ? await channel.sendTemplate({ to: String(context.patient.phone), templateName: campaign.metaTemplateName!, language: campaign.language, variables: [String(context.patient.name).split(" ")[0]] }) : await channel.sendText({ to: String(context.patient.phone), text });
  addMessage({ patientId, conversationId: String(context.conversation.id), direction: "outbound", senderType: "automation", content: text, externalMessageId: result.id, deliveryStatus: result.status, metadata: { campaignId, test: true } });
  addAudit("OUTREACH_SENT", "campaign", campaignId, "Campaign test sent", "RECEPTION", { patientId, channel: channel.name });
  return result;
}

export async function processOutboundOnce(limit = Number(process.env.OUTREACH_MESSAGES_PER_MINUTE || 5)) {
  const db = getSqlite();
  const due = db.prepare("SELECT o.id,o.campaign_id AS campaignId,o.patient_id AS patientId,o.conversation_id AS conversationId,o.rendered_body AS renderedBody,o.template_id AS templateId,p.name,p.phone,p.whatsapp_opt_in_status AS whatsappOptInStatus,p.do_not_contact AS doNotContact,p.invalid_phone AS invalidPhone,c.status AS campaignStatus,t.status AS templateStatus,t.meta_template_name AS metaTemplateName,t.language FROM outbound_messages o JOIN patients p ON p.id=o.patient_id JOIN campaigns c ON c.id=o.campaign_id JOIN message_templates t ON t.id=o.template_id WHERE o.status='QUEUED' AND o.scheduled_for<=? ORDER BY o.scheduled_for LIMIT ?").all(nowIso(), Math.max(1, Math.min(60, limit))) as Array<Record<string, unknown>>;
  let sent = 0;
  for (const item of due) {
    if (item.campaignStatus !== "RUNNING") continue;
    const eligibility = outreachEligibility(item);
    if (!eligibility.eligible) { db.prepare("UPDATE outbound_messages SET status='CANCELLED',error=? WHERE id=? AND status='QUEUED'").run(eligibility.reason, item.id); continue; }
    const claimed = db.prepare("UPDATE outbound_messages SET status='SENDING' WHERE id=? AND status='QUEUED'").run(item.id);
    if (!claimed.changes) continue;
    try {
      const channel = getMessageChannel();
      if (channel.name === "whatsapp" && (item.templateStatus !== "APPROVED" || !item.metaTemplateName)) throw new Error("Template is not approved by Meta");
      const result = channel.name === "whatsapp" && channel.sendTemplate
        ? await channel.sendTemplate({ to: String(item.phone), templateName: String(item.metaTemplateName), language: String(item.language), variables: [String(item.name).split(" ")[0]] })
        : await channel.sendText({ to: String(item.phone), text: String(item.renderedBody) });
      const now = nowIso();
      db.prepare("UPDATE outbound_messages SET status='SENT',external_message_id=?,meta_message_id=?,sent_at=?,error=NULL WHERE id=?").run(result.id, channel.name === "whatsapp" ? result.id : null, now, item.id);
      addMessage({ patientId: String(item.patientId), conversationId: String(item.conversationId), direction: "outbound", senderType: "automation", content: String(item.renderedBody), externalMessageId: result.id, deliveryStatus: result.status, metadata: { campaignId: item.campaignId, outboundId: item.id } });
      addEvent(String(item.patientId), String(item.conversationId), "OUTREACH_SENT", "Campaign message sent", "Consent and eligibility were rechecked before sending.");
      addAudit("OUTREACH_SENT", "outbound_message", String(item.id), "Outreach message sent", "SYSTEM", { patientId: item.patientId, campaignId: item.campaignId });
      sent += 1;
    } catch (error) {
      const failure = error instanceof Error ? error.message.slice(0, 250) : "Send failed";
      db.prepare("UPDATE outbound_messages SET status='FAILED',error=?,failure_message=?,failed_at=? WHERE id=?").run(failure, failure, nowIso(), item.id);
    }
  }
  const campaignIds = [...new Set(due.map((item) => String(item.campaignId)))];
  for (const id of campaignIds) {
    const remaining = (db.prepare("SELECT COUNT(*) AS count FROM outbound_messages WHERE campaign_id=? AND status IN ('QUEUED','SENDING')").get(id) as { count: number }).count;
    if (!remaining) db.prepare("UPDATE campaigns SET status='COMPLETED',completed_at=?,updated_at=? WHERE id=? AND status='RUNNING'").run(nowIso(), nowIso(), id);
  }
  return { found: due.length, sent };
}
