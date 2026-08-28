import crypto from "node:crypto";
import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { databasePath, getSqlite } from "@/db";
import { seedDatabase } from "@/lib/db/setup";
import { processIncomingMessage } from "@/lib/channels/pipeline";
import { applyHumanLock, getPatientContext, updateConversationState } from "@/lib/services/repository";
import { createSessionToken, verifySessionToken } from "@/lib/auth/session";
import { POST as receiveWebhook } from "@/app/api/whatsapp/webhook/route";

beforeAll(() => seedDatabase(true));
afterAll(() => {
  getSqlite().close();
  for (const suffix of ["", "-wal", "-shm"]) { try { fs.unlinkSync(`${databasePath}${suffix}`); } catch {} }
});

describe("production safety regressions", () => {
  it("keeps the MySQL migration aligned with runtime SQL column names", () => {
    const migration = fs.readFileSync(new URL("../migrations/mysql/0001_production.sql", import.meta.url), "utf8");
    expect(migration).toContain("settings (`key`");
    expect(migration).toContain("available_slots (id VARCHAR(80) PRIMARY KEY, `date`");
    expect(migration).toContain("`time` VARCHAR(20)");
    expect(migration).not.toMatch(/setting_key|slot_date|slot_time/);
  });

  it("signs a 12-hour admin session and rejects tampering", async () => {
    const secret = "production-test-session-secret-32-characters";
    const token = await createSessionToken(secret);
    expect(await verifySessionToken(token, secret)).toBe(true);
    expect(await verifySessionToken(`${token}x`, secret)).toBe(false);
  });

  it("persists language and does not send content for simple turns", async () => {
    await processIncomingMessage({ channel: "local", patientId: "pat_rahul", messageType: "text", text: "Hindi" });
    let context = getPatientContext("pat_rahul")!;
    expect(context.state.preferredLanguage).toBe("HINDI");
    expect(String(context.messages.at(-1)?.content)).toMatch(/[\u0900-\u097f]/);
    expect(context.messages.some((message) => message.contentItemId)).toBe(false);

    await processIncomingMessage({ channel: "local", patientId: "pat_rahul", messageType: "text", text: "Hair transplant ka video guide share kijiye" });
    context = getPatientContext("pat_rahul")!;
    expect(context.messages.filter((message) => message.contentItemId)).toHaveLength(1);
    await processIncomingMessage({ channel: "local", patientId: "pat_rahul", messageType: "text", text: "Thanks" });
    expect(getPatientContext("pat_rahul")!.messages.filter((message) => message.contentItemId)).toHaveLength(1);
  });

  it("stores inbound messages without AI replies during a human lock and resumes on the next inbound after expiry", async () => {
    const before = getPatientContext("pat_ananya")!.messages.length;
    applyHumanLock("pat_ananya");
    const locked = await processIncomingMessage({ channel: "local", patientId: "pat_ananya", messageType: "text", text: "Are you there?" });
    expect("mode" in locked ? locked.mode : null).toBe("human_lock");
    expect(getPatientContext("pat_ananya")!.messages).toHaveLength(before + 1);

    const conversationId = String(getPatientContext("pat_ananya")!.conversation.id);
    updateConversationState(conversationId, { humanLockUntil: new Date(Date.now() - 1000).toISOString() });
    const resumed = await processIncomingMessage({ channel: "local", patientId: "pat_ananya", messageType: "text", text: "Thank you" });
    expect("mode" in resumed ? resumed.mode : null).toBe("ai");
    expect(Boolean(getPatientContext("pat_ananya")!.patient.aiEnabled)).toBe(true);
  });

  it("stores WhatsApp Business app echoes as human outbound messages and extends the human lock", async () => {
    process.env.META_APP_SECRET = "coexistence-test-secret";
    getSqlite().prepare("UPDATE patients SET whatsapp_id='919000000003' WHERE id='pat_rohit'").run();
    const body = { entry: [{ id: "waba-test", changes: [{ field: "smb_message_echoes", value: { messages: [{ id: "wamid.echo.1", from: "clinic-number", to: "919000000003", type: "text", text: { body: "Reception here. We will call you shortly." } }] } }] }] };
    const raw = JSON.stringify(body);
    const signature = `sha256=${crypto.createHmac("sha256", process.env.META_APP_SECRET).update(raw).digest("hex")}`;
    const response = await receiveWebhook(new NextRequest("http://localhost/api/whatsapp/webhook", { method: "POST", body: raw, headers: { "x-hub-signature-256": signature } }));
    expect((await response.json()).processed).toBe(1);
    const context = getPatientContext("pat_rohit")!;
    expect(context.messages.at(-1)).toMatchObject({ senderType: "human", direction: "outbound", externalMessageId: "wamid.echo.1" });
    expect(context.state.aiMode).toBe("HUMAN_LOCK");
    expect(new Date(String(context.state.humanLockUntil)).getTime()).toBeGreaterThan(Date.now());
  });

  it("never addresses an unverified placeholder as the patient name", async () => {
    getSqlite().prepare("UPDATE patients SET name='Radiance',name_verified=0 WHERE id='pat_sneha'").run();
    await processIncomingMessage({ channel: "local", patientId: "pat_sneha", messageType: "text", text: "Thank you" });
    expect(String(getPatientContext("pat_sneha")!.messages.at(-1)?.content)).not.toMatch(/(?:thank you|welcome),?\s+radiance/i);
  });
});
