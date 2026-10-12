import { z } from "zod";
import { requiredText, timestamp } from "./common";
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable();
export const usagePayload = z.strictObject({
    usageId: requiredText(200),
    source: requiredText(200),
    model: requiredText(200),
    measuredAt: timestamp.transform(value => new Date(value).toISOString()),
    inputTokens: count,
    outputTokens: count,
    billingBasis: z.enum(["input_output_only", "unrepresented"]).nullable().optional().transform(value => value ?? null),
});
export type UsagePayload = z.infer<typeof usagePayload>;
import { envelope, pageQuery, uuid, inputUuid } from "./common";
const utc = timestamp.refine(value => value.endsWith("Z") && Number.isFinite(Date.parse(value)));
const integerText = z.string().regex(/^(0|[1-9][0-9]*)$/);
export const usageQuery = z.strictObject({ projectId: inputUuid, from: utc, to: utc, source: requiredText(200).optional(), model: requiredText(200).optional(), priceSnapshotId: inputUuid.optional(), ...pageQuery }).refine(value => { const duration = Date.parse(value.to) - Date.parse(value.from); return duration > 0 && duration <= 31 * 86400000; });
export const priceDecimal = z.string().regex(/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,12})?$/);
export const priceEntry = z.strictObject({ source: requiredText(200), model: requiredText(200), currency: z.string().regex(/^[A-Z]{3}$/), inputPrice: priceDecimal.nullable(), outputPrice: priceDecimal.nullable() });
export const priceSnapshotCreate = z.strictObject({ id: inputUuid, name: requiredText(200), capturedAt: utc, effectiveAt: utc.nullable().optional().transform(value => value ?? null), entries: z.array(priceEntry).min(1).max(20).refine(values => new Set(values.map(v => JSON.stringify([v.source, v.model]))).size === values.length) });
export const usagePriceSnapshot = priceSnapshotCreate.extend({ id:uuid,createdAt: timestamp });
export const usageMeasurement = z.strictObject({ runId: uuid, usageId: requiredText(200), source: requiredText(200), model: requiredText(200), measuredAt: timestamp, firstReceivedAt: timestamp, inputTokens: count, outputTokens: count, billingBasis: z.enum(["input_output_only", "unrepresented"]).nullable(), totalTokens: integerText.nullable() });
const totals = { knownInputTokens: integerText, knownOutputTokens: integerText, knownTotalTokens: integerText, unknownInputReports: z.number().int().nonnegative(), unknownOutputReports: z.number().int().nonnegative(), unknownTotalReports: z.number().int().nonnegative() };
export const usageEstimate = z.strictObject({ snapshot: usagePriceSnapshot, includedReports: z.number().int().nonnegative(), excludedUnknownCounts: z.number().int().nonnegative(), excludedUnsupportedBasis: z.number().int().nonnegative(), excludedMissingPrice: z.number().int().nonnegative(), currencies: z.array(z.strictObject({ currency: priceEntry.shape.currency, amount: z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$/) })).max(20) });
export const usageSummary = z.strictObject({ projectId: uuid, from: utc, to: utc, source: requiredText(200).nullable(), model: requiredText(200).nullable(), eligibleRuns: z.number().int().nonnegative(), runsWithReports: z.number().int().nonnegative(), runsWithoutReports: z.number().int().nonnegative(), filteredReportCount: z.number().int().nonnegative(), filteredRunsWithReports: z.number().int().nonnegative(), ...totals, groups: z.array(z.strictObject({ source: requiredText(200), model: requiredText(200), reportCount: z.number().int().nonnegative(), ...totals })).max(100), totalGroups: z.number().int().nonnegative(), groupsTruncated: z.boolean(), runDetails: z.array(z.strictObject({ runId: uuid, taskId: uuid.nullable(), purpose: z.enum(["planning", "implementation", "review", "verification"]), reworkRound: z.number().int().nonnegative().nullable(), matchingReportCount: z.number().int().nonnegative(), firstReceivedAt: timestamp.nullable(), lastReceivedAt: timestamp.nullable(), firstMeasuredAt: timestamp.nullable(), lastMeasuredAt: timestamp.nullable(), ...totals })).max(100), totalRuns: z.number().int().nonnegative(), nextCursor: z.string().nullable(), estimate: usageEstimate.nullable() });
export const usageResponse = envelope(usageSummary);
export const priceSnapshotsQuery = z.strictObject(pageQuery);
export const priceSnapshotsResponse = envelope(z.strictObject({ items: z.array(usagePriceSnapshot).max(100), total: z.number().int().nonnegative(), nextCursor: z.string().nullable() }));
export const priceSnapshotResponse = envelope(usagePriceSnapshot);
export type UsageQuery = z.infer<typeof usageQuery>;
export type UsageSummary = z.infer<typeof usageSummary>;
export type UsageMeasurement = z.infer<typeof usageMeasurement>;
export type PriceSnapshotCreate = z.infer<typeof priceSnapshotCreate>;
export type UsagePriceSnapshot = z.infer<typeof usagePriceSnapshot>;
export type UsageEstimate = z.infer<typeof usageEstimate>;
export type PageQuery = z.infer<typeof priceSnapshotsQuery>;
export type PriceSnapshotPage = z.infer<typeof priceSnapshotsResponse>["data"];
