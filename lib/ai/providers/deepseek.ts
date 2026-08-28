import { RemoteProvider } from "./remote";

export class DeepSeekProvider extends RemoteProvider {
  constructor(model = process.env.AI_PRIMARY_MODEL || "deepseek-chat", key = process.env.DEEPSEEK_API_KEY || "") {
    super("deepseek", model, key);
  }
}
