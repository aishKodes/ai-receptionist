import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import { databasePath, getSqlite } from "@/db";
import { seedDatabase } from "@/lib/db/setup";
import { getDashboardState, getPatientContext, updateHumanTask } from "@/lib/services/repository";
import { processIncomingMessage } from "@/lib/channels/pipeline";
import { createCampaign, processOutboundOnce, startCampaign } from "@/lib/outreach/service";
import { marketingUsed, outreachDryRun, reserveMarketingContact } from "@/lib/outreach/prioritization";
import { importCsvLeads } from "@/lib/import/csv";
import { detectObjection, explicitLanguage, isPureLanguageRequest, languageFor, planTurn, removeBookingPressure, sanitizePatientReply, selectOfferedSlot, unsafeFactualClaim } from "@/lib/ai/conversation-policy";
import type { ReceptionDecision } from "@/lib/ai/schemas";

function decision(intent: ReceptionDecision["intent"] = "hair_loss", treatmentSlug: ReceptionDecision["treatmentSlug"] = "hair_loss"): ReceptionDecision {
  return { reply: "I can help you understand this. Would you like to book a consultation?", intent, extracted: { name: null, age: null, gender: null, concern: null, duration: null, desiredDate: null, desiredTime: null }, intentConfidence: 0.9, treatmentSlug, shouldSearchContent: false, contentQuery: null, shouldOfferBooking: false, humanEscalation: { required: false, recommended: false, type: "none", priority: "low", reason: null }, suggestedNextAction: "Answer the patient", internalSummary: "" };
}

const exploratory = [
  "I have acne", "My hair is thinning", "Just checking hair options", "I am researching PRP", "Only looking for information", "Not planning anything right now", "Could you explain hair transplant?", "What are the options for acne scars?", "I have dark spots", "Can you tell me how laser works?", "I want to understand recovery", "What causes hair fall?", "I am comparing options", "I have pimples", "Can you explain the process?", "hairfall info pls", "acne help", "tell me about gfc", "Is PRP suitable for everyone?", "I am exploring skin treatments"
];
const hesitation = [
  "I need to think about it", "I'll think about it", "Not ready yet", "Maybe later", "Just researching", "I am only checking", "Abhi nahi", "I will decide later", "I need time to think", "Not planning to book now", "I want information first", "Let me consider it"
];
const objections: Array<[string, string]> = [
  ["How much does it cost?", "PRICE"], ["Price seems high", "PRICE"], ["What's the fee?", "PRICE"], ["Is this expensive?", "PRICE"],
  ["I am scared of the procedure", "FEAR"], ["I am nervous", "FEAR"], ["Will it hurt?", "PAIN"], ["Is it painful?", "PAIN"],
  ["Can I trust your clinic?", "TRUST"], ["Is the doctor qualified?", "TRUST"], ["Are results guaranteed?", "RESULTS"], ["How long is recovery? I am worried", "TIME"],
  ["I live far away and travel is difficult", "TRAVEL"], ["I need to discuss with family", "FAMILY_DECISION"], ["I am comparing other clinics", "COMPARING_CLINICS"], ["I need a doctor's advice", "NEEDS_DOCTOR"]
];
const bookings = [
  "Can I book a consultation?", "Appointment tomorrow please", "Do you have slots on Saturday?", "Can I come tomorrow evening?", "I want to visit the clinic", "Is there availability next week?", "Please book me", "Can I get an appointment?", "I need to reschedule", "Change my appointment time", "Can I come on Monday?", "Book a slot this week", "Consultation availability?", "Can I visit on Friday?"
];
const calls = ["Call me", "Please call back", "Can someone call me?", "Can somebody call me today?", "Phone me", "I want to speak on the phone", "Could you call me back?", "Call me about hair transplant", "Please phone me", "Can someone call to explain?"];
const languages: Array<[string, string]> = [
  ["English please", "ENGLISH"], ["Speak English", "ENGLISH"], ["Reply in English", "ENGLISH"],
  ["Hindi mein bolo", "HINDI"], ["Speak Hindi please", "HINDI"], ["हिंदी में बात करो", "HINDI"],
  ["Hinglish mein bolo", "HINGLISH"], ["Reply in Hinglish", "HINGLISH"], ["Hinglish", "HINGLISH"],
  ["Odia re katha hua", "ODIA"], ["Please speak Odia", "ODIA"], ["Reply in Oriya", "ODIA"], ["ଓଡ଼ିଆରେ କଥା କୁହ", "ODIA"],
  ["Hindi", "HINDI"], ["English", "ENGLISH"], ["Odia", "ODIA"]
];
const content = ["Can you share the hair transplant guide video?", "Is there a video guide?", "Please send the YouTube guide", "A hair transplant resource would help", "Can you show a hair transplant video?", "Where is your guide video?", "Share a video resource please", "Do you have a YouTube video?", "Please send a guide", "Any educational video about hair transplant?"];
const slots = ["first", "1st", "second", "2nd", "third", "3rd", "5:30 works", "17:30", "10:00 am", "the first slot"];
const clinical = ["I have swelling after the procedure", "Bleeding after hair transplant", "Is this infection?", "The treated area looks infected", "Please ask the doctor if this is normal", "I need medical advice", "My treatment caused a rash", "I have severe pain after procedure"];

