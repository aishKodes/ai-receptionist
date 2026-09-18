import { RemoteProvider } from "./remote";

export class GeminiProvider extends RemoteProvider {
  constructor(model = process.env.AI_LANGUAGE_FALLBACK_MODEL || "gemini-3.1-flash-lite", key = process.env.GEMINI_API_KEY || "") {
    super("gemini", model, key);
  }
}
