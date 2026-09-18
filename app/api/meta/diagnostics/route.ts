import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMessageChannel, RealWhatsAppCloudChannel } from "@/lib/channels";
import { enforceRateLimit, enforceSameOrigin } from "@/lib/security/http";
import { getDatabase, nowIso } from "@/db";
import { getSettings, setSettings } from "@/lib/services/repository";

const ActionSchema = z.object({
  action: z.enum(["credentials", "waba", "phone_numbers", "templates", "check_webhook", "register_webhook", "send_test_template"]).default("credentials"),
  variables: z.array(z.string().trim().min(1).max(200)).max(10).optional(),
});

type MetaError = { error?: { code?: number; message?: string } };
type MetaTemplate = { name?: string; language?: string; category?: string; status?: string; components?: Array<{ type?: string; text?: string }> };
type DebugTokenData = { is_valid?: boolean; type?: string; application?: string; expires_at?: number; data_access_expires_at?: number; scopes?: string[]; user_id?: string };
type MetaPhone = { id?: string; verified_name?: string; code_verification_status?: string; quality_rating?: string };

function version() { return process.env.WHATSAPP_GRAPH_VERSION || process.env.WHATSAPP_API_VERSION || "v26.0"; }
function wabaId() { return process.env.WHATSAPP_WABA_ID || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || ""; }
function publicWebhookUrl() {
  const base = process.env.PUBLIC_WEBHOOK_BASE_URL?.replace(/\/$/, "");
  return base ? `${base}/api/whatsapp/webhook` : null;
}

function state() {
  const recipient = (process.env.WHATSAPP_TEST_RECIPIENT || "").replace(/\D/g, "");
  const settings = getSettings();
  return {
    channel: getMessageChannel().name,
    graphVersion: version(),
    configured: {
      appId: Boolean(process.env.META_APP_ID), appSecret: Boolean(process.env.META_APP_SECRET),
      wabaId: Boolean(wabaId()), phoneNumberId: Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID),
      accessToken: Boolean(process.env.WHATSAPP_ACCESS_TOKEN), verifyToken: Boolean(process.env.WHATSAPP_VERIFY_TOKEN),
      testRecipient: Boolean(recipient), testTemplate: Boolean(process.env.WHATSAPP_TEST_TEMPLATE),
    },
    webhookPath: "/api/whatsapp/webhook",
    publicWebhookUrl: publicWebhookUrl(),
    testRecipient: recipient ? `••••${recipient.slice(-4)}` : null,
    testTemplate: process.env.WHATSAPP_TEST_TEMPLATE || null,
    liveReady: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET && wabaId() && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_VERIFY_TOKEN),
    tokenUsable: settings.metaTokenUsable === "true",
    tokenType: settings.metaTokenType || null,
    tokenExpiresAt: settings.metaTokenExpiresAt || null,
    dataAccessExpiresAt: settings.metaDataAccessExpiresAt || null,
    tokenPermissions: settings.metaTokenPermissions || null,
    webhookVerified: settings.metaWebhookVerified === "true",
    wabaSubscribed: settings.metaWabaSubscribed === "true",
    phoneRegistrationVerified: settings.metaPhoneRegistrationVerified === "true",
    coexistenceDetected: settings.metaCoexistenceDetected === "true",
  };
}

function expiryLabel(value?: number) {
  if (!value) return "Does not expire";
  return new Date(value * 1000).toISOString();
}

