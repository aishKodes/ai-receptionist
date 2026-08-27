import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMessageChannel } from "@/lib/whatsapp/channel";

const Schema = z.object({ to: z.string().min(8), text: z.string().min(1).max(2000), url: z.string().url().optional() });
export async function POST(request: NextRequest) {
  try {
    const input = Schema.parse(await request.json());
    const channel = getMessageChannel();
    const result = input.url ? await channel.sendContent({ ...input, url: input.url }) : await channel.sendText(input);
    return NextResponse.json({ ok: true, channel: channel.name, ...result });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Send failed" }, { status: 400 }); }
}
