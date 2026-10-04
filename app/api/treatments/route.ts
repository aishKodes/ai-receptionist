import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  approvalStatuses,
  getTreatmentCatalog,
  saveCatalogItem,
} from "@/lib/product/operations";
import { enforceRateLimit, enforceSameOrigin } from "@/lib/security/http";

const CatalogSchema = z.object({
  kind: z.enum(["category", "concern", "treatment", "price", "knowledge"]),
  id: z.string().optional(),
  name: z.string().max(160).optional(),
  slug: z.string().max(100).optional(),
  description: z.string().max(3000).nullable().optional(),
  categoryId: z.string().optional(),
  treatmentSlugs: z.array(z.string()).optional(),
  approvedExplanation: z.string().max(5000).nullable().optional(),
  benefits: z.array(z.string()).optional(),
  conversationOptions: z.array(z.string()).optional(),
  status: z.enum(approvalStatuses).optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().optional(),
  treatmentId: z.string().optional(),
  concernId: z.string().nullable().optional(),
  pricingType: z
    .enum([
      "RANGE",
      "FIXED",
      "PER_GRAFT",
      "PER_UNIT",
      "PACKAGE",
      "ASSESSMENT_REQUIRED",
    ])
    .optional(),
  minPrice: z.number().nonnegative().nullable().optional(),
  maxPrice: z.number().nonnegative().nullable().optional(),
  unit: z.string().nullable().optional(),
  displayText: z.string().max(255).optional(),
  pricingNote: z.string().max(2000).nullable().optional(),
  requiresAssessment: z.boolean().optional(),
  approvedForPatientDisplay: z.boolean().optional(),
  source: z.string().max(100).optional(),
  approvalStatus: z.enum(approvalStatuses).optional(),
  title: z.string().max(255).optional(),
  itemType: z.string().max(40).optional(),
  content: z.string().max(8000).optional(),
  approvedBy: z.string().max(100).optional(),
  category: z.string().max(80).optional(),
  approvedResponseGuidance: z.string().max(5000).optional(),
  bookingEnabled: z.boolean().optional(),
});

export function GET() {
  return NextResponse.json(getTreatmentCatalog());
}
export async function POST(request: NextRequest) {
  try {
    enforceSameOrigin(request);
    enforceRateLimit(request, "catalog", 40);
    const input = CatalogSchema.parse(await request.json());
    return NextResponse.json({
      ok: true,
      id: saveCatalogItem(input.kind, input),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Catalog update failed",
      },
      { status: 400 },
    );
  }
}
