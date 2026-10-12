"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePaged, usePageRows } from "../client/paged";
import { QueryFeedback, useWorkspace } from "../client/provider";
import { ApiError, StaleSnapshot } from "../client/api";
import { freezeCommand, type FrozenCommand } from "../client/commands";
import { projectsResponse, settingsResponse } from "../contracts/responses";
import { priceSnapshotCreate, priceSnapshotResponse, priceSnapshotsResponse, usageQuery, usageResponse, type UsageQuery, type UsageSummary } from "../contracts/usage";

type Filter = { projectId: string; from: string; to: string; source: string; model: string };
type PriceEntry = { source: string; model: string; currency: string; inputPrice: string; outputPrice: string };
const emptyEntry = (): PriceEntry => ({ source: "", model: "", currency: "USD", inputPrice: "", outputPrice: "" });
const integer = (value: string) => BigInt(value).toLocaleString("en-US");
function Totals({ value, reports }: { value: Pick<UsageSummary, "knownInputTokens" | "knownOutputTokens" | "knownTotalTokens" | "unknownInputReports" | "unknownOutputReports" | "unknownTotalReports">; reports: number }) {
  if (!reports) return <p>No matching reports. Usage is unknown.</p>;
  return <><dl className="report-facts"><dt>Known input subtotal</dt><dd>{integer(value.knownInputTokens)} tokens · {value.unknownInputReports} unknown {value.unknownInputReports === 1 ? "report" : "reports"}</dd><dt>Known output subtotal</dt><dd>{integer(value.knownOutputTokens)} tokens · {value.unknownOutputReports} unknown {value.unknownOutputReports === 1 ? "report" : "reports"}</dd><dt>Known total subtotal</dt><dd>{integer(value.knownTotalTokens)} tokens from complete reports only</dd></dl><p>{value.unknownTotalReports} {value.unknownTotalReports === 1 ? "report has" : "reports have"} unknown total tokens</p></>;
}
function PageControls({ page, label }: { page: { next?: string | null; error: string; resetNotice: string; busy: boolean; more: () => Promise<void> }; label: string }) {
  return <>{page.resetNotice && <p role="status" className="notice">{page.resetNotice}</p>}{page.error && <p role="alert" className="error">{page.error}</p>}{page.next && <button type="button" disabled={page.busy} onClick={() => void page.more()}>{page.busy ? "Loading page…" : `Load more ${label}`}</button>}</>;
}
export function Usage() {
  const projects = usePaged("/projects?limit=50", projectsResponse);
  const prices = usePaged("/usage/price-snapshots?limit=50", priceSnapshotsResponse);
  const { api, pair } = useWorkspace();
  const cache = useQueryClient();
  const [draft, setDraft] = useState<Filter>({ projectId: "", from: "", to: "", source: "", model: "" });
  const [applied, setApplied] = useState<UsageQuery | null>(null), [selected, setSelected] = useState("");
  const [filterError, setFilterError] = useState("");
  const [chosenProject, setChosenProject] = useState<{ id: string; label: string } | null>(null);
  const [chosenPrice, setChosenPrice] = useState<{ id: string; label: string } | null>(null);
  const [name, setName] = useState(""), [capturedAt, setCapturedAt] = useState(""), [effectiveAt, setEffectiveAt] = useState("");
  const [entries, setEntries] = useState<PriceEntry[]>([emptyEntry()]);
  const [pending, setPending] = useState<FrozenCommand | null>(null), [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  function inform(text: string, error = false) { setNotice({ text, error }); requestAnimationFrame(() => feedback.current?.focus()); }
  function apply() {
    const parsed = usageQuery.safeParse({ projectId: draft.projectId, from: draft.from.trim(), to: draft.to.trim(), ...(draft.source.trim() ? { source: draft.source.trim() } : {}), ...(draft.model.trim() ? { model: draft.model.trim() } : {}), ...(selected ? { priceSnapshotId: selected } : {}), limit: 50 });
    if (!parsed.success) { setFilterError("Choose a project and a positive UTC interval of at most 31 days. Both timestamps must end in Z."); return; }
    setFilterError(""); setApplied(parsed.data);
  }
  async function save(command: FrozenCommand) {
    setPending(command); setBusy(true); setNotice(null);
    try {
      priceSnapshotResponse.parse(await api.command(command)); setPending(null);
      await cache.invalidateQueries(); inform("Price snapshot saved. Select it explicitly to estimate.");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) pair();
      if (error instanceof StaleSnapshot) { await api.read("/settings", settingsResponse).catch(() => {}); inform("Workspace changed. Your frozen price request is retained. Retry explicitly to learn its recorded outcome.", true); }
      else if (!navigator.onLine) inform("Local browser is offline. Your frozen price request is retained. Reconnect and retry explicitly.", true);
      else if (error instanceof ApiError && error.status === 409) inform(`Price request conflict: ${error.message}. Your exact request is retained. Inspect the saved snapshots before retrying.`, true);
      else inform("Response uncertain. Your price draft is retained. Retry sends the same request and key.", true);
    } finally { setBusy(false); }
  }
  function prepare() {
    const parsed = priceSnapshotCreate.safeParse({ id: crypto.randomUUID(), name, capturedAt: capturedAt.trim(), effectiveAt: effectiveAt.trim() || null, entries: entries.map(entry => ({ ...entry, inputPrice: entry.inputPrice.trim() || null, outputPrice: entry.outputPrice.trim() || null })) });
    if (!parsed.success) { inform("Enter a name, captured UTC timestamp ending in Z, and 1–20 unique source/model entries. Currency must be three uppercase letters. Prices are nonnegative decimals per million tokens; leave unavailable prices blank.", true); return; }
    void save(freezeCommand("/usage/price-snapshots", "POST", parsed.data));
  }
  function changeEntry(index: number, field: keyof PriceEntry, value: string) { setEntries(old => old.map((entry, i) => i === index ? { ...entry, [field]: value } : entry)); }
  return <><h1>Reported usage</h1><p className="intro">Inspect token deltas reported by external producers. Missing reports remain unknown. Local estimates use rates you record, with no live pricing lookup.</p>
    <section className="settings-section" aria-labelledby="usage-filter-heading"><h2 id="usage-filter-heading">Choose a reporting interval</h2>
      <QueryFeedback error={projects.query.error} loading={projects.query.isPending} retry={() => void projects.query.refetch()} />
      <form onSubmit={event => { event.preventDefault(); apply(); }}>
        <label>Project<select value={draft.projectId} onChange={event => { const id = event.target.value; setDraft({ ...draft, projectId: id }); const project = projects.items.find(item => item.id === id); setChosenProject(project ? { id, label: `${project.name}${project.archivedAt ? " (archived)" : ""}` } : chosenProject?.id === id ? chosenProject : null); }} required><option value="">Choose a project</option>{chosenProject && chosenProject.id === draft.projectId && !projects.items.some(project => project.id === chosenProject.id) && <option value={chosenProject.id}>{chosenProject.label} (retained selection)</option>}{projects.items.map(project => <option key={project.id} value={project.id}>{project.name}{project.archivedAt ? " (archived)" : ""}</option>)}</select></label>
        <p className="metadata">Showing {projects.items.length} of {projects.query.data?.data.total ?? 0} projects, including archived projects.</p><p className="metadata">Retained selections are labelled separately and are not included in loaded counts.</p><PageControls page={projects} label="projects" />
        <div className="field-pair"><label>From UTC<input value={draft.from} onChange={event => setDraft({ ...draft, from: event.target.value })} placeholder="2026-10-01T00:00:00.000Z" required /></label><label>To UTC<input value={draft.to} onChange={event => setDraft({ ...draft, to: event.target.value })} placeholder="2026-10-12T00:00:00.000Z" required /></label></div>
        <p className="metadata">Enter explicit UTC timestamps ending in Z. Reports belong to the interval of their first accepted receipt, not the producer’s measurement time.</p>
        <div className="field-pair"><label>Reported source<input maxLength={200} value={draft.source} onChange={event => setDraft({ ...draft, source: event.target.value })} /></label><label>Reported model<input maxLength={200} value={draft.model} onChange={event => setDraft({ ...draft, model: event.target.value })} /></label></div>
        <p className="metadata">Optional exact labels from usage reports. Coverage always includes the project’s eligible runs.</p>
        {filterError && <p role="alert" className="error">{filterError}</p>}<button className="primary">Apply usage filters</button>
      </form>
    </section>
    <section className="settings-section" aria-labelledby="price-select-heading"><h2 id="price-select-heading">Optional local prices</h2>
      <QueryFeedback error={prices.query.error} loading={prices.query.isPending} retry={() => void prices.query.refetch()} />
      <label>Price snapshot<select value={selected} onChange={event => { const id = event.target.value; setSelected(id); const price = prices.items.find(item => item.id === id); setChosenPrice(price ? { id, label: price.name } : chosenPrice?.id === id ? chosenPrice : null); if (applied) { setApplied({ ...applied, priceSnapshotId: id || undefined }); } }}><option value="">No estimate</option>{chosenPrice && chosenPrice.id === selected && !prices.items.some(price => price.id === chosenPrice.id) && <option value={chosenPrice.id}>{chosenPrice.label} (retained selection)</option>}{prices.items.map(price => <option key={price.id} value={price.id}>{price.name}</option>)}</select></label>
      <p className="metadata">Showing {prices.items.length} of {prices.query.data?.data.total ?? 0} immutable snapshots. Selection is explicit.</p><p className="metadata">Retained selections are labelled separately and are not included in loaded counts.</p><PageControls page={prices} label="price snapshots" />
    </section>
    {applied ? <UsageResults input={applied} /> : <p>Choose a project and apply a UTC interval to inspect coverage.</p>}
    <section className="settings-section" aria-labelledby="price-create-heading"><h2 id="price-create-heading">Record a price snapshot</h2><p>Record local rates per million tokens. Blank rates mean unavailable. Snapshots cannot be edited after saving.</p>
      <form onSubmit={event => { event.preventDefault(); prepare(); }}><fieldset disabled={busy || !!pending}>
        <label>Snapshot name<input maxLength={200} value={name} onChange={event => setName(event.target.value)} required /></label>
        <div className="field-pair"><label>Captured UTC<input value={capturedAt} onChange={event => setCapturedAt(event.target.value)} required /></label><label>Effective UTC (optional)<input value={effectiveAt} onChange={event => setEffectiveAt(event.target.value)} /></label></div>
        {entries.map((entry, index) => <fieldset key={index} className="usage-price-entry"><legend>Rate entry {index + 1}</legend><div className="field-pair"><label>Price source {index + 1}<input maxLength={200} value={entry.source} onChange={event => changeEntry(index,"source",event.target.value)} required /></label><label>Price model {index + 1}<input maxLength={200} value={entry.model} onChange={event => changeEntry(index,"model",event.target.value)} required /></label></div><label>Currency {index + 1}<input maxLength={3} value={entry.currency} onChange={event => changeEntry(index,"currency",event.target.value)} required /></label><div className="field-pair"><label>Input price per million {index + 1}<input inputMode="decimal" value={entry.inputPrice} onChange={event => changeEntry(index,"inputPrice",event.target.value)} /></label><label>Output price per million {index + 1}<input inputMode="decimal" value={entry.outputPrice} onChange={event => changeEntry(index,"outputPrice",event.target.value)} /></label></div>{entries.length > 1 && <button type="button" onClick={() => setEntries(old => old.filter((_, i) => i !== index))}>Remove rate entry {index + 1}</button>}</fieldset>)}
        <div className="actions"><button type="button" disabled={entries.length >= 20} onClick={() => setEntries(old => [...old, emptyEntry()])}>Add rate entry</button><button className="primary">Save immutable price snapshot</button></div>
      </fieldset></form>
      {pending && <p className="notice">A frozen request is awaiting a known outcome. These fields are locked so retry preserves the original bytes.</p>}{pending && <button disabled={busy} onClick={() => void save(pending)}>{busy ? "Saving price snapshot…" : "Retry exact price request"}</button>}
      {notice && <p ref={feedback} tabIndex={-1} role={notice.error ? "alert" : "status"} className={notice.error ? "error" : "notice"}>{notice.text}</p>}
    </section>
  </>;
}
function UsageResults({ input }: { input: UsageQuery }) {
  const parameters = new URLSearchParams(); for (const [key,value] of Object.entries(input)) if (value !== undefined) parameters.set(key,String(value)); parameters.sort();
  const page = usePageRows(`/usage?${parameters}`, usageResponse, value => ({ items: value.data.runDetails, total: value.data.totalRuns, nextCursor: value.data.nextCursor }), run => run.runId);
  const value = page.query.data?.data;
  return <><QueryFeedback error={page.query.error} loading={page.query.isPending} retry={() => void page.query.refetch()} />{value && <>
    <section aria-labelledby="coverage-heading"><h2 id="coverage-heading">Reporting coverage</h2><p>{value.runsWithReports} of {value.eligibleRuns} eligible runs reported usage</p><p>{value.runsWithoutReports} {value.runsWithoutReports === 1 ? "run" : "runs"} without reports. Usage is unknown.</p><p className="metadata break-word">First receipt UTC interval [{value.from}, {value.to}). Applied source {value.source ?? "All reported sources"} · model {value.model ?? "All reported models"}. {value.filteredRunsWithReports} runs with matching reports.</p>
      <div data-testid="usage-totals"><h3>Known token subtotals</h3>{value.filteredReportCount ? <Totals value={value} reports={value.filteredReportCount} /> : <p>No reports match these filters. Usage is unknown.</p>}</div>
    </section>

    {value.estimate && <section aria-labelledby="estimate-heading"><h2 id="estimate-heading">Local estimate</h2><p>Estimate only. This is not a bill.</p><p className="break-word">Snapshot {value.estimate.snapshot.name} · captured UTC {value.estimate.snapshot.capturedAt} · effective UTC {value.estimate.snapshot.effectiveAt ?? "Not supplied"}</p><p>{value.estimate.includedReports} included {value.estimate.includedReports === 1 ? "report" : "reports"} · {value.estimate.excludedUnknownCounts} unknown counts · {value.estimate.excludedUnsupportedBasis} unsupported billing basis · {value.estimate.excludedMissingPrice} missing or partial price</p>{value.estimate.currencies.map(currency => <p key={currency.currency}>{currency.currency} {currency.amount}</p>)}{!value.estimate.currencies.length && <p>No reports can be estimated with the selected snapshot.</p>}<p className="metadata">Only reports explicitly declaring input/output-only billing and complete counts are included. Cache or tier billing is unrepresented. Each currency stays separate; no conversion is performed.</p><details><summary>Snapshot rates and estimate scope</summary><p className="break-word">Project {value.projectId} · UTC {value.from} to {value.to} · source {value.source ?? "All"} · model {value.model ?? "All"}</p><ul>{value.estimate.snapshot.entries.map(entry => <li key={JSON.stringify([entry.source,entry.model])} className="break-word">Reported source {entry.source} · model {entry.model} · {entry.currency} per million tokens · input {entry.inputPrice ?? "Unavailable"} · output {entry.outputPrice ?? "Unavailable"}</li>)}</ul></details></section>}
    <section aria-labelledby="groups-heading"><h2 id="groups-heading">Reported source and model</h2><p>Showing {value.groups.length} of {value.totalGroups} groups.{value.groupsTruncated ? " Groups are capped at 100; overall subtotals include every matching report." : ""}</p><ul className="tracking-list">{value.groups.map(group => <li key={JSON.stringify([group.source,group.model])}><h3 className="break-word">{group.source} · {group.model}</h3><p>{group.reportCount} reported deltas</p><Totals value={group} reports={group.reportCount} /></li>)}</ul></section>

    <section aria-labelledby="runs-heading"><h2 id="runs-heading">Eligible run details</h2><p>Showing {page.items.length} of {value.totalRuns} eligible runs</p><ul className="tracking-list">{page.items.map(run => <li key={run.runId}><h3><Link href={`/runs/${run.runId}`}>{run.purpose} · {run.runId}</Link></h3><p>{run.reworkRound === null ? "Rework round not reported" : `Rework round ${run.reworkRound}`} · {run.matchingReportCount} matching reports</p><Totals value={run} reports={run.matchingReportCount} />{run.firstReceivedAt && <p className="metadata break-word">First receipt UTC: {run.firstReceivedAt} to {run.lastReceivedAt}<br />Producer measurement UTC: {run.firstMeasuredAt} to {run.lastMeasuredAt}</p>}</li>)}</ul><PageControls page={page} label="eligible runs" /></section>
  </>}</>;
}
