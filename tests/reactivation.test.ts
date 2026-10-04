import { describe, expect, it } from "vitest";
import { calculateReactivationDecision } from "@/lib/outreach/prioritization";

const now = new Date("2026-10-04T12:00:00.000Z");
const old = "2026-09-14T12:00:00.000Z";

describe("cold lead reactivation", () => {
  it("selects an opted-in high-intent old hair lead for automated WhatsApp", () => {
    const result = calculateReactivationDecision({ leadScore: 88, treatmentSlug: "hair_transplant", whatsappOptInStatus: "CONFIRMED", lastContactAt: old, priceQuestions: 2, inboundCount: 4 }, now);
    expect(result.score).toBeGreaterThanOrEqual(70); expect(result.action).toBe("AUTO_WHATSAPP"); expect(result.reasons).toContain("Asked pricing");
  });
  it("recommends a call when the lead explicitly requested one", () => {
    expect(calculateReactivationDecision({ leadScore: 70, treatmentSlug: "hair_transplant", whatsappOptInStatus: "CONFIRMED", lastContactAt: old, callRequests: 1 }, now).action).toBe("CALL");
  });
  it("waits after recent contact", () => {
    expect(calculateReactivationDecision({ leadScore: 90, whatsappOptInStatus: "CONFIRMED", lastContactAt: "2026-10-02T12:00:00.000Z" }, now).action).toBe("WAIT");
  });
  it("never contacts an opted-out lead", () => {
    expect(calculateReactivationDecision({ leadScore: 99, whatsappOptInStatus: "REVOKED", doNotContact: true }, now).action).toBe("DO_NOT_CONTACT");
  });
});
