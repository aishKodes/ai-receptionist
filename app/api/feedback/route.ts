import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { addAiFeedback } from "@/lib/product/operations";
import { enforceRateLimit, enforceSameOrigin } from "@/lib/security/http";

const FeedbackSchema = z.object({ messageId: z.string(), patientId: z.string(), rating: z.enum(["GOOD", "NEEDS_IMPROVEMENT"]), reason: z.enum(["Wrong price", "Wrong treatment", "Too pushy", "Not pushy enough", "Missed context", "Bad language", "Should have escalated", "Other"]).nullable().optional(), notes: z.string().max(1000).nullable().optional() });
export async function POST(request: NextRequest) {
  try { enforceSameOrigin(request); enforceRateLimit(request, "ai-feedback", 60); return NextResponse.json({ ok: true, id: addAiFeedback(FeedbackSchema.parse(await request.json())) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Feedback could not be saved" }, { status: 400 }); }
}
