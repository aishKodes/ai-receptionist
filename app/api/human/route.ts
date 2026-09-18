import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDatabase } from "@/db";
import { updateHumanTask } from "@/lib/services/repository";
import { enforceRateLimit, enforceSameOrigin } from "@/lib/security/http";

const Schema = z.object({ action: z.literal("task"), taskId: z.string(), status: z.enum(["CONTACTED", "SNOOZED", "RESOLVED", "NOT_INTERESTED"]), resolution: z.string().max(500).optional() });

export function GET() {
  const tasks = getDatabase().prepare("SELECT h.id,h.patient_id AS patientId,h.conversation_id AS conversationId,h.type,h.priority,h.status,h.title,h.reason,h.suggested_reply AS suggestedReply,h.assigned_to AS assignedTo,h.due_at AS dueAt,h.created_at AS createdAt,p.name AS patientName,p.phone FROM human_tasks h JOIN patients p ON p.id=h.patient_id ORDER BY CASE h.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END,h.created_at DESC").all();
  return NextResponse.json({ tasks });
}

export async function POST(request: NextRequest) {
  try {
    enforceSameOrigin(request); enforceRateLimit(request, "human", 40);
    const input = Schema.parse(await request.json());
    updateHumanTask(input.taskId, input.status, "Front Desk", input.resolution);
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Human task action failed" }, { status: 400 }); }
}
