import { NextRequest, NextResponse } from "next/server";
import { getProvider, getProviderByName, providerStatus } from "@/lib/ai/provider-factory";
import { enforceRateLimit, enforceSameOrigin } from "@/lib/security/http";

export async function POST(request: NextRequest) {
  try {
    enforceSameOrigin(request); enforceRateLimit(request, "provider-test", 10);
    const body = await request.json().catch(() => ({})) as { provider?: string };
    const status = providerStatus();
    const provider = body.provider === "deepseek" ? getProviderByName("deepseek", status.primary.model) : body.provider === "gemini-lite" ? getProviderByName("gemini", status.fallback.model) : body.provider === "gemini-complex" ? getProviderByName("gemini", status.complex.model) : getProvider();
    const health = await provider.healthCheck();
    return NextResponse.json({ ...health, provider: provider.name, configured: body.provider === "gemini-lite" ? status.fallback.configured : body.provider === "gemini-complex" ? status.complex.configured : status.primary.configured });
  }
  catch (error) { return NextResponse.json({ connected: false, message: error instanceof Error ? error.message : "Connection failed" }, { status: 503 }); }
}
