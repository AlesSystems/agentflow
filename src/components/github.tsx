"use client";
import { useState } from "react";
import type { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { useRead, useWorkspace, QueryFeedback } from "../client/provider";
import { ApiError } from "../client/api";
import { freezeCommand, type FrozenCommand } from "../client/commands";
import { githubResponse, githubRepositoriesInput, githubRefreshInput, pullRequestIdentity, type GithubError, type githubPullRequest } from "../contracts/github";

const errors: Record<GithubError, string> = {
  credential_unavailable: "Local credential unavailable. Complete local read-only setup, then fetch again.",
  credential_repair: "Local credential needs repair. Check the local credential file before fetching again.",
  offline: "GitHub could not be reached. Prior observations are retained.",
  timeout: "GitHub request timed out. Prior observations are retained.",
  invalid_payload: "GitHub returned unsupported metadata. Prior observations are retained.",
  response_too_large: "GitHub response exceeded the limit. Prior observations are retained.",
  redirect_rejected: "GitHub redirected this repository. Review the selected repository before fetching again.",
  authentication: "GitHub rejected authentication. Repair the local read-only credential, then fetch again.",
  forbidden: "GitHub denied access. Check the selected repository and read-only permissions.",
  inaccessible: "This PR is unavailable to the connection. This does not establish deletion.",
  rate_limited: "GitHub rate limited this connection. Wait until the retry time before fetching again.",
  upstream: "GitHub is unavailable. Prior observations are retained.",
  interrupted: "The GitHub observation was interrupted. Prior observations are retained.",
};
const time = (value: string | null) => value ? new Date(value).toLocaleString() : "Not yet";
type Selection = { enabled: boolean; repositories: string; version: number };
type Pending = { command: FrozenCommand; kind: "selection" | "refresh"; state: "sending" | "retry" };

export function GithubSettings() {
  const query = useRead("/connections/github", githubResponse);
  const { api, pair, connection: browserConnection } = useWorkspace();
  const cache = useQueryClient();
  const [draft, setDraft] = useState<Selection | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState("");
  const [repository, setRepository] = useState("");
  const [mode, setMode] = useState("page");
  const [target, setTarget] = useState("1");
  const data = query.data?.data;
  const saved = data?.connection;
  const sending = pending?.state === "sending";
  const locked = !!pending;
  const selection = draft ?? { enabled: saved?.enabled ?? false, repositories: saved?.repositories.join("\n") ?? "", version: saved?.version ?? 1 };
  const selected = repository || saved?.repositories[0] || "";
  async function send(command: FrozenCommand, kind: Pending["kind"]) {
    setPending({ command, kind, state: "sending" });
    try {
      await api.command(command);
      if (kind === "selection") setDraft(null);
      setPending(null);
      setMessage(kind === "selection" ? "GitHub selection saved." : "Observation request recorded. The local cache below shows the latest result.");
      await cache.invalidateQueries();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) pair();
      setPending({ command, kind, state: "retry" });
      setMessage(error instanceof ApiError
        ? error.code === "github_busy" ? "Another GitHub request is busy. This key was not consumed. Retry the exact request when it finishes."
          : error.status === 409 ? "GitHub configuration changed or this request conflicts. Your intent is retained. Refresh locally and prepare a new request before submitting it."
          : `Could not submit GitHub request (${error.code.replaceAll("_", " ")}). Your intent is retained.`
        : "Response is uncertain. Retry uses the same request and key. Your intent is retained.");
    }
  }
  async function prepare() {
    const fresh = await query.refetch();
    if (!fresh.data || fresh.error) { setMessage("Could not refresh locally. The pending request and draft are retained."); return; }
    if (draft) setDraft({ ...draft, version: fresh.data.data.connection.version });
    setPending(null);
    setMessage(`Prepared against current GitHub version ${fresh.data.data.connection.version}. Review your retained intent, then submit deliberately.`);
  }
  return <section className="settings-section github-settings">
    <h2>GitHub PR observations</h2>
    <p>Read-only metadata for repositories you select. Only “Fetch GitHub metadata” contacts GitHub. Opening views and refreshing locally read the saved cache.</p>
    <QueryFeedback error={query.error} loading={query.isPending} retry={() => void query.refetch()} />
    {query.fetchStatus === "paused" && <p role="status">Local browser is offline. Cached GitHub observations are retained.</p>}
    {saved && <>
      <p className="metadata">{saved.enabled ? "Observations enabled" : "Disconnected · retained cache is stale"} · GitHub version {saved.version}</p>
      <p>{saved.lastError === "credential_repair" || saved.credential === "repair" ? errors.credential_repair : saved.credential === "configured" ? "Local credential configured. Token health is not verified by configuration." : errors.credential_unavailable}</p>
      <details><summary>Local read-only credential setup</summary><p>Use a fine-grained GitHub token limited to the repositories you select, with Pull requests read permission. Store it in a user-only JSON credential file outside the checkout, owned by your account with mode 0600. Configure AGENTFLOW_GITHUB_TOKEN_FILE in the local launch environment and restart AgentFlow. Follow the local setup instructions. Do not paste credentials into this browser or a shell command.</p></details>
      <form onSubmit={event => {
        event.preventDefault();
        const parsed = githubRepositoriesInput.safeParse({ expectedVersion: selection.version, enabled: selection.enabled, repositories: selection.repositories.split(/\r?\n/).map(value => value.trim()).filter(Boolean) });
        if (!parsed.success) { setMessage("Enter at most 10 distinct owner/repository names, one per line."); return; }
        void send(freezeCommand("/connections/github/repositories", "PUT", parsed.data), "selection");
      }}>
        <label className="checkbox-label"><input type="checkbox" checked={selection.enabled} disabled={locked} onChange={event => setDraft({ ...selection, enabled: event.target.checked })} />Enable read-only GitHub observations</label>
        <label>Selected repositories<textarea aria-label="Selected repositories" rows={3} disabled={locked} value={selection.repositories} onChange={event => setDraft({ ...selection, repositories: event.target.value })} aria-describedby="github-repositories-help" /></label>
        <p id="github-repositories-help" className="metadata">One owner/repository per line, maximum 10. Saving replaces the entire selection.</p>
        <div className="actions"><button className="primary" disabled={locked}>Save GitHub selection</button><button type="button" disabled={locked || !saved.enabled} onClick={() => void send(freezeCommand("/connections/github/repositories", "PUT", { expectedVersion: saved.version, enabled: false, repositories: saved.repositories }), "selection")}>Disconnect GitHub</button></div>
      </form>
      <p className="metadata break-word">Current saved repositories: {saved.repositories.join(", ") || "None"}</p>
      <form onSubmit={event => {
        event.preventDefault();
        const parsed = githubRefreshInput.safeParse({ expectedVersion: saved.version, repository: selected, [mode]: Number(target) });
        if (!parsed.success) { setMessage("Choose one saved repository and a page from 1 to 1000 or a positive PR number."); return; }
        setRepository(selected);
        void send(freezeCommand("/connections/github/refresh", "POST", parsed.data), "refresh");
      }}>
        <label>Repository to observe<select aria-label="Repository to observe" value={selected} disabled={locked || !saved.enabled} onChange={event => setRepository(event.target.value)}>{!saved.repositories.length && <option value="">No repositories selected</option>}{repository && !saved.repositories.includes(repository) && <option value={repository}>{repository} (no longer selected)</option>}{saved.repositories.map(value => <option key={value}>{value}</option>)}</select></label>
        <div className="paired-fields"><label>Fetch target<select aria-label="Fetch target" value={mode} disabled={locked} onChange={event => { setMode(event.target.value); setTarget("1"); }}><option value="page">List page (20 PRs)</option><option value="number">Exact PR number</option></select></label><label>{mode === "page" ? "List page" : "PR number"}<input aria-label={mode === "page" ? "List page" : "PR number"} type="number" min="1" max={mode === "page" ? 1000 : Number.MAX_SAFE_INTEGER} required value={target} disabled={locked} onChange={event => setTarget(event.target.value)} /></label></div>
        <button className="primary" disabled={locked || !saved.enabled || !saved.repositories.includes(selected) || saved.busy || !!draft}>Fetch GitHub metadata</button>
        {!!draft && <p className="metadata">Save the repository selection before fetching metadata.</p>}
      </form>
      {saved.busy && <p role="status">GitHub observation in progress.</p>}
      {saved.retryNotBefore && <p>GitHub retry not before {time(saved.retryNotBefore)}.</p>}
      {saved.lastError && <p role="status">{errors[saved.lastError]}</p>}
      <p className="metadata">GitHub last fetched: {time(saved.lastFetchedAt)} · Last attempted: {time(saved.lastAttemptedAt)}</p>
      {browserConnection.state !== "connected" && <p className="notice">Local browser updates are {browserConnection.state}. Cached GitHub observations remain last-known data; this does not describe GitHub connectivity.</p>}
      <p role="status">{sending ? "Submitting GitHub request…" : message}</p>
      <div className="actions">{pending?.state === "retry" && <button onClick={() => void send(pending.command, pending.kind)}>Retry exact GitHub request</button>}<button disabled={sending} onClick={() => void prepare()}>{pending ? "Refresh locally and prepare new request" : "Refresh local GitHub cache"}</button></div>
      <h3>Saved observations</h3>
      {data.items.length ? data.items.map(item => <GithubObservation key={`${item.repository}/${item.number}`} item={item} enabled={saved.enabled} localRetained={!!query.error || query.fetchStatus === "paused" || browserConnection.state !== "connected"} />) : <p>No cached PR metadata. Select a repository and fetch a page or PR number.</p>}
      {data.nextCursor && <p className="metadata">Showing the first {data.items.length} of {data.total} cached observations. Open a linked task for an exact local lookup.</p>}
    </>}
  </section>;
}
function GithubObservation({ item, enabled, localRetained }: { item: z.infer<typeof githubPullRequest>; enabled: boolean; localRetained: boolean }) {
  return <article className="github-observation">
    <h3>{item.title}</h3>
    <p className="break-word">{item.repository} #{item.number} · {item.state} · {item.draft ? "Draft" : "Not draft"} · Source: GitHub REST</p>
    <p className="metadata">{!enabled ? "Disconnected · stale observation" : localRetained ? "Retained last-known observation · local browser unavailable" : item.stale ? "Stale observation" : "Cached observation"}</p>
    {item.headChanged && <p className="notice">Observed PR head changed. Prior PR-head observations and head-linked external evidence are stale. Local task acceptance and opaque artifact references are unchanged.</p>}
    {item.lastError && <p>{errors[item.lastError]}</p>}
    <dl className="report-facts"><dt>Head SHA</dt><dd>{item.headSha}</dd>{item.previousHeadSha && <><dt>Previous head</dt><dd>{item.previousHeadSha}</dd></>}<dt>Base branch</dt><dd>{item.baseBranch}</dd><dt>Merged</dt><dd>{item.mergedAt ? time(item.mergedAt) : "Not observed as merged"}</dd><dt>Fetched</dt><dd>{time(item.fetchedAt)}</dd><dt>Last attempted</dt><dd>{time(item.lastAttemptedAt)}</dd></dl>
  </article>;
}
export function TaskGithub({ url }: { url: string }) {
  const identity = pullRequestIdentity(url);
  return <section className="task-github"><h2 className="task-section-heading">Pull request observation</h2>{identity ? <TaskGithubLookup repository={identity.repository} number={identity.number} /> : <p>This URL is unsupported for GitHub observation. No metadata is fetched.</p>}</section>;
}
function TaskGithubLookup({ repository, number }: { repository: string; number: number }) {
  const query = useRead(`/connections/github?repository=${encodeURIComponent(repository)}&number=${number}`, githubResponse);
  const { connection } = useWorkspace();
  const data = query.data?.data;
  return <>
    <QueryFeedback error={query.error} loading={query.isPending} retry={() => void query.refetch()} />
    {query.fetchStatus === "paused" && <p role="status">Local browser is offline. Cached GitHub observations are retained.</p>}
    <button onClick={() => void query.refetch()}>Refresh local PR observation</button>
    {data && (!data.connection.repositories.includes(repository) ? <p>This repository is not selected. This link is inert for observation. Select it explicitly in Settings to observe metadata.</p> : <>
      {data.items[0] ? <GithubObservation item={data.items[0]} enabled={data.connection.enabled} localRetained={!!query.error || query.fetchStatus === "paused" || connection.state !== "connected"} /> : <p>No cached observation for {repository} #{number}. Use Settings to fetch this PR number explicitly.</p>}
      {data.lookupAttempt?.error && <p>{errors[data.lookupAttempt.error]} Last attempted: {time(data.lookupAttempt.attemptedAt)}.</p>}
      <p className="metadata">This local lookup never contacts GitHub and never changes task acceptance.</p>
    </>)}
  </>;
}
