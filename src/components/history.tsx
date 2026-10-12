"use client";
import { useCallback, useRef, useState } from "react";
import type { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { useWorkspace } from "../client/provider";
import { ApiError, StaleSnapshot } from "../client/api";
import { freezeCommand, type FrozenCommand } from "../client/commands";
import { historyContent, historyManifest, historyComplete, historyRecord, retentionPreviewInput, retentionPreviewResponse, retentionPruneResponse, type HistoryContent } from "../contracts/history";
import { settingsResponse } from "../contracts/responses";

const groups: Record<HistoryContent, string> = { tasks: "Tasks and protected facts", attempts: "Attempts and raw reports", workflows: "Workflow history", github: "Private GitHub observations" };
type Preview = z.infer<typeof retentionPreviewResponse>["data"];
type Retention = { kind: "idle" } | { kind: "preview"; data: Preview } | { kind: "pending"; command: FrozenCommand; retryable: boolean };

export function HistorySettings() {
  const { api, generation, pair } = useWorkspace();
  const cache = useQueryClient();
  const [content, setContent] = useState<HistoryContent[]>([]);
  const [cutoff, setCutoff] = useState("");
  const [retention, setRetention] = useState<Retention>({ kind: "idle" });
  const [busy, setBusy] = useState<"export" | "preview" | "prune" | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  const previewButton = useRef<HTMLButtonElement>(null);
  const previewElement = useRef<HTMLDivElement | null>(null);
  const retainPreviewFocus = useCallback((element: HTMLDivElement | null) => {
    if (!element && previewElement.current?.contains(document.activeElement)) previewButton.current?.focus();
    previewElement.current = element;
  }, []);
  const preview = retention.kind === "preview" && retention.data.expectedGeneration === generation && retention.data.cutoff === cutoff ? retention.data : null;
  function inform(text: string, error = false) {
    setNotice({ text, error });
    requestAnimationFrame(() => feedback.current?.focus());
  }
  function failure(error: unknown, operation: "preview history" | "prune history" | "export history") {
    if (error instanceof ApiError && error.status === 401) pair();
    if (!navigator.onLine) return "Local browser is offline. Your cutoff and content selection are retained.";
    if (error instanceof StaleSnapshot) {
      if (operation === "export history") return "Workspace changed. Download again using the current workspace. Your content selection is retained.";
      return operation === "prune history" ? "Workspace changed. Your drafts are retained. Retry the exact prune request to learn its recorded outcome." : "Workspace changed. Prepare another preview. Your cutoff is retained.";
    }
    if (error instanceof ApiError) {
      if (error.code === "preview_expired" || error.code === "preview_changed") return "Preview expired or history changed. Prepare another preview before confirming.";
      if (error.code === "preview_limit") return "Too many prepared previews. Wait for earlier previews to expire, then prepare another preview. Your cutoff is retained.";
      if (error.status === 401 || error.status === 403) return "Pair this browser with operator authority to continue. Your drafts are retained.";
      if (error.status === 503 || error.code.includes("busy")) {
        if (operation === "export history") return "Local storage is busy or unavailable. Retry the selected download. Your content selection is retained.";
        return operation === "prune history" ? "Local storage is busy or the safety backup is unavailable. Check local storage, then retry the exact request. Your drafts are retained." : "Local storage is busy or unavailable. Prepare another preview when storage is available. Your cutoff is retained.";
      }
      return `Could not ${operation}: ${error.message}. Your drafts are retained.`;
    }
    if (operation === "export history") return "Export did not complete. No complete history file was downloaded. Retry the download.";
    return operation === "prune history" ? "Response is uncertain. Retry the exact prune request with its original key and body, or explicitly prepare another preview." : "Preview response is uncertain. Prepare another preview. Your cutoff is retained.";
  }
  async function prepare() {
    const input = retentionPreviewInput.safeParse({ cutoff });
    if (!input.success || Date.parse(cutoff) > Date.now()) {
      inform("Enter a past UTC cutoff ending in Z, such as 2026-01-01T00:00:00.000Z.", true); return;
    }
    setRetention({ kind: "idle" }); setBusy("preview"); setNotice(null);
    try {
      const result = retentionPreviewResponse.parse(await api.command(freezeCommand("/retention/preview", "POST", input.data)));
      setRetention({ kind: "preview", data: result.data });
      inform("Preview ready. Review the counts before confirming.");
    } catch (error) { inform(error instanceof StaleSnapshot ? "Workspace changed. Prepare another preview. Your cutoff is retained." : failure(error, "preview history"), true); }
    finally { setBusy(null); }
  }
  async function prune(command: FrozenCommand) {
    setRetention({ kind: "pending", command, retryable: true }); setBusy("prune"); setNotice(null);
    try {
      const result = retentionPruneResponse.parse(await api.command(command));
      await cache.invalidateQueries(); setRetention({ kind: "idle" });
      inform(`Prune recorded: ${result.data.applied.eventPayloads} event payloads and ${result.data.applied.changes} replay changes removed. Display bodies reduced by ${result.data.displayBodyBytesRemoved.toLocaleString()} bytes; this does not measure reclaimed disk blocks.`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.code !== "retention_busy") setRetention({ kind: "pending", command, retryable: false });
      inform(failure(error, "prune history"), true);
    } finally { setBusy(null); }
  }
  async function download() {
    setBusy("export"); setNotice(null);
    try {
      const response = await fetch(`/api/v1/export?${new URLSearchParams({ content: content.join(","), generation })}`, { cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        if (response.headers.get("AgentFlow-Generation") && response.headers.get("AgentFlow-Generation") !== generation) await api.read("/settings", settingsResponse);
        throw new ApiError(response.status, body?.error?.code ?? "export_unavailable");
      }
      const text = await response.text(), lines = text.trimEnd().split("\n");
      const manifest = historyManifest.parse(JSON.parse(lines[0]));
      const complete = historyComplete.parse(JSON.parse(lines.at(-1)!));
      if (manifest.generation !== generation || JSON.stringify(manifest.content) !== JSON.stringify(content) || JSON.stringify(manifest.counts) !== JSON.stringify(complete.counts)) throw new Error("incomplete export");
      const counts: Record<string, number> = Object.fromEntries(Object.keys(manifest.counts).map(kind => [kind, 0]));
      for (const line of lines.slice(1, -1)) {
        const record = historyRecord.parse(JSON.parse(line));
        if (!Object.hasOwn(counts, record.kind)) throw new Error("unselected export content");
        counts[record.kind]++;
      }
      if (JSON.stringify(counts) !== JSON.stringify(manifest.counts)) throw new Error("incomplete export counts");
      const url = URL.createObjectURL(new Blob([text], { type: "application/x-ndjson" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = "agentflow-history.jsonl"; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      inform("Complete selected history downloaded. Keep this private if it includes GitHub observations or user-authored text.");
    } catch (error) { inform(error instanceof StaleSnapshot ? "Workspace changed. Download again using the current workspace. Your content selection is retained." : error instanceof ApiError ? failure(error, "export history") : !navigator.onLine ? "Local browser is offline. Your content selection is retained." : "Export did not complete. No complete history file was downloaded. Retry the download.", true); }
    finally { setBusy(null); }
  }
  return <div className="history-settings">
    <section className="settings-section" aria-labelledby="history-export-heading">
      <h2 id="history-export-heading">Export history</h2>
      <p>Choose the content to download from the current workspace. Private GitHub observations are included only when selected.</p>
      <fieldset disabled={busy !== null}><legend>Include in download</legend>{historyContent.options.map(group => <label className="checkbox-label" key={group}><input type="checkbox" checked={content.includes(group)} onChange={event => setContent(historyContent.options.filter(value => value === group ? event.target.checked : content.includes(value)))} />{groups[group]}</label>)}</fieldset>
      <p className="metadata">Selected: {content.length ? content.map(group => groups[group]).join(", ") : "None"}. Excluded: {historyContent.options.filter(group => !content.includes(group)).map(group => groups[group]).join(", ") || "No content groups"}.</p>
      <p>Credentials and local repository paths are excluded. User-authored text and opaque artifact references are retained as inert text. This selected history file is not a restorable backup. A partial file without its final complete record is not a complete export.</p>
      <button disabled={!content.length || busy !== null} onClick={() => void download()}>{busy === "export" ? "Downloading history…" : "Download selected history"}</button>
    </section>
    <section className="settings-section" aria-labelledby="history-retention-heading">
      <h2 id="history-retention-heading">Retain history deliberately</h2>
      <p>All history is retained until you explicitly prune.</p>
      <p>Only eligible old event payloads and replay changes can be removed. Tasks, completions, dependencies, revisions, decisions, artifacts, terminal evidence, event identities and original receipts remain. Active runs, current acceptance evidence and graph references are protected.</p>
      <p>AgentFlow makes a local safety backup before pruning. Keep a separate local backup for recovery; stop AgentFlow before restoring. Display-body savings can be modest and do not measure reclaimed disk blocks.</p>
      <label>UTC cutoff<input value={cutoff} placeholder="2026-01-01T00:00:00.000Z" disabled={busy !== null} onChange={event => { setCutoff(event.target.value); if (retention.kind !== "pending") setRetention({ kind: "idle" }); }} /></label>
      <p className="metadata">Eligible records must be received before this explicit UTC time. Each preview is bounded to 1,000 payloads and 1,000 replay changes, and expires after five minutes.</p>
      {retention.kind !== "pending" && <button ref={previewButton} disabled={busy !== null} onClick={() => void prepare()}>{busy === "preview" ? "Preparing preview…" : "Preview prune"}</button>}
      {retention.kind === "preview" && !preview && <p role="status">Workspace changed. Prepare another preview. Your cutoff is retained.</p>}
      {preview && <div ref={retainPreviewFocus} className="retention-preview">
        <h3>Prune preview</h3>
        <p>Cutoff: <time dateTime={preview.cutoff}>{preview.cutoff}</time></p>
        <dl><dt>Eligible event payloads in this batch</dt><dd>{preview.counts.eventPayloads} · {preview.hasMore.eventPayloads ? "More eligible payloads remain" : "No further eligible payloads"}</dd><dt>Eligible replay changes in this batch</dt><dd>{preview.counts.changes} · {preview.hasMore.changes ? "More eligible changes remain" : "No further eligible changes"}</dd><dt>Preview expires (UTC)</dt><dd><time dateTime={preview.expiresAt}>{preview.expiresAt}</time></dd></dl>
        {!preview.counts.eventPayloads && !preview.counts.changes ? <p>No eligible history before this cutoff. Everything is retained.</p> : <><p>Confirm removes only this prepared batch. Protected facts remain. Another batch requires another explicit preview.</p><button className="danger" disabled={busy !== null} onClick={() => void prune(freezeCommand("/retention/prune", "POST", { previewId: preview.previewId, expectedGeneration: preview.expectedGeneration, expectedVersion: preview.expectedVersion, candidateDigest: preview.candidateDigest }))}>Confirm prune</button></>}
        <button disabled={busy !== null} onClick={() => { setRetention({ kind: "idle" }); inform("Preview cancelled. All history is retained."); }}>Cancel preview</button>
      </div>}
      {retention.kind === "pending" && <div className="retention-recovery"><p>The original prune request is retained. A refreshed workspace never changes its key or body.</p>{retention.retryable && <button disabled={busy !== null} onClick={() => void prune(retention.command)}>{busy === "prune" ? "Checking prune outcome…" : "Retry exact prune request"}</button>}<p>Preparing another preview starts a new intent and abandons this exact retry. Check the recorded outcome first if the response was uncertain.</p><button disabled={busy !== null} onClick={() => void prepare()}>Prepare another preview</button></div>}
    </section>
    {notice && <p ref={feedback} tabIndex={-1} role={notice.error ? "alert" : "status"} className={notice.error ? "error" : "notice"}>{notice.text}</p>}
  </div>;
}
