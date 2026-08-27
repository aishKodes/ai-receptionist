import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPatientContext } from "@/lib/services/repository";

const Schema = z.object({ question: z.string().min(2).max(300) });

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { question } = Schema.parse(await request.json());
    const record = getPatientContext(id);
    if (!record) return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    const patient = record.patient;
    const q = question.toLowerCase();
    let answer = String(patient.aiSummary || "No summary is available yet.");
    if (/why.*hot|score/.test(q)) answer = `${patient.name} has a lead score of ${patient.leadScore}. The stored conversation shows ${patient.treatmentSlug ? `specific ${String(patient.treatmentSlug).replaceAll("_", " ")} interest` : "a general enquiry"}${record.appointment ? ` and a ${record.appointment.status} consultation` : ""}.`;
    else if (/next|reception/.test(q)) answer = record.appointment ? `The next step is to keep the ${record.appointment.status} consultation on track and respond if the patient requests a timing change.` : patient.leadStage === "human_required" ? "A receptionist should review the conversation and respond personally." : "Offer a consultation when the patient is ready, without diagnosing or quoting an unverified price.";
    else if (/want|summary|summarize/.test(q)) answer = String(patient.aiSummary || `The patient is enquiring about ${patient.primaryConcern || patient.treatmentSlug || "a clinic concern"}.`);
    return NextResponse.json({ answer, grounded: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to answer" }, { status: 400 }); }
}
