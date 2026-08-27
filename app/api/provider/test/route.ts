import { NextRequest, NextResponse } from "next/server";
import { getProvider, getProviderByName, providerStatus } from "@/lib/ai/provider-factory";
import { enforceRateLimit, enforceSameOrigin } from "@/lib/security/http";

export async function POST(request: NextRequest) {
  try {
    enforceSameOrigin(request); enforceRateLimit(request, "provider-test", 10);
    const body = await request.json().catch(() => ({})) as { provider?: string };
    const status = providerStatus();
    const provider = body.provider === "deepseek" ? getProviderByName("deepseek", process.env.AI_PRIMARY_MODEL) : body.provider === "gemini" ? getProviderByName("gemini", process.env.AI_FALLBACK_MODEL) : getProvider();
    const health = await provider.healthCheck();
    return NextResponse.json({ ...health, provider: provider.name, configured: body.provider === "gemini" ? status.fallback.configured : status.primary.configured });
  }
  catch (error) { return NextResponse.json({ connected: false, message: error instanceof Error ? error.message : "Connection failed" }, { status: 503 }); }
}
