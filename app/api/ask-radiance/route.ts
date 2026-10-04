import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { answerRadianceQuestion } from "@/lib/product/operations";
import { enforceRateLimit, enforceSameOrigin } from "@/lib/security/http";

const AskSchema = z.object({ question: z.string().trim().min(2).max(500) });
export async function POST(request: NextRequest) {
  try { enforceSameOrigin(request); enforceRateLimit(request, "ask-radiance", 40); return NextResponse.json(answerRadianceQuestion(AskSchema.parse(await request.json()).question)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Question could not be answered" }, { status: 400 }); }
}
