"use client";
import Link from "next/link";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRead, useWorkspace, QueryFeedback } from "../client/provider";
import { usePaged } from "../client/paged";
import { freezeCommand, type FrozenCommand } from "../client/commands";
import { ApiError } from "../client/api";
import { trackingAgentsResponse, trackingRunsResponse, trackingRunResponse, activityResponse, type RunSummary } from "../contracts/tracking";
import { agentResponse, eventsResponse, closeInput } from "../contracts/observations";
export function ReportingLabel({ run }: { run: Pick<RunSummary, "state" | "freshness"> }) {
  const reporting = run.freshness.reporting;
  return <span className={`report-label ${reporting === "stale" ? "report-stale" : ""}`}>{run.state} · {reporting === "no_report_received" ? "No report received" : reporting === "fresh" ? "Fresh report" : reporting === "stale" ? "Stale report · execution uncertain" : "Terminal record"}</span>;
}
export function LongText({ text }: { text: string }) {
  return text.length > 320 ? <details className="long-report"><summary>{text.slice(0, 160)}… <span>Read full message</span></summary><p className="preserve-lines">{text}</p></details> : <p className="preserve-lines">{text}</p>;
}
function Pagination({ page, label }: { page: { next?: string | null; error: string; busy: boolean; more: () => Promise<void> }; label: string }) {
  return <>{page.error && <p role="alert">{page.error}</p>}{page.next && <button disabled={page.busy} onClick={() => void page.more()}>{page.busy ? "Loading page…" : `Load more ${label}`}</button>}</>;
}
export function Agents() {
  const page = usePaged("/tracking/agents?limit=50", trackingAgentsResponse);
  const [filter, setFilter] = useState("all");
  const items = page.items.filter(agent => filter === "all" || (filter === "stale" ? agent.staleActive > 0 : filter === "queued" ? agent.queuedNoReport > 0 : agent.freshRunning > 0));
  return <><h1>Agents</h1><p className="intro">Registered identities and the reports they send. Execution stays with your external harness.</p>
    <label className="tracking-filter">Show loaded identities<select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All identities</option><option value="fresh">Fresh running reports</option><option value="queued">Queued without a report</option><option value="stale">Stale active reports</option></select></label>
    <QueryFeedback error={page.query.error} loading={page.query.isPending} retry={() => void page.query.refetch()} />
    <ul className="tracking-list">{items.map(agent => <li key={agent.id}><h2><Link href={`/agents/${agent.id}`}>{agent.displayName}</Link></h2><p className="metadata break-word">Source {agent.source} · Default role {agent.defaultRole}</p><p>{agent.freshRunning} fresh running · {agent.queuedNoReport} queued, no report · {agent.staleActive} stale active</p></li>)}</ul>
    {!page.query.isPending && !items.length && <p>No matching registered identities. Agents appear when an external producer registers them.</p>}
    <Pagination page={page} label="agents" /></>;
}
export function AgentDetail({ id }: { id: string }) {
  const query = useRead(`/agents/${id}`, agentResponse);
  const [state, setState] = useState("all");
  return <><Link href="/agents">Back to agents</Link><h1>{query.data?.data.displayName ?? "Agent reports"}</h1><QueryFeedback error={query.error} loading={query.isPending} retry={() => void query.refetch()} />
    {query.data && <p className="intro break-word">Source {query.data.data.source} · Default role {query.data.data.defaultRole}</p>}
    <label className="tracking-filter">Reported attempt history<select value={state} onChange={e => setState(e.target.value)}><option value="all">All attempts</option><option value="queued">Queued</option><option value="running">Running reports</option><option value="stale">Stale active reports</option><option value="succeeded">Succeeded</option><option value="failed">Failed</option><option value="interrupted">Interrupted</option><option value="cancelled">Cancelled</option></select></label>
    <Attempts filters={`agentId=${query.data?.data.id ?? id}${state === "all" ? "" : state === "stale" ? "&stale=true" : `&state=${state}`}`} /></>;
}
export function Attempts({ filters, inline = false }: { filters: string; inline?: boolean }) {
  const page = usePaged(`/tracking/runs?limit=20&${filters}`, trackingRunsResponse);
  const [selected, setSelected] = useState<string | null>(null);
  return <section className="attempts"><h2>Reported attempts <span className="count">{page.query.data?.data.total ?? ""}</span></h2>
    <QueryFeedback error={page.query.error} loading={page.query.isPending} retry={() => void page.query.refetch()} />
    <ul className="tracking-list">{page.items.map(run => <li key={run.id}><h3>{inline ? <button className="attempt-title" onClick={() => setSelected(selected === run.id ? null : run.id)} aria-expanded={selected === run.id}>{run.purpose} · {run.agentName}</button> : <Link href={`/runs/${run.id}`}>{run.purpose} · {run.agentName}</Link>}</h3><ReportingLabel run={run} /><p className="metadata">Model {run.model ?? "Not reported"} · Received <time dateTime={run.lastReceivedAt}>{new Date(run.lastReceivedAt).toLocaleString()}</time></p>{run.message && <LongText text={run.message} />}{run.taskId && !inline && <Link href={`/projects/${run.projectId}/tasks/${run.taskId}`}>{run.taskTitle ?? "Open task"}</Link>}{inline && selected === run.id && <RunDetail id={run.id} embedded />}</li>)}</ul>
    {page.query.data && !page.items.length && <p>No attempts are registered for these filters.</p>}<Pagination page={page} label="attempts" /></section>;
}
export function RunDetail({ id, embedded = false }: { id: string; embedded?: boolean }) {
  const query = useRead(`/tracking/runs/${id}`, trackingRunResponse);
  const run = query.data?.data;
  const raw = usePaged(`/runs/${run?.id ?? id}/events?limit=20`, eventsResponse);
  const cache = useQueryClient();
  const { api, pair } = useWorkspace();
  const [reason, setReason] = useState(""), [request, setRequest] = useState<FrozenCommand | null>(null), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [closing, setClosing] = useState(false);
  const eligible = !!run?.freshness.stale && ["queued", "running"].includes(run.state);
  async function close(command: FrozenCommand) {
    setRequest(command); setBusy(true); setNotice("");
    try { await api.command(command); await cache.invalidateQueries(); setReason(""); setRequest(null); setClosing(false); setNotice("Tracking record closed. No process signal was sent."); }
    catch (error) { if (error instanceof ApiError && error.status === 401) pair(); setNotice(error instanceof ApiError ? `Could not close tracking: ${error.message}. Your reason is retained.` : "Response uncertain. Retry sends the same request and key."); void query.refetch(); }
    finally { setBusy(false); }
  }
  return <section className="run-detail" aria-label="Attempt detail">{!embedded && <><Link href="/agents">Back to agents</Link><h1>Reported attempt</h1></>}
    <QueryFeedback error={query.error} loading={query.isPending} retry={() => void query.refetch()} />
    {run && <><h3>{run.purpose} · <Link href={`/agents/${run.agentId}`}>{run.agentName}</Link></h3><ReportingLabel run={run} /><dl className="report-facts"><dt>Source</dt><dd>{run.agentSource}</dd><dt>Model</dt><dd>{run.model ?? "Not reported"}</dd><dt>Project</dt><dd><Link href={`/projects/${run.projectId}`}>{run.projectName}</Link></dd><dt>Task</dt><dd>{run.taskId ? <Link href={`/projects/${run.projectId}/tasks/${run.taskId}`}>{run.taskTitle ?? run.taskId}</Link> : "Project planning attempt"}</dd><dt>Last received</dt><dd><time dateTime={run.lastReceivedAt}>{new Date(run.lastReceivedAt).toLocaleString()}</time></dd><dt>Sequence</dt><dd>{run.lastSequence}</dd></dl>
      {run.message && <LongText text={run.message} />}{run.evidenceUrl && <p><a href={run.evidenceUrl} target="_blank" rel="noopener noreferrer">Open reported evidence</a></p>}
      {(eligible || closing || request) && <section className="close-tracking"><button disabled={!eligible && !closing} onClick={() => setClosing(true)}>Close stale tracking</button>{closing && <form onSubmit={e => { e.preventDefault(); const input = closeInput.safeParse({ expectedVersion: run.version, reason }); if (!input.success) { setNotice("Enter a reason to close this tracking record."); return; } void close(freezeCommand(`/runs/${run.id}/close`, "POST", input.data)); }}><p className="notice">The external process may still be running. This closes the tracking record only.</p><label>Reason<textarea required maxLength={4000} value={reason} onChange={e => { setReason(e.target.value); setRequest(null); }} disabled={busy} /></label><button className="primary" disabled={busy || !eligible}>Confirm tracking closure</button><button type="button" disabled={busy} onClick={() => setClosing(false)}>Keep tracking</button></form>}{request && <button disabled={busy} onClick={() => void close(request)}>Retry exact closure</button>}</section>}
      {notice && <p role="status">{notice}</p>}
      <h3>Raw reported events</h3><p className="metadata">Stored sequence order includes heartbeats. Occurred time comes from the producer; received time comes from AgentFlow.</p>
      <QueryFeedback error={raw.query.error} loading={raw.query.isPending} retry={() => void raw.query.refetch()} />
      <ol className="event-history">{raw.items.map(event => <li key={event.eventId}><h4>{event.sequence} · {event.type}</h4><p className="metadata">Occurred <time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString()}</time><br />Received <time dateTime={event.receivedAt}>{new Date(event.receivedAt).toLocaleString()}</time></p>{"message" in event.payload && <LongText text={event.payload.message} />}{"summary" in event.payload && <LongText text={event.payload.summary} />}{"reason" in event.payload && <LongText text={event.payload.reason} />}{"evidenceUrl" in event.payload && event.payload.evidenceUrl && <a href={event.payload.evidenceUrl} target="_blank" rel="noopener noreferrer">Open reported evidence</a>}</li>)}</ol>{raw.query.data && !raw.items.length && <p>No producer report has been received. Registration is a queued tracking record.</p>}<Pagination page={raw} label="events" /></>}
  </section>;
}
export function Activity({ initialFilters = "" }: { initialFilters?: string }) {
  const [filters, setFilters] = useState(initialFilters);
  const page = usePaged(`/activity?limit=30${filters ? "&" + filters : ""}`, activityResponse);
  const values = new URLSearchParams(filters);
  return <><h1>Activity</h1><p className="intro">Stored progress, outcomes and human tracking closures. Heartbeat noise stays in raw attempt history.</p>
    <form className="filters" onSubmit={e => { e.preventDefault(); const next = new URLSearchParams(); for (const [key, value] of new FormData(e.currentTarget)) if (String(value).trim()) next.set(key, String(value).trim()); next.sort(); setFilters(next.toString()); window.history.replaceState({}, "", `/activity${next.size ? "?" + next : ""}`); }}>{["projectId", "agentId", "taskId"].map(key => <label key={key}>{key === "projectId" ? "Project UUID" : key === "agentId" ? "Agent UUID" : "Task UUID"}<input name={key} defaultValue={values.get(key) ?? ""} /></label>)}<button>Apply filters</button></form>
    <QueryFeedback error={page.query.error} loading={page.query.isPending} retry={() => void page.query.refetch()} />
    <ol className="tracking-list activity-list">{page.items.map(item => <li key={item.id}><h2><Link href={`/runs/${item.runId}`}>{item.kind === "tracking_closed" ? "Human closed tracking" : item.event!.type.replace("run.", "Reported ")}</Link></h2><p><Link href={`/agents/${item.agentId}`}>{item.agentName}</Link> · {item.purpose}</p><p className="metadata break-word">Source {item.agentSource} · Model {item.model ?? "Not reported"}</p><p className="metadata">Received <time dateTime={item.receivedAt}>{new Date(item.receivedAt).toLocaleString()}</time>{item.occurredAt && <><br />Reported occurrence <time dateTime={item.occurredAt}>{new Date(item.occurredAt).toLocaleString()}</time></>}</p>{item.reason && <><p>Tracking fact. The external process may still be running.</p><LongText text={item.reason} /></>}{item.event && <>{"message" in item.event.payload && <LongText text={item.event.payload.message} />}{"summary" in item.event.payload && <LongText text={item.event.payload.summary} />}{"reason" in item.event.payload && <LongText text={item.event.payload.reason} />}{"evidenceUrl" in item.event.payload && item.event.payload.evidenceUrl && <p><a href={item.event.payload.evidenceUrl} target="_blank" rel="noopener noreferrer">Open reported evidence</a></p>}</>}<p>{item.taskId ? <Link href={`/projects/${item.projectId}/tasks/${item.taskId}`}>{item.taskTitle ?? "Open task"}</Link> : <Link href={`/projects/${item.projectId}`}>{item.projectName}</Link>}</p></li>)}</ol>
    {page.query.data && !page.items.length && <p>No stored activity matches these filters. Reports appear when an external producer sends them.</p>}<Pagination page={page} label="activity" /></>;
}
