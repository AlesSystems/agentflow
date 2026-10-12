import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { eventInput } from "../../src/contracts/observations";
const payload = { usageId: "measurement-1", source: "fixture", model: "model", measuredAt: "2026-10-12T00:00:00.000Z", inputTokens: null, outputTokens: 7 };
const report = { schemaVersion: 1, eventId: randomUUID(), runId: randomUUID(), sequence: 2, type: "run.usage", occurredAt: "2026-10-12T00:00:00.000Z", payload };
it("accepts required nullable safe counts and normalizes billing basis", () => {
 expect(eventInput.parse(report)).toMatchObject({ payload: { ...payload, billingBasis: null } });
 for (const value of [0, Number.MAX_SAFE_INTEGER, null]) expect(eventInput.safeParse({...report,payload:{...payload,inputTokens:value}}).success).toBe(true);
});
it("rejects missing, unsafe, fractional counts, invalid labels and caller totals", () => {
 for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) expect(eventInput.safeParse({...report,payload:{...payload,inputTokens:value}}).success).toBe(false);
 for (const key of ["inputTokens", "outputTokens"]) { const p: Record<string,unknown>={...payload};delete p[key];expect(eventInput.safeParse({...report,payload:p}).success).toBe(false); }
 for (const key of ["usageId","source","model"]) for (const value of ["", "x".repeat(201)]) expect(eventInput.safeParse({...report,payload:{...payload,[key]:value}}).success).toBe(false);
 expect(eventInput.safeParse({...report,payload:{...payload,totalTokens:7}}).success).toBe(false);
});
