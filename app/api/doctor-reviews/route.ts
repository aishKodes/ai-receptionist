import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveDoctorReview } from "@/lib/product/operations";
import { ready } from "@/lib/services/repository";
import { enforceRateLimit, enforceSameOrigin } from "@/lib/security/http";

export function GET() {
  const reviews = ready().prepare("SELECT r.id,r.patient_id AS patientId,r.conversation_id AS conversationId,r.question_summary AS questionSummary,r.priority,r.status,r.doctor_response AS doctorResponse,r.patient_reply AS patientReply,r.created_at AS createdAt,r.resolved_at AS resolvedAt,p.name AS patientName FROM doctor_reviews r JOIN patients p ON p.id=r.patient_id ORDER BY CASE r.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 ELSE 2 END,r.created_at DESC").all();
  return NextResponse.json({ reviews });
}
const ReviewSchema = z.object({ reviewId: z.string(), doctorResponse: z.string().trim().min(2).max(3000), saveAsGuidance: z.boolean().optional() });
export async function POST(request: NextRequest) {
  try { enforceSameOrigin(request); enforceRateLimit(request, "doctor-review", 30); return NextResponse.json({ ok: true, ...(await resolveDoctorReview(ReviewSchema.parse(await request.json()))) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Doctor review could not be resolved" }, { status: 400 }); }
}