async function debugToken() {
  const token = process.env.WHATSAPP_ACCESS_TOKEN || "";
  const appId = process.env.META_APP_ID || "";
  const appSecret = process.env.META_APP_SECRET || "";
  const url = new URL(`https://graph.facebook.com/${version()}/debug_token`);
  url.searchParams.set("input_token", token);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${appId}|${appSecret}` }, signal: AbortSignal.timeout(12000) });
  const body = await response.json() as MetaError & { data?: DebugTokenData };
  if (!response.ok || !body.data?.is_valid) throw Object.assign(new Error(body.error?.message || "The stored Meta access token is expired or invalid."), { code: body.error?.code || response.status });
  return body.data;
}

async function graph(target: string, init?: RequestInit) {
  const response = await fetch(`https://graph.facebook.com/${version()}/${target}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, ...(init?.headers || {}) },
    signal: AbortSignal.timeout(12000),
  });
  const body = await response.json() as MetaError & { data?: unknown[]; success?: boolean } & Record<string, unknown>;
  if (!response.ok) throw Object.assign(new Error(body.error?.message || "Meta Graph request failed"), { code: body.error?.code || response.status });
  return body;
}

function syncTemplates(templates: MetaTemplate[]) {
  const db = getDatabase();
  const now = nowIso();
  const upsert = db.prepare(`
    INSERT INTO message_templates (id,name,display_name,category,language,body,meta_template_name,status,variables_json,purpose,active,last_synced_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?)
    ON CONFLICT(name) DO UPDATE SET display_name=excluded.display_name,category=excluded.category,
      language=excluded.language,body=excluded.body,meta_template_name=excluded.meta_template_name,
      status=excluded.status,variables_json=excluded.variables_json,last_synced_at=excluded.last_synced_at,
      updated_at=excluded.updated_at
  `);
  for (const template of templates) {
    if (!template.name) continue;
    const body = template.components?.find((component) => component.type === "BODY")?.text || template.name;
    const variables = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
    const id = `tpl_meta_${template.name.replace(/[^a-z0-9]+/gi, "_").toLowerCase().slice(0, 80)}`;
    upsert.run(id, template.name, template.name.replaceAll("_", " "), template.category || "MARKETING", template.language || "en", body, template.name, template.status || "DRAFT", JSON.stringify(variables), "Synced from Meta", now, now, now);
  }
}

export function GET() { return NextResponse.json(state()); }

