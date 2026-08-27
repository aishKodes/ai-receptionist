import type { MessageChannel } from "./channel";
import { LocalDemoChannel, MockMetaChannel } from "./local";
import { RealWhatsAppCloudChannel } from "./whatsapp-cloud";

export function getMessageChannel(): MessageChannel {
  const configured = process.env.MESSAGE_CHANNEL || (process.env.WHATSAPP_ENABLED === "true" ? "whatsapp" : "local");
  if (configured === "whatsapp") return new RealWhatsAppCloudChannel();
  if (configured === "mock_meta") return new MockMetaChannel();
  return new LocalDemoChannel();
}

export * from "./channel";
export * from "./local";
export * from "./whatsapp-cloud";
