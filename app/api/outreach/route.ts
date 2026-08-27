import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createCampaign, getOutreachOverview, processOutboundOnce, sendCampaignTest, setCampaignStatus, startCampaign } from "@/lib/outreach/service";
import { enforceRateLimit, enforceSameOrigin } from "@/lib/security/http";

const Schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), name: z.string().min(2).max(160), templateId: z.string(), scheduledFor: z.string().nullable().optional() }),
  z.object({ action: z.literal("start"), campaignId: z.string() }), z.object({ action: z.literal("pause"), campaignId: z.string() }),
  z.object({ action: z.literal("cancel"), campaignId: z.string() }), z.object({ action: z.literal("test"), campaignId: z.string(), patientId: z.string() }),
  z.object({ action: z.literal("process") }),
]);

export function GET() { return NextResponse.json(getOutreachOverview()); }
export async function POST(request: NextRequest) {
  try {
    enforceSameOrigin(request); enforceRateLimit(request, "outreach", 30);
    const input = Schema.parse(await request.json());
    if (input.action === "create") return NextResponse.json({ ok: true, id: createCampaign(input) });
    if (input.action === "start") return NextResponse.json({ ok: true, ...startCampaign(input.campaignId) });
    if (input.action === "pause" || input.action === "cancel") { setCampaignStatus(input.campaignId, input.action === "pause" ? "PAUSED" : "CANCELLED"); return NextResponse.json({ ok: true }); }
    if (input.action === "test") return NextResponse.json({ ok: true, ...(await sendCampaignTest(input.campaignId, input.patientId)) });
    return NextResponse.json({ ok: true, ...(await processOutboundOnce()) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Outreach action failed" }, { status: 400 }); }
}
