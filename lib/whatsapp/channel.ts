export type SendTextInput = { to: string; text: string };
export type SendContentInput = SendTextInput & { url: string };

export interface MessageChannel {
  name: "local_demo" | "whatsapp";
  sendText(input: SendTextInput): Promise<{ id: string; status: string }>;
  sendContent(input: SendContentInput): Promise<{ id: string; status: string }>;
}

export class LocalDemoChannel implements MessageChannel {
  name = "local_demo" as const;
  async sendText() { return { id: crypto.randomUUID(), status: "stored_locally" }; }
  async sendContent() { return { id: crypto.randomUUID(), status: "stored_locally" }; }
}

export class WhatsAppCloudChannel implements MessageChannel {
  name = "whatsapp" as const;
  private get config() {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneId) throw new Error("WhatsApp Cloud API credentials are not configured");
    return { token, phoneId, version: process.env.WHATSAPP_API_VERSION || "v23.0" };
  }
  async sendText({ to, text }: SendTextInput) {
    const config = this.config;
    const response = await fetch(`https://graph.facebook.com/${config.version}/${config.phoneId}/messages`, { method: "POST", headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text, preview_url: false } }), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`WhatsApp send failed (${response.status})`);
    const json = await response.json() as { messages?: Array<{ id: string }> };
    return { id: json.messages?.[0]?.id || crypto.randomUUID(), status: "accepted" };
  }
  async sendContent({ to, text, url }: SendContentInput) { return this.sendText({ to, text: `${text}\n${url}` }); }
}

export function getMessageChannel(): MessageChannel {
  return process.env.WHATSAPP_ENABLED === "true" ? new WhatsAppCloudChannel() : new LocalDemoChannel();
}
