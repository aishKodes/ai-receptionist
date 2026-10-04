export type SendTextInput = { to: string; text: string };
export type SendContentInput = SendTextInput & { url: string };
export type SendTemplateInput = { to: string; templateName: string; language: string; variables: string[] };
export type SendQuickRepliesInput = SendTextInput & { options: Array<{ id: string; label: string }> };
export type SendListInput = SendTextInput & { buttonLabel?: string; sections: Array<{ title: string; options: Array<{ id: string; label: string }> }> };

export interface MessageChannel {
  name: "local" | "whatsapp";
  sendText(input: SendTextInput): Promise<{ id: string; status: string }>;
  sendContent(input: SendContentInput): Promise<{ id: string; status: string }>;
  sendTemplate?(input: SendTemplateInput): Promise<{ id: string; status: string }>;
  sendQuickReplies?(input: SendQuickRepliesInput): Promise<{ id: string; status: string }>;
  sendList?(input: SendListInput): Promise<{ id: string; status: string }>;
}
