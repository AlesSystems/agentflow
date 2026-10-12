import { createHash,randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { openOwnedStore, type Store } from "../../src/db";
import { eventInput } from "../../src/contracts/observations";
import type { ApplicationCommand, ApplicationQuery } from "../../src/db/application";
import type { UsageSummary, PriceSnapshotPage } from "../../src/contracts/usage";
import type { z } from "zod";
import { retentionPreview } from "../../src/contracts/history";
import { canonicalDigest } from "../../src/domain/request-digest";
const from = "2026-10-12T00:00:00.000Z", to = "2026-10-13T00:00:00.000Z", start = Date.parse(from);
function send(store: Store, command: ApplicationCommand, now = start, principal: "operator" | "reporter" = "reporter", key = randomUUID()) { return store.command(command, { principal, method: "POST", path: command.kind, key, digest: canonicalDigest(command.input), now }); }
async function fixture(registry=migrations) {
    const dir = mkdtempSync(join(realpathSync(tmpdir()), "usage-query-")), owned = await openOwnedStore(dir,registry), store = owned.store;
    const projectId = (send(store, { kind: "project.create", input: { name: "Synthetic usage" } }).body.data as {
        id: string;
    }).id;
    const agentId = (send(store, { kind: "agent.create", input: { displayName: "Fixture", source: "irrelevant-current-label", defaultRole: "orchestrator" } }).body.data as {
        id: string;
    }).id;
    const run = (started = true) => { const id = randomUUID(); send(store, { kind: "run.register", input: { id, projectId, agentId, purpose: "planning" } }); if (started)
        emit(id, 1, "run.started", {}, start - 100); return id; };
    const emit = (id: string, sequence: number, type: string, payload: unknown, now = start + 100) => send(store, { kind: "run.event", id, input: eventInput.parse({ schemaVersion: 1, eventId: randomUUID(), runId: id, sequence, type, payload, occurredAt: from }) }, now);
    const usage = (id: string, sequence = 2, extra: Record<string, unknown> = {}, now = start + 100) => emit(id, sequence, "run.usage", { usageId: randomUUID(), source: "reported", model: "model", measuredAt: from, inputTokens: 3, outputTokens: 7, billingBasis: "input_output_only", ...extra }, now);
    const query = (extra: Record<string, unknown> = {}) => store.snapshot({ kind: "usage", input: { projectId, from, to, limit: 50, ...extra } } as ApplicationQuery, start + 1000).body.data as UsageSummary;
    return { dir, owned, store, projectId, run, emit, usage, query };
}
it("coverage_uses_started_interval_overlap and filters preserve project coverage", async () => { const f = await fixture(); try {
    const id = f.run();
    f.usage(id);
    f.run();
    f.run(false);
    const data = f.query({ source: "absent" });
    expect(data).toMatchObject({ eligibleRuns: 2, runsWithReports: 1, runsWithoutReports: 1, filteredReportCount: 0, filteredRunsWithReports: 0, knownTotalTokens: "0", totalRuns: 2 });
    expect(data.runDetails).toHaveLength(2);
    expect(f.query().knownTotalTokens).toBe("10");
}
finally {
    f.owned.close();
} });
it("exact_overflow_and_group_cap", async () => { const f = await fixture(); try {
    const id = f.run();
    for (let i = 0; i < 101; i++)
        f.usage(id, i + 2, { source: "s" + i, inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: Number.MAX_SAFE_INTEGER });
    const d = f.query();
    expect(d.knownInputTokens).toBe((101n * BigInt(Number.MAX_SAFE_INTEGER)).toString());
    expect(d.knownTotalTokens).toBe((202n * BigInt(Number.MAX_SAFE_INTEGER)).toString());
    expect(d.groups).toHaveLength(100);
    expect(d).toMatchObject({ totalGroups: 101, groupsTruncated: true, filteredReportCount: 101 });
}
finally {
    f.owned.close();
} });
it("first_receipt_wins_over_measurement_and_duplicate_time", async () => { const f = await fixture(); try {
    const id = f.run(), p = { usageId: "stable", measuredAt: to };
    f.usage(id, 2, p, start - 1);
    f.usage(id, 3, p, start + 1);
    expect(f.query()).toMatchObject({ filteredReportCount: 0, runsWithReports: 0, knownTotalTokens: "0" });
    f.usage(id, 4, { measuredAt: "2020-01-01T00:00:00.000Z", inputTokens: null });
    expect(f.query()).toMatchObject({ filteredReportCount: 1, knownInputTokens: "0", knownOutputTokens: "7", knownTotalTokens: "0", unknownTotalReports: 1 });
}
finally {
    f.owned.close();
} });
it("cursor_binds_complete_query_and_generation", async () => { const f = await fixture(); try {
    f.run();
    f.run();
    const a = f.query({ limit: 1 });
    expect(a.nextCursor).toBeTypeOf("string");
    for (const extra of [{ limit: 2 }, { source: "x" }, { model: "x" }, { from: "2026-10-11T00:00:00.000Z" }, { priceSnapshotId: randomUUID() }])
        expect(() => f.query({ ...extra, cursor: a.nextCursor })).toThrow("cursor_invalid");
    expect(f.query({ limit: 1, cursor: a.nextCursor }).runDetails).toHaveLength(1);
    f.run();
    expect(() => f.query({ limit: 1, cursor: a.nextCursor })).toThrow("cursor_invalid");
}
finally {
    f.owned.close();
} });
it("prices_exclude_in_order_and_never_mix_currencies and retry safe human creation", async () => { const f = await fixture(); try {
    const id = f.run();
    f.usage(id, 2);
    f.usage(id, 3, { model: "eur" });
    f.usage(id, 4, { inputTokens: null, billingBasis: null });
    f.usage(id, 5, { billingBasis: "unrepresented" });
    f.usage(id, 6, { billingBasis: null });
    f.usage(id, 7, { model: "missing" });
    const priceId = randomUUID(), key = randomUUID(), input = { id: priceId, name: "Local quote", capturedAt: from, entries: [{ source: "reported", model: "model", currency: "USD", inputPrice: "1", outputPrice: "2" }, { source: "reported", model: "eur", currency: "EUR", inputPrice: "1", outputPrice: "2" }] };
    const command = { kind: "usage.price.create", input } as ApplicationCommand;
    expect(() => send(f.store, command, start, "reporter", key)).toThrow("human_required");
    const first = send(f.store, command, start, "operator", key);
    f.run();
    expect(send(f.store, command, start + 100, "operator", key)).toEqual(first);
    expect(() => send(f.store, { ...command, input: { ...input, name: "Changed" } } as ApplicationCommand, start, "operator", key)).toThrow("idempotency_conflict");
    expect(() => send(f.store, command, start, "operator")).toThrow("price_snapshot_conflict");
    const d = f.query({ priceSnapshotId: priceId });
    expect(d.estimate).toMatchObject({ includedReports: 2, excludedUnknownCounts: 1, excludedUnsupportedBasis: 2, excludedMissingPrice: 1, currencies: [{ currency: "EUR", amount: "0.000017" }, { currency: "USD", amount: "0.000017" }] });
}
finally {
    f.owned.close();
} });
import Database from "better-sqlite3";
import { migrations } from "../../src/db";
import { openHistoryExportSnapshot } from "../../src/db/history";
import { copyFileSync,readFileSync } from "node:fs";
async function copied(dir:string) {
 const copy=mkdtempSync(join(realpathSync(tmpdir()),"usage-sql-copy-"));
 for(const suffix of ["","-wal","-shm","-journal"]){const original=join(dir,"agentflow.sqlite"+suffix);try{const before=createHash("sha256").update(readFileSync(original)).digest("hex");copyFileSync(original,join(copy,"agentflow.sqlite"+suffix));expect(createHash("sha256").update(readFileSync(original)).digest("hex")).toBe(before);expect(createHash("sha256").update(readFileSync(join(copy,"agentflow.sqlite"+suffix))).digest("hex")).toBe(before);}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}}
 return copy;
}
it("price facts reject direct changes and undeclared entries", async () => { const f = await fixture(); const id = randomUUID(); try {
    send(f.store, { kind: "usage.price.create", input: { id, name: "Immutable", capturedAt: from, effectiveAt: null, entries: [{ source: "s", model: "m", currency: "USD", inputPrice: "1", outputPrice: null }] } }, start, "operator");
    f.owned.close();
    const copy = await copied(f.dir), db = new Database(join(copy, "agentflow.sqlite"));
    try {
        for (const table of ["usage_price_snapshots", "usage_price_entries"]) {
            for (const sql of [`UPDATE ${table} SET ${table === "usage_price_snapshots" ? "name='changed'" : "currency='EUR'"}`, `DELETE FROM ${table}`, `INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`])
                expect(() => db.exec(sql)).toThrow("price_immutable");
        }
        expect(() => db.prepare("INSERT INTO usage_price_entries VALUES(?,'new','m','USD','1','1')").run(id)).toThrow("price_entry_invalid");
    }
    finally {
        db.close();
    }
}
finally {
    f.owned.close();
} });
it("schema11_to_12_preserves_ledger_and_ack",async()=>{
 const f=await fixture(migrations.slice(0,11)),id=f.run();f.usage(id,2,{usageId:"original",inputTokens:null});f.usage(id,3,{usageId:"original",inputTokens:null});f.owned.close();
 const tables=["usage_measurements","run_events","runs","receipts","changes","sqlite_sequence"],copy=await copied(f.dir),before=new Database(join(copy,"agentflow.sqlite"),{readonly:true});
 const rows=Object.fromEntries(tables.map(table=>[table,before.prepare(`SELECT rowid,* FROM ${table} ORDER BY rowid`).all()])),history=before.prepare("SELECT * FROM migration_history").all();before.close();
 const upgraded=await openOwnedStore(f.dir);try{expect(upgraded.store.metadata().schemaVersion).toBe(12);expect(upgraded.store.pragmas().foreign_keys).toBe(1);expect(upgraded.store.snapshot({kind:"usage",input:{projectId:f.projectId,from,to,limit:50}}).body.data).toMatchObject({filteredReportCount:1,knownOutputTokens:"7",unknownInputReports:1});}finally{upgraded.close();}
 const afterCopy=await copied(f.dir),after=new Database(join(afterCopy,"agentflow.sqlite"),{readonly:true});try{for(const table of tables)expect(after.prepare(`SELECT rowid,* FROM ${table} ORDER BY rowid`).all()).toEqual(rows[table]);expect(after.prepare("SELECT * FROM migration_history ORDER BY rowid LIMIT 11").all()).toEqual(history);expect(after.pragma("integrity_check",{simple:true})).toBe("ok");expect(after.pragma("foreign_key_check")).toEqual([]);}finally{after.close();}
});
it("usage_export_has_deduplicated_explicit_v2_facts", async () => { const f = await fixture(); const id = f.run(); f.usage(id, 2, { usageId: "same", inputTokens: null }); f.usage(id, 3, { usageId: "same", inputTokens: null }); send(f.store, { kind: "usage.price.create", input: { id: randomUUID(), name: "Local", capturedAt: from, effectiveAt: null, entries: [{ source: "reported", model: "model", currency: "USD", inputPrice: "1", outputPrice: "2" }] } }, start, "operator"); const generation = f.owned.store.metadata().generation; f.owned.close(); const copy = await copied(f.dir), snapshot = openHistoryExportSnapshot(join(copy, "agentflow.sqlite"), { content: ["attempts"], generation }, start); try {
    expect(snapshot.manifest.schemaVersion).toBe(2);
    const records = [];
    for (;;) {
        const batch = snapshot.nextBatch();
        if (!batch.length)
            break;
        records.push(...batch);
    }
    expect(records.filter(r => r.kind === "usageMeasurement")).toHaveLength(1);
    expect(records.filter(r => r.kind === "usagePriceSnapshot")).toHaveLength(1);
    expect(records.find(r => r.kind === "usageMeasurement")?.data).toMatchObject({ inputTokens: null, totalTokens: null, firstReceivedAt: from.replace("000Z", "100Z") });
    expect(JSON.stringify(records)).not.toContain("payloadDigest");
}
finally {
    snapshot.close();
} });
import { restore } from "../../src/db/recovery";
it("usage_export_survives_payload_prune_restore", async () => { const f = await fixture(); let owned = f.owned; try {
    const id = f.run();
    f.emit(id, 2, "run.progress", { message: "Discardable" });
    f.usage(id, 3, { usageId: "durable" });
    f.usage(id, 4, { usageId: "durable" });
    f.emit(id, 5, "run.succeeded", { summary: "Terminal" });
    const priceId = randomUUID();
    send(f.store, { kind: "usage.price.create", input: { id: priceId, name: "Retained", capturedAt: from, effectiveAt: null, entries: [{ source: "reported", model: "model", currency: "USD", inputPrice: "1", outputPrice: "2" }] } }, start, "operator");
    const before = f.query({ priceSnapshotId: priceId });
    const input = { cutoff: new Date(start + 500).toISOString() }, context = { principal: "operator" as const, method: "POST", path: "/retention/preview", key: randomUUID(), digest: canonicalDigest(input), now: start + 1000 };
    const preview = owned.store.historyPreview(input, context).body.data as z.infer<typeof retentionPreview>;
    expect(preview.counts.eventPayloads).toBe(1);
    const prune = { previewId: preview.previewId, expectedGeneration: preview.expectedGeneration, expectedVersion: preview.expectedVersion, candidateDigest: preview.candidateDigest };
    const admission = owned.store.historyAdmitPrune(prune, { ...context, path: "/retention/prune", key: randomUUID(), digest: canonicalDigest(prune) });
    expect("input" in admission).toBe(true);
    const backup = join(f.dir, "backups", "before-prune.sqlite");
    await owned.store.backup(backup);
    owned.store.historyCommitPrune(admission as import("../../src/db/history").PruneAdmission, start + 1001);
    expect(f.query({ priceSnapshotId: priceId })).toEqual(before);
    const exported = await owned.store.prepareHistoryExport(join(f.dir, "after-prune.sqlite"), { content: ["attempts"], generation: owned.store.metadata().generation }, new AbortController().signal);
    const records = [];
    for (;;) {
        const batch = exported.nextBatch();
        if (!batch.length)
            break;
        records.push(...batch);
    }
    exported.close();
    expect(records.filter(r => r.kind === "usageMeasurement")).toHaveLength(1);
    expect(records.filter(r => r.kind === "runEvent" && r.data.type === "run.usage")).toHaveLength(2);
    expect(records.find(r => r.kind === "runEvent" && r.data.type === "run.progress")?.data).toMatchObject({ payload: null });
    const generation = owned.store.metadata().generation;
    owned.close();
    await restore(f.dir, backup);
    owned = await openOwnedStore(f.dir);
    expect(owned.store.metadata().generation).not.toBe(generation);
    expect(owned.store.snapshot({ kind: "usage", input: { projectId: f.projectId, from, to, limit: 50, priceSnapshotId: priceId } }).body.data).toEqual(before);
}
finally {
    owned.close();
} });
it("price pages and partial prices remain bounded and independent", async () => { const f = await fixture(); try {
    const id = f.run();
    f.usage(id);
    let selected = "";
    for (let i = 0; i < 102; i++) {
        selected = randomUUID();
        send(f.store, { kind: "usage.price.create", input: { id: selected, name: "Local " + i, capturedAt: from, effectiveAt: null, entries: [{ source: "reported", model: "model", currency: "USD", inputPrice: "1", outputPrice: null }] } }, start + i, "operator");
    }
    const query = { kind: "usage.prices" as const, input: { limit: 100 } };
    const page = f.store.snapshot(query).body.data as PriceSnapshotPage;
    expect(page.items).toHaveLength(100);
    expect(page.total).toBe(102);
    expect((f.store.snapshot({ kind: "usage.prices", input: { limit: 100, cursor: page.nextCursor! } }).body.data as PriceSnapshotPage).items).toHaveLength(2);
    expect(f.query({ priceSnapshotId: selected }).estimate).toMatchObject({ includedReports: 0, excludedUnknownCounts: 0, excludedUnsupportedBasis: 0, excludedMissingPrice: 1, currencies: [] });
}
finally {
    f.owned.close();
} });
it("archived project interval overlap retains old running and terminal boundary attempts",async()=>{
 const f=await fixture();try{const excluded=f.run(),included=f.run(),ongoing=f.run();f.emit(excluded,2,"run.succeeded",{summary:"Earlier"},start-1);f.emit(included,2,"run.succeeded",{summary:"Boundary"},start);f.usage(ongoing);expect(f.query().eligibleRuns).toBe(2);f.emit(ongoing,3,"run.succeeded",{summary:"Completed before archival"},start+200);send(f.store,{kind:"project.patch",id:f.projectId,input:{expectedVersion:1,archived:true}},start+500);const data=f.query();expect(data.eligibleRuns).toBe(2);expect(data.runDetails.map(r=>r.runId).sort()).toEqual([included,ongoing].sort());expect(data).toMatchObject({runsWithReports:1,runsWithoutReports:1});}finally{f.owned.close();}
});
it("one hundred detail rows do not truncate eligible totals and price creation preserves settings version",async()=>{
 const f=await fixture();try{for(let i=0;i<101;i++)f.run();const before=f.store.snapshot({kind:"settings"}).body.data;const input={id:randomUUID(),name:"Only local",capturedAt:from,effectiveAt:null,entries:[{source:"s",model:"m",currency:"USD",inputPrice:null,outputPrice:null}]};send(f.store,{kind:"usage.price.create",input},start,"operator");expect(f.store.snapshot({kind:"settings"}).body.data).toEqual(before);const first=f.query({limit:100});expect(first).toMatchObject({eligibleRuns:101,runsWithoutReports:101,totalRuns:101});expect(first.runDetails).toHaveLength(100);expect(f.query({limit:100,cursor:first.nextCursor!}).runDetails).toHaveLength(1);}finally{f.owned.close();}
});
import { priceSnapshotCreate,usageQuery } from "../../src/contracts/usage";
it("usage UUID references normalize while source model and usage identity remain opaque",async()=>{
 const f=await fixture();try{const id=f.run();f.usage(id,2,{usageId:"OpaqueID",source:"OpaqueSource",model:"OpaqueModel"});const quoteId=randomUUID(),input={id:quoteId.toUpperCase(),name:"Local",capturedAt:from,entries:[{source:"OpaqueSource",model:"OpaqueModel",currency:"USD",inputPrice:"1",outputPrice:"2"}]};const parsed=priceSnapshotCreate.parse(input);const original=send(f.store,{kind:"usage.price.create",input:parsed},start,"operator");expect((original.body.data as {id:string}).id).toBe(quoteId);expect(()=>send(f.store,{kind:"usage.price.create",input:priceSnapshotCreate.parse({...input,id:quoteId})},start,"operator")).toThrow("price_snapshot_conflict");const query=usageQuery.parse({projectId:f.projectId.toUpperCase(),priceSnapshotId:quoteId.toUpperCase(),from,to,source:"OpaqueSource",model:"OpaqueModel"});expect(f.store.snapshot({kind:"usage",input:query}).body.data).toMatchObject({projectId:f.projectId,filteredReportCount:1,estimate:{snapshot:{id:quoteId},includedReports:1}});expect(f.query({source:"opaquesource"}).filteredReportCount).toBe(0);}finally{f.owned.close();}
});
it("legacy uppercase projects resolve actual stored references and ambiguous aliases reject",async()=>{
 const f=await fixture();f.owned.close();const copy=await copied(f.dir),db=new Database(join(copy,"agentflow.sqlite")),upper=randomUUID().toUpperCase();
 db.prepare("INSERT INTO projects(id,name,repository_path,archived_at,version,created_at,updated_at) SELECT ?,name,repository_path,archived_at,version,created_at,updated_at FROM projects WHERE id=?").run(upper,f.projectId);db.close();let owned=await openOwnedStore(copy);
 try{const agent=(owned.store.snapshot({kind:"agents",input:{limit:1}}).body.data as {items:{id:string}[]}).items[0].id,runId=randomUUID();send(owned.store,{kind:"run.register",input:{id:runId,projectId:upper.toLowerCase(),agentId:agent,purpose:"planning"}});for(const [sequence,type,payload] of [[1,"run.started",{}],[2,"run.usage",{usageId:"LegacyUsage",source:"s",model:"m",measuredAt:from,inputTokens:4,outputTokens:6}]] as const)send(owned.store,{kind:"run.event",id:runId,input:eventInput.parse({schemaVersion:1,eventId:randomUUID(),runId,sequence,type,payload,occurredAt:from})});expect(owned.store.snapshot({kind:"usage",input:usageQuery.parse({projectId:upper.toLowerCase(),from,to})}).body.data).toMatchObject({projectId:upper,eligibleRuns:1,filteredReportCount:1,knownTotalTokens:"10"});}finally{owned.close();}
 const collision=new Database(join(copy,"agentflow.sqlite"));collision.prepare("INSERT INTO projects(id,name,repository_path,archived_at,version,created_at,updated_at) SELECT ?,name,repository_path,archived_at,version,created_at,updated_at FROM projects WHERE id=?").run(upper.toLowerCase(),upper);collision.close();owned=await openOwnedStore(copy);try{expect(()=>owned.store.snapshot({kind:"usage",input:usageQuery.parse({projectId:upper,from,to})})).toThrow("identity_ambiguous");}finally{owned.close();}
});
it("legacy uppercase prices resolve entries with stored ID and reject ambiguous aliases",async()=>{
 const f=await fixture(),run=f.run();f.usage(run);const id=randomUUID();send(f.store,{kind:"usage.price.create",input:priceSnapshotCreate.parse({id,name:"Original",capturedAt:from,entries:[{source:"reported",model:"model",currency:"USD",inputPrice:"1",outputPrice:"2"}]})},start,"operator");f.owned.close();const copy=await copied(f.dir),upper=randomUUID().toUpperCase(),db=new Database(join(copy,"agentflow.sqlite"));
 db.prepare("INSERT INTO usage_price_snapshots SELECT ?,name,captured_at,effective_at,entries,created_at FROM usage_price_snapshots WHERE id=?").run(upper,id);db.prepare("INSERT INTO usage_price_entries SELECT ?,source,model,currency,input_price,output_price FROM usage_price_entries WHERE snapshot_id=?").run(upper,id);db.close();let owned=await openOwnedStore(copy);try{const data=owned.store.snapshot({kind:"usage",input:usageQuery.parse({projectId:f.projectId,priceSnapshotId:upper.toLowerCase(),from,to})}).body.data as UsageSummary;expect(data.estimate).toMatchObject({snapshot:{id:upper},includedReports:1,currencies:[{currency:"USD",amount:"0.000017"}]});}finally{owned.close();}
 const collision=new Database(join(copy,"agentflow.sqlite"));collision.prepare("INSERT INTO usage_price_snapshots SELECT ?,name,captured_at,effective_at,entries,created_at FROM usage_price_snapshots WHERE id=?").run(upper.toLowerCase(),upper);collision.close();owned=await openOwnedStore(copy);try{expect(()=>owned.store.snapshot({kind:"usage",input:usageQuery.parse({projectId:f.projectId,priceSnapshotId:upper,from,to})})).toThrow("identity_ambiguous");}finally{owned.close();}
});
