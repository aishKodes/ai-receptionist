import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { saveStaffContact } from "@/lib/product/staff-mode";
import { ready } from "@/lib/services/repository";
import { enforceRateLimit, enforceSameOrigin } from "@/lib/security/http";

export function GET() {
  const staff = ready().prepare("SELECT id,name,phone,role,active,can_view_summaries AS canViewSummaries,can_view_appointments AS canViewAppointments,can_receive_doctor_review AS canReceiveDoctorReview,can_approve_knowledge AS canApproveKnowledge,can_receive_alerts AS canReceiveAlerts,created_at AS createdAt,updated_at AS updatedAt FROM authorized_staff_contacts ORDER BY active DESC,role,name").all();
  return NextResponse.json({ staff });
}
const StaffSchema = z.object({ id: z.string().optional(), name: z.string().trim().min(2).max(160), phone: z.string().min(10).max(24), role: z.enum(["DOCTOR", "ADMIN", "RECEPTION", "MANAGER"]), active: z.boolean().optional(), canViewSummaries: z.boolean().optional(), canViewAppointments: z.boolean().optional(), canReceiveDoctorReview: z.boolean().optional(), canApproveKnowledge: z.boolean().optional(), canReceiveAlerts: z.boolean().optional() });
export async function POST(request: NextRequest) {
  try { enforceSameOrigin(request); enforceRateLimit(request, "staff", 20); return NextResponse.json({ ok: true, id: saveStaffContact(StaffSchema.parse(await request.json())) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Staff contact could not be saved" }, { status: 400 }); }
}
