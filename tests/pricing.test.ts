import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databasePath, getSqlite } from "@/db";
import { seedDatabase } from "@/lib/db/setup";
import { getApprovedPrice, priceResponse } from "@/lib/product/pricing";

beforeAll(() => seedDatabase(true));
afterAll(() => { getSqlite().close(); for (const suffix of ["", "-wal", "-shm"]) { try { fs.unlinkSync(`${databasePath}${suffix}`); } catch {} } });

describe("doctor-approved pricing", () => {
  it("answers an approved hair-transplant price exactly", () => {
    const result = priceResponse("Hair transplant ka cost kya hai?", null, "HINGLISH");
    expect(result?.price?.displayText).toBe("₹45 per graft"); expect(result?.reply).toContain("₹45 per graft");
  });
  it("answers approved acne pricing", () => {
    expect(getApprovedPrice("acne")?.displayText).toBe("₹4,000–₹6,000");
  });
  it("does not expose ambiguous mole, wart or filler pricing", () => {
    expect(getApprovedPrice("mole_removal")).toBeNull(); expect(getApprovedPrice("wart_removal")).toBeNull(); expect(getApprovedPrice("fillers")).toBeNull();
  });
});