export async function POST(request: NextRequest) {
  try {
    enforceSameOrigin(request); enforceRateLimit(request, "meta-test", 20);
    const input = ActionSchema.parse(await request.json().catch(() => ({})));
    const diagnostics = state();
    if (!diagnostics.liveReady) return NextResponse.json({ ...diagnostics, connected: false, message: "Meta production credentials are incomplete. WhatsApp sending remains disabled." }, { status: 503 });

    if (input.action === "credentials") {
      const token = await debugToken();
      const tokenType = token.type || "UNKNOWN";
      const tokenExpiresAt = expiryLabel(token.expires_at);
      const dataAccessExpiresAt = expiryLabel(token.data_access_expires_at);
      const requiredPermissions = ["whatsapp_business_management", "whatsapp_business_messaging"];
      const permissions = token.scopes || [];
      const permissionState = requiredPermissions.every((permission) => permissions.includes(permission)) ? "verified" : permissions.length ? "missing required permission" : "not returned by Meta";
      setSettings({ metaTokenUsable: "true", metaTokenType: tokenType, metaTokenExpiresAt: tokenExpiresAt, metaDataAccessExpiresAt: dataAccessExpiresAt, metaTokenPermissions: permissionState, metaTokenLastCheckedAt: nowIso() });
      await graph(`${wabaId()}?fields=id,name,timezone_id,message_template_namespace`);
      return NextResponse.json({ ...state(), connected: true, message: tokenType === "SYSTEM_USER" ? "Durable Meta System User token verified." : "Meta token is usable, but a System User token is recommended to avoid frequent credential replacement." });
    }

    if (input.action === "send_test_template") {
      const recipient = (process.env.WHATSAPP_TEST_RECIPIENT || "").replace(/\D/g, "");
      const templateName = process.env.WHATSAPP_TEST_TEMPLATE || "";
      if (!recipient || !templateName) throw new Error("Test recipient or template is not configured.");
      const variables = input.variables || ["Radiance Test", `TEST-${Date.now().toString().slice(-6)}`, new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date())];
      const sent = await new RealWhatsAppCloudChannel().sendTemplate({ to: recipient, templateName, language: process.env.WHATSAPP_TEST_TEMPLATE_LANGUAGE || "en_US", variables });
      return NextResponse.json({ ...diagnostics, connected: true, action: input.action, result: { messageId: sent.id, status: sent.status }, message: `Test template accepted for ${diagnostics.testRecipient}.` });
    }

    if (input.action === "check_webhook") {
      if (!diagnostics.publicWebhookUrl) return NextResponse.json({ ...diagnostics, connected: true, message: "Local webhook is ready. Add a public webhook base URL to verify it from Meta." });
      const challenge = `radiance-${Date.now()}`;
      const url = new URL(diagnostics.publicWebhookUrl);
      url.searchParams.set("hub.mode", "subscribe");
      url.searchParams.set("hub.verify_token", process.env.WHATSAPP_VERIFY_TOKEN || "");
      url.searchParams.set("hub.challenge", challenge);
      const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
      const body = await response.text();
      if (!response.ok || body !== challenge) throw new Error("Public webhook verification did not return Meta's challenge.");
      setSettings({ metaWebhookVerified: "true", metaWebhookVerifiedAt: nowIso() });
      return NextResponse.json({ ...diagnostics, connected: true, message: "Public webhook verification succeeded." });
    }

    if (input.action === "register_webhook") {
      if (!diagnostics.publicWebhookUrl) throw new Error("PUBLIC_WEBHOOK_BASE_URL is required before registration.");
      const appId = process.env.META_APP_ID || "";
      const appSecret = process.env.META_APP_SECRET || "";
      const form = new URLSearchParams({ object: "whatsapp_business_account", callback_url: diagnostics.publicWebhookUrl, fields: "messages", verify_token: process.env.WHATSAPP_VERIFY_TOKEN || "", access_token: `${appId}|${appSecret}` });
      const callback = await fetch(`https://graph.facebook.com/${version()}/${appId}/subscriptions`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form, signal: AbortSignal.timeout(12000) });
      const callbackBody = await callback.json() as MetaError & { success?: boolean };
      if (!callback.ok || !callbackBody.success) throw Object.assign(new Error(callbackBody.error?.message || "Meta callback registration failed"), { code: callbackBody.error?.code || callback.status });
      await graph(`${wabaId()}/subscribed_apps`, { method: "POST" });
      setSettings({ metaWebhookVerified: "true", metaWabaSubscribed: "true", metaWebhookRegisteredAt: nowIso() });
      return NextResponse.json({ ...diagnostics, connected: true, action: input.action, result: { callbackRegistered: true, wabaSubscribed: true }, message: "Webhook registered and WABA subscribed to this app." });
    }

    const target = input.action === "phone_numbers"
      ? `${wabaId()}/phone_numbers`
      : input.action === "templates"
        ? `${wabaId()}/message_templates?limit=100`
        : `${wabaId()}?fields=id,name,timezone_id,message_template_namespace`;
    const body = await graph(target);
    if (input.action === "templates" && Array.isArray(body.data)) syncTemplates(body.data as MetaTemplate[]);
    if (input.action === "phone_numbers") {
      const phone = (body.data as MetaPhone[] | undefined)?.find((item) => item.id === process.env.WHATSAPP_PHONE_NUMBER_ID);
      setSettings({ metaPhoneRegistrationVerified: phone ? "true" : "false", metaPhoneRegistrationCheckedAt: nowIso() });
      if (!phone) throw new Error("The configured Phone Number ID was not returned by the configured WABA.");
    }
    const label = input.action.replace("_", " ");
    return NextResponse.json({ ...diagnostics, connected: true, action: input.action, result: body.data || body, message: `Meta ${label} check completed.` });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? Number((error as { code: unknown }).code) : undefined;
    setSettings({ metaTokenUsable: "false", metaTokenLastCheckedAt: nowIso() });
    return NextResponse.json({ ...state(), tokenUsable: false, connected: false, code, message: error instanceof Error ? error.message : "Diagnostics failed" }, { status: 400 });
  }
}
