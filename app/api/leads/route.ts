import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createManualLead, leadSources } from "@/lib/product/operations";
import { enforceRateLimit, enforceSameOrigin } from "@/lib/security/http";

const ManualLeadSchema = z.object({
  name: z.string().trim().min(2).max(160), phone: z.string().min(10).max(24), email: z.string().email().nullable().optional(),
  source: z.enum(leadSources), primaryConcern: z.string().max(1000).nullable().optional(), treatmentCategory: z.string().max(80).nullable().optional(),
  treatmentSlug: z.string().max(100).nullable().optional(), context: z.string().max(4000).nullable().optional(), previousInteraction: z.string().max(3000).nullable().optional(),
  leadStatus: z.string().max(40).optional(), leadPriority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  preferredLanguage: z.enum(["AUTO", "ENGLISH", "HINDI", "HINGLISH", "ODIA"]).optional(), followupAt: z.string().nullable().optional(), callbackAt: z.string().nullable().optional(),
  assignedTo: z.string().max(100).nullable().optional(), whatsappConsent: z.enum(["UNKNOWN", "CONFIRMED", "REVOKED"]).optional(), doNotContact: z.boolean().optional(),
  internalNotes: z.string().max(4000).nullable().optional(), nextAction: z.enum(["ANSWER", "ASK_ONE_QUESTION", "SHOW_OPTIONS", "SHARE_CONTENT", "HANDLE_OBJECTION", "OFFER_BOOKING", "CHECK_SLOTS", "BOOK", "CALL", "MANUAL_FOLLOWUP", "WAIT", "DOCTOR_REVIEW", "CLOSE_NOT_INTERESTED"]).optional(),
});

export async function POST(request: NextRequest) {
  try {
    enforceSameOrigin(request); enforceRateLimit(request, "manual-leads", 30);
    return NextResponse.json({ ok: true, ...createManualLead(ManualLeadSchema.parse(await request.json())) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Lead creation failed" }, { status: 400 }); }
}