describe("conversation-quality: state/action, not fixed copy", () => {
  for (const [index, message] of exploratory.entries()) it(`exploratory ${index + 1}: ${message}`, () => {
    const plan = planTurn({ message, decision: decision() });
    expect(plan.nextBestAction).not.toBe("OFFER_BOOKING");
    expect(plan.allowBookingOffer).toBe(false);
    expect(removeBookingPressure(decision().reply, plan)).not.toMatch(/would you like to book/i);
  });
  for (const [index, message] of hesitation.entries()) it(`hesitation ${index + 1}: ${message}`, () => {
    const plan = planTurn({ message, decision: decision() });
    expect(plan.readinessScore).toBeLessThan(50);
    expect(plan.allowBookingOffer).toBe(false);
    expect(plan.nextBestAction).not.toBe("OFFER_BOOKING");
  });
  for (const [index, [message, expected]] of objections.entries()) it(`objection ${index + 1}: ${message}`, () => {
    expect(detectObjection(message)).toBe(expected);
    expect(planTurn({ message, decision: decision() }).nextBestAction).not.toBe("OFFER_BOOKING");
  });
  for (const [index, message] of bookings.entries()) it(`booking ${index + 1}: ${message}`, () => {
    const plan = planTurn({ message, decision: decision("appointment") });
    expect(plan.nextBestAction).toBe("OFFER_BOOKING");
    expect(plan.conversationPhase).toBe("BOOKING");
    expect(plan.readinessScore).toBeGreaterThanOrEqual(80);
  });
  for (const [index, message] of calls.entries()) it(`call ${index + 1}: ${message}`, () => {
    const plan = planTurn({ message, decision: decision("human_request") });
    expect(plan.humanRecommendation).toBe("CALL");
    expect(plan.nextBestAction).toBe("CALL_RECOMMENDED");
  });
  for (const [index, [message, expected]] of languages.entries()) it(`language ${index + 1}: ${message}`, () => {
    expect(explicitLanguage(message)).toBe(expected);
    expect(languageFor(message, "ENGLISH")).toBe(expected);
  });
  for (const [index, message] of content.entries()) it(`content ${index + 1}: ${message}`, () => {
    const d = decision("hair_transplant", "hair_transplant"); d.shouldSearchContent = true; d.contentQuery = message;
    const plan = planTurn({ message, decision: d, contentAvailable: true });
    expect(plan.nextBestAction).toBe("SHARE_CONTENT");
    expect(plan.contentRecommendation).toBe(message);
  });
  for (const [index, message] of slots.entries()) it(`slot ${index + 1}: ${message}`, () => {
    expect(selectOfferedSlot(message, ["10:00", "17:00", "17:30"])).not.toBeNull();
  });
  for (const [index, message] of clinical.entries()) it(`clinical ${index + 1}: ${message}`, () => {
    const d = decision("post_procedure_concern");
    expect(planTurn({ message, decision: d }).nextBestAction).toBe("DOCTOR_REVIEW");
  });
  it("covers at least 100 distinct realistic state/action cases", () => {
    const total = exploratory.length + hesitation.length + objections.length + bookings.length + calls.length + languages.length + content.length + slots.length + clinical.length;
    expect(total).toBeGreaterThanOrEqual(100);
    expect(new Set([...exploratory, ...hesitation, ...bookings, ...calls, ...content, ...slots, ...clinical, ...objections.map(([text]) => text), ...languages.map(([text]) => text)]).size).toBeGreaterThanOrEqual(100);
  });
  it("does not swallow a substantive question during a language switch", () => {
    expect(isPureLanguageRequest("Hindi mein bolo")).toBe(true);
    expect(isPureLanguageRequest("Hindi mein bolo. I was asking about recovery, not booking yet.")).toBe(false);
    const plan = planTurn({ message: "Hindi mein bolo. I was asking about recovery, not booking yet.", decision: decision("hair_transplant", "hair_transplant") });
    expect(plan.nextBestAction).toBe("ANSWER");
  });
  it("removes unsupported prices, guarantees, and fake doctor review claims", () => {
    const pricePlan = planTurn({ message: "What is the cost?", decision: decision("pricing") });
    expect(unsafeFactualClaim(sanitizePatientReply("It is guaranteed for ₹50,000.", pricePlan, "ENGLISH"))).toBe(false);
    const trustPlan = planTurn({ message: "Can I trust the clinic?", decision: decision() });
    expect(unsafeFactualClaim(sanitizePatientReply("The doctor has personally reviewed your case.", trustPlan, "ENGLISH"))).toBe(false);
  });
  it("removes an unsolicited consultation pitch from an information reply", () => {
    const plan = planTurn({ message: "Please send the hair transplant guide video", decision: decision("hair_transplant", "hair_transplant") });
    expect(removeBookingPressure("Here is the guide. I can also arrange a consultation if you would like.", plan)).toBe("Here is the guide.");
  });
  it("moves a persistent acne enquiry to a soft booking offer without a long intake", () => {
    const d = decision("acne", "acne"); d.extracted.duration = "5 years";
    const plan = planTurn({ message: "I have acne for 5 years.", decision: d });
    expect(plan.nextBestAction).toBe("SOFT_BOOKING_OFFER");
    expect(plan.readinessScore).toBeGreaterThanOrEqual(45);
    expect(plan.allowBookingOffer).toBe(true);
  });
  it("offers booking after a useful second hair-concern turn", () => {
    const plan = planTurn({ message: "Hair is thinning from the front.", decision: decision("hair_loss", "hair_loss"), state: { currentTreatment: "hair_loss", conversionMemoryJson: JSON.stringify({ substantiveTurns: 1 }) } });
    expect(plan.nextBestAction).toBe("SOFT_BOOKING_OFFER");
  });
  it("respects a booking decline, then reopens only on a later buying signal", () => {
    const declined = planTurn({ message: "Not ready to book.", decision: decision("acne", "acne") });
    expect(declined.bookingDeclinedForNow).toBe(true);
    expect(declined.allowBookingOffer).toBe(false);
    const reopened = planTurn({ message: "What is the cost?", decision: decision("pricing", "acne"), state: { bookingDeclinedForNow: true, currentTreatment: "acne", conversionMemoryJson: JSON.stringify({ substantiveTurns: 1 }) } });
    expect(reopened.bookingDeclinedForNow).toBe(false);
    expect(reopened.allowBookingOffer).toBe(true);
  });
  it("answers a price question and makes assessment the next step", () => {
    const plan = planTurn({ message: "How much does it cost?", decision: decision("pricing", "hair_transplant") });
    expect(plan.nextBestAction).toBe("SOFT_BOOKING_OFFER");
    expect(plan.allowBookingOffer).toBe(true);
  });
  it("returns direct slots for a tomorrow request", () => {
    const plan = planTurn({ message: "Can I come tomorrow?", decision: decision("appointment", "hair_transplant") });
    expect(plan.nextBestAction).toBe("OFFER_BOOKING");
    expect(plan.offerSlots).toBe(true);
  });
});

