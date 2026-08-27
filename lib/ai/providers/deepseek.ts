import { RemoteProvider } from "./remote";

export class DeepSeekProvider extends RemoteProvider {
  constructor(model = process.env.AI_PRIMARY_MODEL || "deepseek-v4-flash", key = process.env.DEEPSEEK_API_KEY || "") {
    super("deepseek", model, key);
  }
}
