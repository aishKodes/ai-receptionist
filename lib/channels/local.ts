import type { MessageChannel } from "./channel";

/** Safe development/test sink. It never performs external delivery. */
export class LocalCaptureChannel implements MessageChannel {
  name: MessageChannel["name"] = "local";
  async sendText() { return { id: crypto.randomUUID(), status: "stored_locally" }; }
  async sendContent() { return { id: crypto.randomUUID(), status: "stored_locally" }; }
  async sendTemplate() { return { id: crypto.randomUUID(), status: "stored_locally" }; }
}
