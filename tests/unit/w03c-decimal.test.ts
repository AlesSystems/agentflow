import { expect, it } from "vitest";
import { priceUnits, amountText } from "../../src/usage/decimal";
import { priceSnapshotCreate, usageQuery, usagePayload } from "../../src/contracts/usage";
it("uses exact eighteen-place money without early rounding", () => { expect(priceUnits("1.000000000001")).toBe(1000000000001n); expect(amountText(1n)).toBe("0.000000000000000001"); expect(amountText(17000000000000n)).toBe("0.000017"); expect(amountText(BigInt(Number.MAX_SAFE_INTEGER) * priceUnits("999999999999.999999999999"))).toBe("9007199254740990999999.990992800745259009"); });
it("rejects unsafe or caller total counts, invalid intervals and ambiguous local prices", () => { expect(usagePayload.safeParse({ usageId: "a", source: "s", model: "m", measuredAt: "2026-10-12T00:00:00Z", inputTokens: 1, outputTokens: 2, totalTokens: 3 }).success).toBe(false); expect(usageQuery.safeParse({ projectId: "11111111-1111-4111-8111-111111111111", from: "2026-01-01T00:00:00Z", to: "2026-03-01T00:00:00Z" }).success).toBe(false); for (const price of ["-1", "+1", "1e3", "NaN", "01", "1.1234567890123"]) {
    expect(priceSnapshotCreate.safeParse({ id: "11111111-1111-4111-8111-111111111111", name: "Local", capturedAt: "2026-10-12T00:00:00Z", entries: [{ source: "s", model: "m", currency: "USD", inputPrice: price, outputPrice: null }] }).success).toBe(false);
} });
