import crypto from "node:crypto";
import type { MessageChannel, SendContentInput, SendTemplateInput, SendTextInput } from "./channel";

export function verifyMetaSignature(rawBody: string, signature: string | null, secret = process.env.META_APP_SECRET || "") {
  if (!secret || !signature?.startsWith("sha256=")) return false;
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  return expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export class RealWhatsAppCloudChannel implements MessageChannel {
  name = "whatsapp" as const;
  private get config() {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneId) throw new Error("WhatsApp Cloud API credentials are not configured");
    return { token, phoneId, version: process.env.WHATSAPP_GRAPH_VERSION || process.env.WHATSAPP_API_VERSION || "v23.0" };
  }
  private async send(payload: Record<string, unknown>) {
    const config = this.config;
    const response = await fetch(`https://graph.facebook.com/${config.version}/${config.phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`WhatsApp send failed (${response.status})`);
    const json = await response.json() as { messages?: Array<{ id: string }> };
    return { id: json.messages?.[0]?.id || crypto.randomUUID(), status: "accepted" };
  }
  sendText({ to, text }: SendTextInput) { return this.send({ to, type: "text", text: { body: text, preview_url: false } }); }
  sendContent({ to, text, url }: SendContentInput) { return this.sendText({ to, text: `${text}\n${url}` }); }
  sendTemplate({ to, templateName, language, variables }: SendTemplateInput) {
    return this.send({ to, type: "template", template: { name: templateName, language: { code: language }, components: variables.length ? [{ type: "body", parameters: variables.map((text) => ({ type: "text", text })) }] : [] } });
  }
}
