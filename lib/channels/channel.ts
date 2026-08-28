export type SendTextInput = { to: string; text: string };
export type SendContentInput = SendTextInput & { url: string };
export type SendTemplateInput = { to: string; templateName: string; language: string; variables: string[] };

export interface MessageChannel {
  name: "local" | "whatsapp";
  sendText(input: SendTextInput): Promise<{ id: string; status: string }>;
  sendContent(input: SendContentInput): Promise<{ id: string; status: string }>;
  sendTemplate?(input: SendTemplateInput): Promise<{ id: string; status: string }>;
}
