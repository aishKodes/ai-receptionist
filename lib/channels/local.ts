import type { MessageChannel } from "./channel";

export class LocalDemoChannel implements MessageChannel {
  name: MessageChannel["name"] = "local_demo";
  async sendText() { return { id: crypto.randomUUID(), status: "stored_locally" }; }
  async sendContent() { return { id: crypto.randomUUID(), status: "stored_locally" }; }
  async sendTemplate() { return { id: crypto.randomUUID(), status: "stored_locally" }; }
}

export class MockMetaChannel extends LocalDemoChannel {
  name: MessageChannel["name"] = "mock_meta";
}
