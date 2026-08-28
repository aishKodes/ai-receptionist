import { RemoteProvider } from "./remote";

export class GeminiProvider extends RemoteProvider {
  constructor(model = process.env.AI_FALLBACK_MODEL || "gemini-3.6-flash", key = process.env.GEMINI_API_KEY || "") {
    super("gemini", model, key);
  }
}