describe("conversation-quality: persisted local flows", () => {
  beforeAll(() => seedDatabase(true));
  afterAll(() => { getSqlite().close(); for (const suffix of ["", "-wal", "-shm"]) { try { fs.unlinkSync(`${databasePath}${suffix}`); } catch {} } });
  it("keeps an exploratory patient out of booking and persists readiness", async () => {
    await processIncomingMessage({ channel: "local", patientId: "pat_rahul", text: "I have acne, just researching options", messageType: "text" });
    const context = getPatientContext("pat_rahul")!;
    expect(context.state.nextBestAction).not.toBe("OFFER_BOOKING");
    expect(Number(context.state.readinessScore)).toBeLessThan(50);
    expect(context.state.conversationPhase).not.toBe("BOOKING");
    expect(context.messages.at(-1)?.content).not.toMatch(/would you like to book/i);
  });
  it("offers a consultation after a persistent acne concern and records the conversion state", async () => {
    await processIncomingMessage({ channel: "local", patientId: "pat_priyanka", text: "I have acne for 5 years.", messageType: "text" });
    const context = getPatientContext("pat_priyanka")!;
    expect(context.state.nextBestAction).toBe("SOFT_BOOKING_OFFER");
    expect(Number(context.state.readinessScore)).toBeGreaterThanOrEqual(45);
    expect(String(context.messages.at(-1)?.content)).toMatch(/available consultation times|consultation/i);
  });
  it("switches to Odia without resetting concern or calling a model", async () => {
    const before = (getSqlite().prepare("SELECT COUNT(*) AS count FROM provider_usage").get() as { count: number }).count;
    const concern = getPatientContext("pat_rahul")!.patient.primaryConcern;
    await processIncomingMessage({ channel: "local", patientId: "pat_rahul", text: "Odia re katha hua", messageType: "text" });
    const after = getPatientContext("pat_rahul")!;
    expect(after.state.preferredLanguage).toBe("ODIA");
    expect(after.patient.primaryConcern).toBe(concern);
    expect((getSqlite().prepare("SELECT COUNT(*) AS count FROM provider_usage").get() as { count: number }).count).toBe(before);
  });
  it("creates a call task for a direct request without model use", async () => {
    const before = (getSqlite().prepare("SELECT COUNT(*) AS count FROM provider_usage").get() as { count: number }).count;
    await processIncomingMessage({ channel: "local", patientId: "pat_rahul", text: "Can someone call me?", messageType: "text" });
    expect((getSqlite().prepare("SELECT COUNT(*) AS count FROM human_tasks WHERE patient_id='pat_rahul' AND type='CALL'").get() as { count: number }).count).toBe(1);
    expect((getSqlite().prepare("SELECT COUNT(*) AS count FROM provider_usage").get() as { count: number }).count).toBe(before);
  });
  it("answers a combined price and appointment request before offering real slots", async () => {
    await processIncomingMessage({ channel: "local", patientId: "pat_ananya", text: "How much will it cost and can I come tomorrow evening?", messageType: "text" });
    const context = getPatientContext("pat_ananya")!;
    expect(String(context.messages.at(-1)?.content)).toMatch(/final cost depends/i);
    expect(context.state.nextBestAction).toBe("OFFER_BOOKING");
    expect(context.state.pendingAction).toBe("select_slot");
  });
  it("does not press a hesitant patient after a slot discussion", async () => {
    await processIncomingMessage({ channel: "local", patientId: "pat_ananya", text: "I need to think about it; not planning to book now", messageType: "text" });
    const context = getPatientContext("pat_ananya")!;
    expect(context.state.nextBestAction).not.toBe("OFFER_BOOKING");
    expect(Number(context.state.readinessScore)).toBeLessThan(50);
  });
  it("limits a simulated marketing batch to ten and puts overflow in human review", async () => {
    const csv = "name,phone,concern,opt in\n" + Array.from({ length: 18 }, (_, i) => `Quality Lead ${i + 1},987654${String(1000 + i)},Hair transplant,yes`).join("\n");
    expect(importCsvLeads("quality.csv", csv).imported).toBe(18);
    getSqlite().prepare("UPDATE patients SET lead_score=80,lead_temperature='HOT' WHERE source='csv_import' OR source='import'").run();
    getSqlite().prepare("UPDATE message_templates SET status='APPROVED',meta_template_name='general_reengagement_v1' WHERE id='tpl_general_reengagement'").run();
    const campaignId = createCampaign({ name: "Quality budget simulation", templateId: "tpl_general_reengagement" });
    const simulation = outreachDryRun(campaignId);
    expect(simulation.selected.length).toBeLessThanOrEqual(10);
    expect(simulation.humanOpportunity.length).toBeGreaterThan(0);
    expect(marketingUsed()).toBe(0);
    expect(startCampaign(campaignId).queued).toBeLessThanOrEqual(10);
    expect(marketingUsed()).toBe(0);
    await processOutboundOnce(20);
    expect(marketingUsed()).toBe(10);
    expect(outreachDryRun(campaignId).selected).toHaveLength(0);
    expect(outreachDryRun(campaignId).humanOpportunity.length).toBeGreaterThan(0);
    expect(reserveMarketingContact(simulation.selected[0].id)).toBe("COOLDOWN");
  });
  it("keeps a not-interested human opportunity out of future outreach", () => {
    const task = getSqlite().prepare("SELECT id,patient_id AS patientId FROM human_tasks WHERE title='Human opportunity after outreach limit' LIMIT 1").get() as { id: string; patientId: string };
    expect(task).toBeTruthy();
    updateHumanTask(task.id, "NOT_INTERESTED");
    expect(getPatientContext(task.patientId)?.patient.leadStage).toBe("not_interested");
    expect(outreachDryRun().selected.some((item) => item.id === task.patientId)).toBe(false);
  });
  it("exposes persisted phase, readiness, funnel and model metrics to the dashboard", () => {
    const dashboard = getDashboardState("pat_rahul");
    expect(dashboard.selected?.state.conversationPhase).toBeTruthy();
    expect(dashboard.selected?.state.nextBestAction).toBeTruthy();
    expect(Number(dashboard.analytics.marketingUsed)).toBeLessThanOrEqual(10);
    expect(Number((dashboard.analytics as Record<string, unknown>).meaningfullyEngaged)).toBeGreaterThanOrEqual(1);
  });
});
