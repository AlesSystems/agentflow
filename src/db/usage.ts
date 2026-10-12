import type Database from "better-sqlite3";
import type { UsagePayload } from "../contracts/usage";
import { canonicalDigest } from "../domain/request-digest";
import { Conflict } from "../domain/tasks";
export class UsageData {
    constructor(private readonly db: Database.Database) { }
    accept(runId: string, eventId: string, payload: UsagePayload, receivedAt: number): void {
        const digest = canonicalDigest(payload);
        const existing = this.db.prepare("SELECT payload_digest FROM usage_measurements WHERE run_id=? AND usage_id=?").get(runId, payload.usageId) as {
            payload_digest: string;
        } | undefined;
        if (existing) {
            if (existing.payload_digest !== digest)
                throw new Conflict("usage_conflict");
            return;
        }
        this.db.prepare("INSERT INTO usage_measurements(run_id,usage_id,event_id,payload_digest,source,model,input_tokens,output_tokens,billing_basis,measured_at,first_received_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(runId, payload.usageId, eventId, digest, payload.source, payload.model, payload.inputTokens, payload.outputTokens, payload.billingBasis, Date.parse(payload.measuredAt), receivedAt);
    }
    private envelope(data: unknown) {
        const { generation } = this.db.prepare("SELECT generation FROM instance_metadata WHERE singleton=1").get() as {
            generation: string;
        };
        const { cursor } = this.db.prepare("SELECT CAST(coalesce(max(cursor),0) AS TEXT) AS cursor FROM changes").get() as {
            cursor: string;
        };
        return { data, generation, snapshotCursor: cursor };
    }
    private reference(table:"projects"|"usage_price_snapshots",id:string):string|undefined {
        const rows=this.db.prepare(`SELECT id FROM ${table} WHERE id=? COLLATE NOCASE LIMIT 2`).all(id) as {id:string}[];
        if(rows.length>1)throw new Conflict("identity_ambiguous");
        return rows[0]?.id;
    }
    private price(id: string): UsagePriceSnapshot {
        const storedId=this.reference("usage_price_snapshots",id);
        const row = this.db.prepare("SELECT * FROM usage_price_snapshots WHERE id=?").get(storedId??id) as {
            id: string;
            name: string;
            captured_at: number;
            effective_at: number | null;
            created_at: number;
        } | undefined;
        if (!row)
            throw new Conflict("resource_not_found");
        const entries = this.db.prepare("SELECT source,model,currency,input_price AS inputPrice,output_price AS outputPrice FROM usage_price_entries WHERE snapshot_id=? ORDER BY source,model LIMIT 21").all(row.id);
        return usagePriceSnapshot.parse({ id: row.id, name: row.name, capturedAt: iso(row.captured_at), effectiveAt: iso(row.effective_at), createdAt: iso(row.created_at), entries });
    }
    createPriceSnapshot(input: PriceSnapshotCreate, context: CommandContext): CommittedReply {
        if (context.principal !== "operator")
            throw new Conflict("human_required");
        return this.db.transaction(() => {
            const prior = this.db.prepare("SELECT digest,status,body FROM receipts WHERE principal=? AND method=? AND path=? AND key=?").get(context.principal, context.method, context.path, context.key) as {
                digest: string;
                status: number;
                body: string;
            } | undefined;
            if (prior) {
                if (prior.digest !== context.digest)
                    throw new Conflict("idempotency_conflict");
                return { status: prior.status, body: JSON.parse(prior.body) };
            }
            if (this.reference("usage_price_snapshots",input.id))
                throw new Conflict("price_snapshot_conflict");
            this.db.prepare("INSERT INTO usage_price_snapshots VALUES(?,?,?,?,?,?)").run(input.id, input.name, Date.parse(input.capturedAt), input.effectiveAt ? Date.parse(input.effectiveAt) : null, JSON.stringify(input.entries), context.now);
            const insert = this.db.prepare("INSERT INTO usage_price_entries VALUES(?,?,?,?,?,?)");
            for (const entry of input.entries)
                insert.run(input.id, entry.source, entry.model, entry.currency, entry.inputPrice, entry.outputPrice);
            this.db.prepare("INSERT INTO changes(entity_type,entity_id,project_id,kind,received_at) VALUES('settings','settings',NULL,'updated',?)").run(context.now);
            const reply = { status: 201, body: this.envelope(this.price(input.id)) };
            this.db.prepare("INSERT INTO receipts VALUES(?,?,?,?,?,?,?)").run(context.principal, context.method, context.path, context.key, context.digest, reply.status, JSON.stringify(reply.body));
            return reply;
        }).immediate();
    }
    priceSnapshots(input: PageQuery): PriceSnapshotPage {
        const state = this.envelope(null), binding = { generation: state.generation, highWater: state.snapshotCursor, fingerprint: canonicalDigest({ kind: "usage.prices", limit: input.limit, order: "created_at-id-desc" }) }, bound = boundary(input.cursor, binding);
        const rows = this.db.prepare("SELECT id,created_at FROM usage_price_snapshots" + (bound ? " WHERE created_at<? OR (created_at=? AND id<?)" : "") + " ORDER BY created_at DESC,id DESC LIMIT ?").all(...(bound ? [bound.time, bound.time, bound.id] : []), input.limit + 1) as {
            id: string;
            created_at: number;
        }[];
        const more = rows.length > input.limit;
        rows.splice(input.limit);
        const last = rows.at(-1);
        return { items: rows.map(row => this.price(row.id)), total: (this.db.prepare("SELECT count(*) total FROM usage_price_snapshots").get() as {
                total: number;
            }).total, nextCursor: more && last ? Buffer.from(JSON.stringify({ v: 1, ...binding, time: last.created_at, id: last.id })).toString("base64url") : null };
    }
    snapshot(input: UsageQuery, _now: number): UsageSummary {
        void _now;
        connection(this.db);
        const projectId=this.reference("projects",input.projectId);
        if (!projectId)
            throw new Conflict("resource_not_found");
        const state = this.envelope(null), { cursor, ...filters } = input, binding = { generation: state.generation, highWater: state.snapshotCursor, fingerprint: canonicalDigest({ kind: "usage", filters, order: "started_at-id-desc" }) }, bound = boundary(cursor, binding);
        const from = Date.parse(input.from), to = Date.parse(input.to), eligible = "project_id=? AND started_at IS NOT NULL AND started_at<? AND (ended_at IS NULL OR ended_at>=?)";
        const eligibleParams = [projectId, to, from];
        const report = "r.project_id=? AND u.first_received_at>=? AND u.first_received_at<?" + (input.source ? " AND u.source=?" : "") + (input.model ? " AND u.model=?" : ""), params = [projectId, from, to, ...(input.source ? [input.source] : []), ...(input.model ? [input.model] : [])];
        const selected = `(SELECT u.* FROM usage_measurements u JOIN runs r ON r.id=u.run_id WHERE ${report})`;
        const totals = this.db.prepare(`SELECT ${totalsSql},count(*) AS filteredReportCount,count(DISTINCT run_id) AS filteredRunsWithReports FROM ${selected}`).get(...params) as Totals & {
            filteredReportCount: number;
            filteredRunsWithReports: number;
        };
        const coverage = this.db.prepare(`SELECT count(*) AS eligibleRuns,count(CASE WHEN EXISTS(SELECT 1 FROM usage_measurements u WHERE u.run_id=r.id AND u.first_received_at>=? AND u.first_received_at<?) THEN 1 END) AS runsWithReports FROM runs r WHERE ${eligible}`).get(from, to, ...eligibleParams) as {
            eligibleRuns: number;
            runsWithReports: number;
        };
        const groups = this.db.prepare(`SELECT source,model,count(*) AS reportCount,${totalsSql} FROM ${selected} GROUP BY source,model ORDER BY source,model LIMIT 101`).all(...params) as (Totals & {
            source: string;
            model: string;
            reportCount: number;
        })[];
        groups.splice(100);
        const totalGroups = (this.db.prepare(`SELECT count(*) AS n FROM (SELECT source,model FROM ${selected} GROUP BY source,model)`).get(...params) as {
            n: number;
        }).n;
        const rows = this.db.prepare(`SELECT id,task_id,purpose,rework_round,started_at FROM runs WHERE (${eligible})` + (bound ? " AND (started_at<? OR (started_at=? AND id<?))" : "") + " ORDER BY started_at DESC,id DESC LIMIT ?").all(...eligibleParams, ...(bound ? [bound.time, bound.time, bound.id] : []), input.limit + 1) as {
            id: string;
            task_id: string | null;
            purpose: string;
            rework_round: number;
            started_at: number;
        }[];
        const more = rows.length > input.limit;
        rows.splice(input.limit);
        const last = rows.at(-1);
        const runDetails = rows.map(row => { const values = this.db.prepare(`SELECT ${totalsSql},count(*) matchingReportCount,min(first_received_at) firstReceivedAt,max(first_received_at) lastReceivedAt,min(measured_at) firstMeasuredAt,max(measured_at) lastMeasuredAt FROM ${selected} WHERE run_id=?`).get(...params, row.id) as Totals & {
            matchingReportCount: number;
            firstReceivedAt: number | null;
            lastReceivedAt: number | null;
            firstMeasuredAt: number | null;
            lastMeasuredAt: number | null;
        }; return { ...values, runId: row.id, taskId: row.task_id, purpose: row.purpose, reworkRound: row.rework_round, firstReceivedAt: iso(values.firstReceivedAt), lastReceivedAt: iso(values.lastReceivedAt), firstMeasuredAt: iso(values.firstMeasuredAt), lastMeasuredAt: iso(values.lastMeasuredAt) }; });
        let estimate = null;
        if (input.priceSnapshotId) {
            const snapshot = this.price(input.priceSnapshotId), join = `FROM ${selected} u LEFT JOIN usage_price_entries p ON p.snapshot_id=? AND p.source=u.source AND p.model=u.model`, priceParams = [...params, snapshot.id];
            const unknown = "u.input_tokens IS NULL OR u.output_tokens IS NULL", known = "u.input_tokens IS NOT NULL AND u.output_tokens IS NOT NULL", basis = "u.billing_basis='input_output_only'", missing = "p.source IS NULL OR p.input_price IS NULL OR p.output_price IS NULL", complete = `${known} AND ${basis} AND NOT (${missing})`;
            const exclusions = this.db.prepare(`SELECT count(CASE WHEN ${complete} THEN 1 END) includedReports,count(CASE WHEN ${unknown} THEN 1 END) excludedUnknownCounts,count(CASE WHEN ${known} AND (u.billing_basis IS NULL OR u.billing_basis<>'input_output_only') THEN 1 END) excludedUnsupportedBasis,count(CASE WHEN ${known} AND ${basis} AND (${missing}) THEN 1 END) excludedMissingPrice ${join}`).get(...priceParams);
            const currencies = this.db.prepare(`SELECT p.currency,exact_money(CAST(u.input_tokens AS TEXT)||':'||p.input_price||':'||CAST(u.output_tokens AS TEXT)||':'||p.output_price) amount ${join} WHERE ${complete} GROUP BY p.currency ORDER BY p.currency LIMIT 20`).all(...priceParams);
            estimate = { snapshot, ...exclusions as object, currencies };
        }
        return usageSummary.parse({ projectId, from: input.from, to: input.to, source: input.source ?? null, model: input.model ?? null, ...coverage, runsWithoutReports: coverage.eligibleRuns - coverage.runsWithReports, ...totals, groups, totalGroups, groupsTruncated: totalGroups > 100, runDetails, totalRuns: coverage.eligibleRuns, nextCursor: more && last ? Buffer.from(JSON.stringify({ v: 1, ...binding, time: last.started_at, id: last.id })).toString("base64url") : null, estimate });
    }
}
import { z } from "zod";
import { usageSummary, usagePriceSnapshot, type UsageQuery, type UsageSummary, type PriceSnapshotCreate, type UsagePriceSnapshot, type PageQuery, type PriceSnapshotPage } from "../contracts/usage";
import type { CommandContext, CommittedReply } from "./application";
import { amountText, priceUnits } from "../usage/decimal";
const registered = new WeakSet<Database.Database>();
const iso = (value: number | null) => value === null ? null : new Date(value).toISOString();
const totalsSql = `exact_tokens(input_tokens) AS knownInputTokens,exact_tokens(output_tokens) AS knownOutputTokens,exact_tokens(CASE WHEN input_tokens IS NOT NULL AND output_tokens IS NOT NULL THEN CAST(input_tokens AS TEXT)||':'||CAST(output_tokens AS TEXT) END) AS knownTotalTokens,count(CASE WHEN input_tokens IS NULL THEN 1 END) AS unknownInputReports,count(CASE WHEN output_tokens IS NULL THEN 1 END) AS unknownOutputReports,count(CASE WHEN input_tokens IS NULL OR output_tokens IS NULL THEN 1 END) AS unknownTotalReports`;
type Totals = {
    knownInputTokens: string;
    knownOutputTokens: string;
    knownTotalTokens: string;
    unknownInputReports: number;
    unknownOutputReports: number;
    unknownTotalReports: number;
};
const cursorSchema = z.strictObject({ v: z.literal(1), generation: z.uuid(), fingerprint: z.string().length(64), highWater: z.string(), time: z.number().int().safe(), id: z.string().min(1).max(100) });
function boundary(cursor: string | undefined, binding: {
    generation: string;
    fingerprint: string;
    highWater: string;
}) {
    if (!cursor)
        return null;
    try {
        if (!/^[A-Za-z0-9_-]+$/.test(cursor) || cursor.length > 4096)
            throw new Error();
        const parsed = cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
        for (const key of ["generation", "fingerprint", "highWater"] as const)
            if (parsed[key] !== binding[key])
                throw new Error();
        return parsed;
    }
    catch {
        throw new Conflict("cursor_invalid");
    }
}
function connection(db: Database.Database) {
    if (registered.has(db))
        return;
    db.aggregate("exact_tokens", { start: 0n, step: (total: bigint, value: bigint | string | null) => value === null ? total : total + (typeof value === "string" ? value.split(":").reduce((a, v) => a + BigInt(v), 0n) : value), result: total => total.toString(), safeIntegers: true });
    db.aggregate("exact_money", { start: 0n, step: (total: bigint, value: bigint | string | null) => value === null ? total : total + String(value).split(":").reduce((a, v, i, values) => i % 2 === 0 ? a + BigInt(v) * priceUnits(values[i + 1]) : a, 0n), result: amountText });
    registered.add(db);
}
