import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSettings, setSettings } from "@/lib/services/repository";
import { enforceRateLimit, enforceSameOrigin } from "@/lib/security/http";

const allowedKeys = [
  "appointmentConfirmation", "appointmentReminder1", "appointmentReminder2",
  "noShowRecovery", "dormantLeadFollowup",
] as const;

const Schema = z.object({
  values: z.record(z.enum(allowedKeys), z.enum(["true", "false"])),
});

export function GET() {
  const settings = getSettings();
  return NextResponse.json({ settings: Object.fromEntries(allowedKeys.map((key) => [key, settings[key] !== "false"])) });
}

export async function POST(request: NextRequest) {
  try {
    enforceSameOrigin(request);
    enforceRateLimit(request, "settings", 30);
    const input = Schema.parse(await request.json());
    setSettings(input.values);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Settings could not be saved" }, { status: 400 });
  }
}
