import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSqlite } from "@/db";
import { addAudit, addEvent, addMessage, getPatientContext, setAiMode, updateHumanTask } from "@/lib/services/repository";
import { enforceRateLimit, enforceSameOrigin } from "@/lib/security/http";

const Schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("task"), taskId: z.string(), status: z.enum(["OPEN", "ASSIGNED", "CONTACTED", "SNOOZED", "RESOLVED"]), assignedTo: z.string().max(100).optional(), resolution: z.string().max(500).optional() }),
  z.object({ action: z.literal("takeover"), patientId: z.string(), enabled: z.boolean() }),
  z.object({ action: z.literal("send"), patientId: z.string(), text: z.string().trim().min(1).max(2000), taskId: z.string().optional() }),
]);

export function GET() {
  const tasks = getSqlite().prepare("SELECT h.id,h.patient_id AS patientId,h.conversation_id AS conversationId,h.type,h.priority,h.status,h.title,h.reason,h.suggested_reply AS suggestedReply,h.assigned_to AS assignedTo,h.due_at AS dueAt,h.created_at AS createdAt,p.name AS patientName,p.phone FROM human_tasks h JOIN patients p ON p.id=h.patient_id ORDER BY CASE h.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END,h.created_at DESC").all();
  return NextResponse.json({ tasks });
}

export async function POST(request: NextRequest) {
  try {
    enforceSameOrigin(request); enforceRateLimit(request, "human", 40);
    const input = Schema.parse(await request.json());
    if (input.action === "task") updateHumanTask(input.taskId, input.status, input.assignedTo, input.resolution);
    if (input.action === "takeover") setAiMode(input.patientId, !input.enabled, "RECEPTION");
    if (input.action === "send") {
      const context = getPatientContext(input.patientId); if (!context) throw new Error("Patient not found.");
      addMessage({ patientId: input.patientId, conversationId: String(context.conversation.id), direction: "outbound", senderType: "human", content: input.text });
      addEvent(input.patientId, String(context.conversation.id), "HUMAN_REPLY_SENT", "Receptionist replied", "A staff reply was sent.");
      addAudit("HUMAN_REPLY_SENT", "conversation", String(context.conversation.id), "Receptionist sent a reply", "RECEPTION", { patientId: input.patientId });
      if (input.taskId) updateHumanTask(input.taskId, "CONTACTED");
    }
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Human task action failed" }, { status: 400 }); }
}
