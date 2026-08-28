import type { MessageChannel } from "./channel";
import { LocalCaptureChannel } from "./local";
import { RealWhatsAppCloudChannel } from "./whatsapp-cloud";

export function getMessageChannel(): MessageChannel {
  const configured = process.env.MESSAGE_CHANNEL || (process.env.WHATSAPP_ENABLED === "true" ? "whatsapp" : "local");
  if (configured === "whatsapp") return new RealWhatsAppCloudChannel();
  return new LocalCaptureChannel();
}

export * from "./channel";
export * from "./local";
export * from "./whatsapp-cloud";
