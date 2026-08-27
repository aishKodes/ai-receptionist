import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSqlite } from "@/db";
import { addEvent, addMessage, getPatientContext, updatePatient } from "@/lib/services/repository";

const Schema = z.object({ patientId: z.string(), mode: z.enum(["human", "ai"]) });

export async function POST(request: NextRequest) {
  try {
    const { patientId, mode } = Schema.parse(await request.json());
    const context = getPatientContext(patientId);
    if (!context) return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    const aiEnabled = mode === "ai";
    getSqlite().prepare("UPDATE conversations SET ai_enabled=? WHERE id=?").run(Number(aiEnabled), context.conversation.id);
    updatePatient(patientId, { aiEnabled, assignedTo: aiEnabled ? "AI Reception" : "Front Desk", ...(aiEnabled && context.patient.leadStage === "human_required" ? { leadStage: "engaged" } : {}) });
    addEvent(patientId, String(context.conversation.id), aiEnabled ? "AI_RESUMED" : "AI_PAUSED", aiEnabled ? "AI reception resumed" : "Receptionist took over", aiEnabled ? "The AI will continue with full stored context." : "Automatic replies are paused immediately.");
    addMessage({ patientId, conversationId: String(context.conversation.id), direction: "outbound", senderType: "system", messageType: "system", content: aiEnabled ? "AI reception resumed with conversation context." : "A Radiance receptionist joined the conversation." });
    return NextResponse.json({ ok: true, mode });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Handoff failed" }, { status: 400 });
  }
}
