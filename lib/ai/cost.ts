// Conservative paid-tier estimates; actual invoices may differ for cache hits, free tier, and promotions.
// Sources: https://api-docs.deepseek.com/quick_start/pricing/ and https://ai.google.dev/gemini-api/docs/pricing
export function estimateModelCostUsd(model: string, inputTokens?: number | null, outputTokens?: number | null): number | null {
  if (inputTokens == null || outputTokens == null) return null;
  const rates: Record<string, [number, number]> = {
    "deepseek-flash": [0.30, 1.20], // peak, uncached; off-peak/cache hit can be lower
    "gemini-3.1-flash-lite": [0.25, 1.50],
    "gemini-3.8-flash": new Date().getUTCFullYear() >= 2027 ? [1.50, 7.50] : [0.75, 3.75],
  };
  const rate = rates[model];
  return rate ? Number(((inputTokens * rate[0] + outputTokens * rate[1]) / 1_000_000).toFixed(8)) : null;
}
