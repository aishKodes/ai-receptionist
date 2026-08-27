import { NextRequest, NextResponse } from "next/server";
import { getMessageChannel } from "@/lib/channels";
import { enforceRateLimit, enforceSameOrigin } from "@/lib/security/http";
import { z } from "zod";
import { getSqlite, nowIso } from "@/db";

const ActionSchema = z.object({ action: z.enum(["credentials", "waba", "phone_numbers", "templates", "check_webhook"]).default("credentials") });

function state() {
  return {
    channel: getMessageChannel().name,
    configured: {
      appId: Boolean(process.env.META_APP_ID), appSecret: Boolean(process.env.META_APP_SECRET),
      wabaId: Boolean(process.env.WHATSAPP_WABA_ID || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID), phoneNumberId: Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID),
      accessToken: Boolean(process.env.WHATSAPP_ACCESS_TOKEN), verifyToken: Boolean(process.env.WHATSAPP_VERIFY_TOKEN),
    },
    webhookPath: "/api/whatsapp/webhook",
    liveReady: Boolean(process.env.META_APP_SECRET && (process.env.WHATSAPP_WABA_ID || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID) && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_VERIFY_TOKEN),
  };
}

export function GET() { return NextResponse.json(state()); }
export async function POST(request: NextRequest) {
  try {
    enforceSameOrigin(request); enforceRateLimit(request, "meta-test", 10);
    const { action } = ActionSchema.parse(await request.json().catch(() => ({})));
    const diagnostics = state();
    if (!diagnostics.liveReady) return NextResponse.json({ ...diagnostics, connected: false, message: "Meta credentials are incomplete; Local Demo and Mock Meta remain available." }, { status: 503 });
    if (action === "check_webhook") return NextResponse.json({ ...diagnostics, connected: true, message: "Webhook route is ready for Meta verification and signed POST events." });
    const token = process.env.WHATSAPP_ACCESS_TOKEN!;
    const wabaId = process.env.WHATSAPP_WABA_ID || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
    const version = process.env.WHATSAPP_GRAPH_VERSION || process.env.WHATSAPP_API_VERSION || "v23.0";
    const target = action === "phone_numbers" ? `${wabaId}/phone_numbers` : action === "templates" ? `${wabaId}/message_templates?limit=100` : `${wabaId}?fields=id,name,timezone_id,message_template_namespace`;
    if (action !== "credentials") {
      const response = await fetch(`https://graph.facebook.com/${version}/${target}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
      const body = await response.json() as { data?: Array<{ name?: string; language?: string; category?: string; status?: string; components?: Array<{ type?: string; text?: string }> }>; error?: { code?: number; message?: string } };
      if (!response.ok) return NextResponse.json({ ...diagnostics, connected: false, code: body.error?.code || response.status, message: body.error?.message || "Meta Graph request failed" }, { status: 502 });
      if (action === "templates" && body.data) {
        const db = getSqlite();
        const update = db.prepare("UPDATE message_templates SET meta_template_name=?,category=?,language=?,status=?,last_synced_at=?,updated_at=? WHERE name=? OR meta_template_name=?");
        for (const template of body.data) update.run(template.name || null, template.category || "MARKETING", template.language || "en", template.status || "DRAFT", nowIso(), nowIso(), template.name || "", template.name || "");
      }
      return NextResponse.json({ ...diagnostics, connected: true, action, result: body.data || body, message: `Meta ${action.replace("_", " ")} check completed.` });
    }
    return NextResponse.json({ ...diagnostics, connected: true, message: "Credentials are present. Complete a live webhook/send check from Meta before enabling production traffic." });
  } catch (error) { return NextResponse.json({ connected: false, message: error instanceof Error ? error.message : "Diagnostics failed" }, { status: 400 }); }
}
