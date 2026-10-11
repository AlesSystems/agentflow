"use client";
import { AcceptanceFacts, ReportedEvidenceHistory } from "./evidence";
import { dependenciesInput, reviewPolicyInput, artifactInput, reworkInput } from "../../contracts/evidence";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWorkspace, useRead, QueryFeedback } from "../../client/provider";
import {
  taskDetailResponse,
  commentsResponse,
} from "../../contracts/responses";
import {
  taskPatch,
  completeInput,
  reopenInput,
  commentInput,
  type Task,
} from "../../contracts/tasks";
import { fields, type Draft } from "../../client/drafts";
import {
  freezeCommand,
  moveIntent,
  type FrozenCommand,
} from "../../client/commands";
import { ApiError, StaleSnapshot } from "../../client/api";
import { Attempts } from "../tracking";
import { TaskFields } from "./fields";
import { StatusMenu, statusLabel } from "../ui/menu";
type EvidenceKind = "dependencies" | "policy" | "artifact" | "rework";
type CommandKind = "edit" | "action" | "comment" | "move" | EvidenceKind;
type DetailProps = {
  id: string;
  archived: boolean;
  onDirty: (dirty: boolean) => void;
  onStatus?: (task: Task) => void;
  initialAccept?: boolean;
};
export function TaskDetail({
  id,
  archived,
  onDirty,
  onStatus,
  initialAccept = false,
}: DetailProps) {
  const path = `/tasks/${id}`;
  const query = useRead(path, taskDetailResponse);
  const { api, pair, generation } = useWorkspace();
  const cache = useQueryClient();
  const [commentNote, setCommentNote] = useState(""),
    [evidenceNote, setEvidenceNote] = useState(""),
    [evidenceUrl, setEvidenceUrl] = useState(""),
    [reopenReason, setReopenReason] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null),
    [notice, setNotice] = useState(""),
    [action, setAction] = useState<"accept" | "reopen" | null>(
      initialAccept ? "accept" : null,
    ),
    [command, setCommand] = useState<{
      request: FrozenCommand;
      kind: CommandKind;
    } | null>(null),
    [busy, setBusy] = useState(false);
  const [dependenciesDraft,setDependenciesDraft]=useState<{version:number;text:string}|null>(null);
  const [policyDraft,setPolicyDraft]=useState<{version:number;reviewRequired:boolean;verificationRequired:boolean}|null>(null);
  const [artifactDraft,setArtifactDraft]=useState<{version:number;artifactRef:string;displayUrl:string}|null>(null);
  const [reworkDraft,setReworkDraft]=useState<{version:number;reason:string}|null>(null);
  const evidenceDirty=!!(dependenciesDraft||policyDraft||artifactDraft||reworkDraft);
  const [commentsCursor, setCommentsCursor] = useState<string | null>(null),
    [comments, setComments] = useState<
      NonNullable<ReturnType<typeof useComments>["data"]>["data"]["items"]
    >([]);
  const commentQuery = useComments(query.data?.data.task.id ?? id, commentsCursor);
  const [history, setHistory] = useState<{
    completion: NonNullable<
      NonNullable<typeof query.data>["data"]["history"]["completions"]
    >["items"];
    reopen: NonNullable<
      NonNullable<typeof query.data>["data"]["history"]["reopens"]
    >["items"];
  }>({ completion: [], reopen: [] });
  const [historyUrls, setHistoryUrls] = useState<{
    completion?: string | null;
    reopen?: string | null;
  }>({});
  const [pageScope, setPageScope] = useState<{
    generation: string;
    cursor?: string;
    revision?: number;
  }>({ generation });
  if (
    pageScope.generation !== generation ||
    (query.data &&
      (pageScope.cursor !== query.data.snapshotCursor ||
        pageScope.revision !== query.dataUpdatedAt))
  ) {
    setPageScope({
      generation,
      cursor: query.data?.snapshotCursor,
      revision: query.dataUpdatedAt,
    });
    setComments([]);
    setCommentsCursor(null);
    setHistory({ completion: [], reopen: [] });
    setHistoryUrls({});
  }
  const data = query.data?.data;
  const task = data?.task;
  const dirty = !!draft;
  const notesDirty = !!(
    commentNote ||
    evidenceNote ||
    evidenceUrl ||
    reopenReason || evidenceDirty
  );
  const frozen = busy || draft?.phase === "submitting";
  useEffect(
    () => onDirty(dirty || !!command || notesDirty),
    [dirty, command, notesDirty, onDirty],
  );
  useEffect(() => {
    if (!dirty && !notesDirty) return;
    const unload = (event: BeforeUnloadEvent) => event.preventDefault();
    const navigate = (event: MouseEvent) => {
      if (
        (event.target as Element).closest("a[href]") &&
        !confirm("Discard unsaved task changes and leave?")
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", navigate, true);
    };
  }, [dirty, notesDirty]);
  async function send(
    request: FrozenCommand,
    kind: CommandKind,
  ) {
    const exactRetry=command?.request === request;
    if(command && !exactRetry){setNotice("Resolve the pending request with exact retry or explicit refresh and reprepare before saving another command. Your drafts are retained.");return false;}
    if (
      !exactRetry && kind === "action" &&
      request.path.endsWith("/complete") &&
      task?.status !== "review"
    ) {
      setNotice("Move to Review first. Your evidence note is retained.");
      return false;
    }
    if (!exactRetry && (kind === "action" || kind === "move") && (draft || evidenceDirty)) {
      setNotice(
        "Save or discard the task field draft before changing its lifecycle. Your notes are retained.",
      );
      return false;
    }
    setNotice("");
    setBusy(true);
    setCommand({ request, kind });
    if (kind === "edit" && draft)
      setDraft({ ...draft, phase: "submitting", request });
    try {
      await api.command(request);
      await cache.invalidateQueries();
      const fresh = await api.read(path, taskDetailResponse);
      onStatus?.(fresh.data.task);
      if (kind === "edit") setDraft(null);
      if (kind === "dependencies") setDependenciesDraft(null);
      if (kind === "policy") setPolicyDraft(null);
      if (kind === "artifact") setArtifactDraft(null);
      if (kind === "rework") setReworkDraft(null);
      setCommand(null);
      if (kind === "comment") setCommentNote("");
      if (kind === "action") {
        if (action === "accept") {
          setEvidenceNote("");
          setEvidenceUrl("");
        } else setReopenReason("");
        setAction(null);
      }
      setComments([]);
      setCommentsCursor(null);
      setHistory({ completion: [], reopen: [] });
      setHistoryUrls({});
      setNotice(kind === "comment" ? "Comment added." : "Changes saved.");
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) pair();
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        kind === "edit" &&
        draft
      ) {
        try {
          const current = await api.read(path, taskDetailResponse);
          setDraft({
            phase: "conflict",
            base: draft.base,
            values: draft.values,
            request,
            current: current.data.task,
          });
          setNotice("This task changed. Your draft is kept below.");
        } catch {
          setDraft({
            ...draft,
            phase: "failed",
            request,
            error: "Could not load the current task. Retry refresh.",
          });
        }
      } else {
        if (kind === "edit" && draft)
          setDraft({
            ...draft,
            phase: "failed",
            request,
            error:
              error instanceof ApiError ? error.message : "Uncertain response",
          });
        setNotice(
          error instanceof StaleSnapshot
            ? "Workspace generation changed. Refresh the current record before retrying."
            : error instanceof ApiError
              ? `Could not save: ${error.message}. Your input is retained.`
              : "Save response is uncertain. Retry uses the same request and key.",
        );
      }
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function prepareEvidence(kind: EvidenceKind) {
    setBusy(true);
    try {
      const fresh=await api.read(path,taskDetailResponse);
      cache.setQueryData([api.generation,path],fresh);
      const version=fresh.data.task.version;
      if(kind === "dependencies")setDependenciesDraft(d=>d&&({...d,version}));
      if(kind === "policy")setPolicyDraft(d=>d&&({...d,version}));
      if(kind === "artifact")setArtifactDraft(d=>d&&({...d,version}));
      if(kind === "rework")setReworkDraft(d=>d&&({...d,version}));
      setCommand(null);
      setNotice(`Prepared against current version ${version}. Inspect your retained draft before saving a new request.`);
    }catch{setNotice("Could not refresh. Your draft and original request are retained.");}finally{setBusy(false);}
  }
  const activeAttempt=!!data?.latestRun && ["queued","running"].includes(data.latestRun.state);
  const evidenceDisabled=archived||task?.status === "completed"||activeAttempt||busy||!!draft||!!command;
  const acceptanceBlocked=!!data && (!data.readiness.ready||!data.evidence.implementationCurrent||[data.evidence.review,data.evidence.verification].some(gate=>gate.required&&(!data.evidence.currentArtifact||gate.changesRequested||!gate.approved)));
  async function move(status: Task["status"]) {
    if (!task) return;
    const intent = moveIntent(task.status, status);
    if (intent.kind === "reviewFirst")
      setNotice(
        "Move to Review first. Completion requires human acceptance of the current work revision.",
      );
    if (intent.kind === "accept") setAction("accept");
    if (intent.kind === "patch")
      await send(
        freezeCommand(path, "PATCH", {
          expectedVersion: task.version,
          status: intent.status,
        }),
        "move",
      );
  }
  async function loadHistory(kind: "completion" | "reopen", url: string) {
    const captured = cache.getQueryState([generation, path])?.dataUpdatedAt;
    try {
      const result = await api.read(url, taskDetailResponse);
      if (api.generation !== generation || captured !== cache.getQueryState([generation, path])?.dataUpdatedAt) return;
      const page =
        kind === "completion"
          ? result.data.history.completions
          : result.data.history.reopens;
      if (page) {
        if (kind === "completion")
          setHistory((h) => ({
            ...h,
            completion: [
              ...h.completion,
              ...result.data.history.completions!.items,
            ],
          }));
        else
          setHistory((h) => ({
            ...h,
            reopen: [...h.reopen, ...result.data.history.reopens!.items],
          }));
        setHistoryUrls((u) => ({ ...u, [kind]: page.nextUrl }));
      }
    } catch {
      setNotice("Could not load more history. Try again.");
    }
  }
  return (
    <>
      <QueryFeedback
        error={query.error}
        loading={query.isPending}
        retry={() => void query.refetch()}
      />
      {task && data && (
        <>
          <div className="task-context">
            <span className={`status-tab ${task.status}`}>
              {statusLabel[task.status]}
            </span>
            <span className="metadata">
              Revision {task.workRevision} · Version {task.version}
            </span>
          </div>
          {archived && (
            <p className="notice">
              Archived project. Task history is read-only.
            </p>
          )}
          <div
            id="task-form-error"
            role="status"
            className={notice ? "notice" : ""}
          >
            {notice}
          </div>
          {draft?.phase === "conflict" && (
            <section className="conflict" aria-label="Version conflict">
              <h2 className="task-section-heading">Current saved task</h2>
              <dl>
                <dt>Title</dt>
                <dd>{draft.current.title}</dd>
                <dt>Description</dt>
                <dd>{draft.current.description || "Empty"}</dd>
                <dt>Acceptance criteria</dt>
                <dd>{draft.current.acceptanceCriteria || "Empty"}</dd>
                <dt>Status</dt>
                <dd>{statusLabel[draft.current.status]}</dd>
                <dt>Version</dt>
                <dd>{draft.current.version}</dd>
              </dl>
              <details>
                <summary>All current fields</summary>
                <pre>{JSON.stringify(fields(draft.current), null, 2)}</pre>
              </details>
              <p>
                Your draft remains in the fields below. Reapply prepares it
                against version {draft.current.version}; inspect before saving.
              </p>
              <div className="actions">
                <button
                  onClick={() => {
                    setDraft({
                      phase: "editing",
                      base: draft.current,
                      values: draft.values,
                    });
                    setCommand(null);
                  }}
                >
                  Prepare reapply
                </button>
                <button
                  onClick={() => {
                    if (
                      confirm(
                        "Discard your draft and load the current saved task?",
                      )
                    ) {
                      setDraft(null);
                      setCommand(null);
                      void query.refetch();
                    }
                  }}
                >
                  Discard draft and reload
                </button>
              </div>
            </section>
          )}
          <div className="actions">
            <StatusMenu
              task={task}
              disabled={archived || dirty || evidenceDirty || busy}
              onMove={(status) => void move(status)}
            />
            {task.status === "completed" && !archived && (
              <button
                disabled={dirty || busy}
                onClick={() => setAction("reopen")}
              >
                Reopen task
              </button>
            )}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!draft) return;
              const input = taskPatch.safeParse({
                ...draft.values,
                tags: draft.values.tags.filter(Boolean),
                expectedVersion: draft.base.version,
              });
              if (!input.success) {
                setNotice(
                  input.error.issues
                    .map((i) => `${i.path.join(".")}: ${i.message}`)
                    .join("; "),
                );
                return;
              }
              void send(freezeCommand(path, "PATCH", input.data), "edit");
            }}
          >
            <TaskFields
              values={draft?.values ?? fields(task)}
              disabled={
                archived ||
                task.status === "completed" ||
                frozen ||
                command?.kind === "comment"
              }
              onChange={(values) =>
                setDraft({
                  phase: "editing",
                  base: draft?.base ?? task,
                  values,
                })
              }
            />
            {!archived && task.status !== "completed" && (
              <div className="actions">
                <button
                  className="primary"
                  disabled={!dirty || frozen || draft?.phase === "conflict"}
                >
                  Save task
                </button>
                {action === "accept" && task.status !== "review" && (
                  <p role="status">
                    Move to Review first. Your evidence note is kept for
                    inspection of the current revision.
                  </p>
                )}
                {dirty && (
                  <button
                    type="button"
                    disabled={frozen}
                    onClick={() => {
                      if (confirm("Discard unsaved task changes?")) {
                        setDraft(null);
                        if (command?.kind === "edit") setCommand(null);
                      }
                    }}
                  >
                    Discard changes
                  </button>
                )}
              </div>
            )}
          </form>
          {command && !busy && draft?.phase !== "conflict" && (
            <button onClick={() => void send(command.request, command.kind)}>
              Retry exact request
            </button>
          )}
          {action!=="accept"&&<AcceptanceFacts headingLevel={2} task={task} readiness={data.readiness} evidence={data.evidence}/>}
          <section className="task-evidence-controls" aria-label="Dependencies and review policy">
            <h2 className="task-section-heading">Prerequisites and reported evidence</h2>
            {activeAttempt&&<p className="notice">A queued or running registered attempt holds this task record. Policy and evidence edits require no active attempt.</p>}
            <p className="metadata">These gates govern registration and human acceptance. They do not control external execution.</p>
            <details className="evidence-editor"><summary>Edit prerequisites and review evidence</summary>
            <form onSubmit={event=>{event.preventDefault();if(!dependenciesDraft)return;const parsed=dependenciesInput.safeParse({expectedVersion:dependenciesDraft.version,prerequisiteIds:dependenciesDraft.text.split(/[\s,]+/).filter(Boolean)});if(!parsed.success){setNotice("Enter at most 20 distinct prerequisite task UUIDs.");return;}void send(freezeCommand(`${path}/dependencies`,"PUT",parsed.data),"dependencies");}}>
              <label>Prerequisite task IDs<textarea disabled={evidenceDisabled} value={dependenciesDraft?.text ?? data.readiness.prerequisites.map(p=>p.taskId).join("\n")} onChange={event=>setDependenciesDraft({version:dependenciesDraft?.version ?? task.version,text:event.target.value})}/></label>
              <p className="metadata">One task UUID per line. Parent grouping and workflow edges are independent.</p>
              <button disabled={evidenceDisabled||!dependenciesDraft}>Save prerequisites</button>
            </form>
            <form onSubmit={event=>{event.preventDefault();if(!policyDraft)return;void send(freezeCommand(`${path}/review-policy`,"PATCH",reviewPolicyInput.parse({expectedVersion:policyDraft.version,reviewRequired:policyDraft.reviewRequired,verificationRequired:policyDraft.verificationRequired})),"policy");}}>
              <label className="checkbox-label"><input type="checkbox" disabled={evidenceDisabled} checked={policyDraft?.reviewRequired ?? task.reviewRequired} onChange={event=>setPolicyDraft({version:policyDraft?.version ?? task.version,reviewRequired:event.target.checked,verificationRequired:policyDraft?.verificationRequired ?? task.verificationRequired})}/>Require reported review</label>
              <label className="checkbox-label"><input type="checkbox" disabled={evidenceDisabled} checked={policyDraft?.verificationRequired ?? task.verificationRequired} onChange={event=>setPolicyDraft({version:policyDraft?.version ?? task.version,reviewRequired:policyDraft?.reviewRequired ?? task.reviewRequired,verificationRequired:event.target.checked})}/>Require reported verification</label>
              <button disabled={evidenceDisabled||!policyDraft}>Save review policy</button>
            </form>
            <form onSubmit={event=>{event.preventDefault();if(!artifactDraft)return;const parsed=artifactInput.safeParse({expectedVersion:artifactDraft.version,artifactRef:artifactDraft.artifactRef,...(artifactDraft.displayUrl ? {displayUrl:artifactDraft.displayUrl} : {})});if(!parsed.success){setNotice("Enter a nonempty artifact reference and valid optional display URL.");return;}void send(freezeCommand(`${path}/artifact`,"POST",parsed.data),"artifact");}}>
              <label>Artifact reference<input disabled={evidenceDisabled} maxLength={2000} value={artifactDraft?.artifactRef ?? data.evidence.currentArtifact?.artifactRef ?? ""} onChange={event=>setArtifactDraft({version:artifactDraft?.version ?? task.version,artifactRef:event.target.value,displayUrl:artifactDraft?.displayUrl ?? data.evidence.currentArtifact?.displayUrl ?? ""})}/></label>
              <label>Artifact display URL (inert text)<input disabled={evidenceDisabled} maxLength={2000} value={artifactDraft?.displayUrl ?? data.evidence.currentArtifact?.displayUrl ?? ""} onChange={event=>setArtifactDraft({version:artifactDraft?.version ?? task.version,artifactRef:artifactDraft?.artifactRef ?? data.evidence.currentArtifact?.artifactRef ?? "",displayUrl:event.target.value})}/></label>
              <p className="metadata">Replacing a current reference advances revision and needs fresh evidence. Contents are not fetched or verified.</p>
              <button disabled={evidenceDisabled||!artifactDraft}>Publish artifact reference</button>
            </form>
            <form onSubmit={event=>{event.preventDefault();if(!reworkDraft)return;const parsed=reworkInput.safeParse({expectedVersion:reworkDraft.version,reason:reworkDraft.reason});if(!parsed.success){setNotice("Enter a reason for rework.");return;}void send(freezeCommand(`${path}/rework`,"POST",parsed.data),"rework");}}>
              <label>Reason for rework<textarea disabled={evidenceDisabled||task.status!=="review"} required maxLength={4000} value={reworkDraft?.reason ?? ""} onChange={event=>setReworkDraft({version:reworkDraft?.version ?? task.version,reason:event.target.value})}/></label>
              <button disabled={evidenceDisabled||task.status!=="review"||!reworkDraft}>Return to Backlog for rework</button>
            </form>
            {evidenceDirty && <button disabled={busy} onClick={()=>{if(confirm("Discard unsaved prerequisite and evidence drafts?")){setDependenciesDraft(null);setPolicyDraft(null);setArtifactDraft(null);setReworkDraft(null);if(command && ["dependencies","policy","artifact","rework"].includes(command.kind))setCommand(null);}}}>Discard evidence drafts</button>}
            {command && ["dependencies","policy","artifact","rework"].includes(command.kind) && <button disabled={busy} onClick={()=>void prepareEvidence(command.kind as EvidenceKind)}>Refresh and prepare new request</button>}
            </details>
          </section>
          <ReportedEvidenceHistory id={id} task={task} currentArtifact={data.evidence.currentArtifact?.artifactRef ?? null}/>
          {command?.kind === "action" && !busy && <button onClick={async()=>{setBusy(true);try{const fresh=await api.read(path,taskDetailResponse);cache.setQueryData([api.generation,path],fresh);setCommand(null);setNotice(`Prepared against current version ${fresh.data.task.version}. Inspect your retained acceptance note before saving.`);}catch{setNotice("Could not refresh. Your original request and note are retained.");}finally{setBusy(false);}}}>Refresh and prepare acceptance request</button>}
          {action && (
            <section className="acceptance">
              <h2 className="task-section-heading">
                {action === "accept" ? "Human acceptance" : "Reopen this task"}
              </h2>
              {action === "accept" && (
                <>
                  <AcceptanceFacts task={task} readiness={data.readiness} evidence={data.evidence}/>
                  <p>
                    Read the acceptance criteria and evidence for revision{" "}
                    {task.workRevision}.
                  </p>
                  <p className="preserve-lines">
                    {task.acceptanceCriteria ||
                      "No acceptance criteria recorded."}
                  </p>
                </>
              )}
              {action === "accept" && task.status !== "review" && (
                <p role="status">
                  This task is in {statusLabel[task.status]}. Move to Review
                  first. Your evidence note is kept for inspection of the
                  current revision.
                </p>
              )}
              {dirty && (
                <p role="status">
                  Save or discard task field changes before accepting or
                  reopening. Your evidence note is kept.
                </p>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (dirty) {
                    setNotice(
                      "Save or discard the task field draft before accepting or reopening. Your notes are retained.",
                    );
                    return;
                  }
                  const form = new FormData(e.currentTarget);
                  const value =
                    action === "accept"
                      ? completeInput.safeParse({
                          expectedVersion: task.version,
                          evidenceNote: form.get("note"),
                          evidenceUrl: String(form.get("url")) || null,
                        })
                      : reopenInput.safeParse({
                          expectedVersion: task.version,
                          reason: form.get("note"),
                        });
                  if (!value.success) {
                    setNotice(
                      "Enter a nonempty note and a valid optional evidence URL.",
                    );
                    return;
                  }
                  void send(
                    freezeCommand(
                      `${path}/${action === "accept" ? "complete" : "reopen"}`,
                      "POST",
                      value.data,
                    ),
                    "action",
                  );
                }}
              >
                <label>
                  {action === "accept"
                    ? "Acceptance evidence note"
                    : "Reason for reopening"}
                  <textarea
                    value={action === "accept" ? evidenceNote : reopenReason}
                    onChange={(event) => {
                      if (action === "accept")
                        setEvidenceNote(event.target.value);
                      else setReopenReason(event.target.value);
                    }}
                    aria-label={
                      action === "accept"
                        ? "Acceptance evidence note"
                        : "Reason for reopening"
                    }
                    name="note"
                    required
                    maxLength={4000}
                    disabled={busy}
                  />
                </label>
                {action === "accept" && (
                  <label>
                    Evidence URL (optional)
                    <input
                      name="url"
                      type="url"
                      disabled={busy}
                      value={evidenceUrl}
                      onChange={(event) => {
                        setEvidenceUrl(event.target.value);
                      }}
                    />
                  </label>
                )}
                <button
                  className="primary"
                  disabled={
                    busy ||
                    archived ||
                    dirty || evidenceDirty ||
                    (action === "accept" && (task.status !== "review" || acceptanceBlocked))
                  }
                >
                  {action === "accept"
                    ? "Complete current revision"
                    : "Confirm reopen"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setAction(null);
                    if (action === "accept") {
                      setEvidenceNote("");
                      setEvidenceUrl("");
                    } else setReopenReason("");
                  }}
                >
                  Cancel
                </button>
              </form>
            </section>
          )}
          {data.currentCompletion && (
            <section className="acceptance">
              <h2 className="accepted-stamp">Human accepted</h2>
              <p>
                Revision {data.currentCompletion.workRevision} ·{" "}
                {new Date(data.currentCompletion.acceptedAt).toLocaleString()}
              </p>
              <p className="preserve-lines">
                {data.currentCompletion.evidenceNote}
              </p>
              {data.currentCompletion.evidenceUrl && (
                <a
                  href={data.currentCompletion.evidenceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open acceptance evidence
                </a>
              )}
            </section>
          )}
          {task.pullRequestUrl && (
            <p>
              <a
                href={task.pullRequestUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open pull request
              </a>
            </p>
          )}
          <section className="comments">
            <h2 className="task-section-heading">
              Comments{" "}
              <span className="count">
                {commentQuery.data?.data.total ?? ""}
              </span>
            </h2>
            <QueryFeedback
              error={commentQuery.error}
              loading={commentQuery.isPending}
              retry={() => void commentQuery.refetch()}
            />
            {[...comments, ...(commentQuery.data?.data.items ?? [])]
              .filter((p, i, a) => a.findIndex((x) => x.id === p.id) === i)
              .map((comment) => (
                <article key={comment.id}>
                  <p className="preserve-lines">{comment.text}</p>
                  <p className="metadata">
                    {comment.actor} ·{" "}
                    {new Date(comment.createdAt).toLocaleString()}
                  </p>
                </article>
              ))}
            {commentQuery.data?.data.nextCursor && (
              <button
                onClick={() => {
                  setComments((c) => [...c, ...commentQuery.data!.data.items]);
                  setCommentsCursor(commentQuery.data!.data.nextCursor);
                }}
              >
                Load more comments
              </button>
            )}
            {!archived && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const input = commentInput.safeParse({
                    text: new FormData(e.currentTarget).get("comment"),
                  });
                  if (!input.success) {
                    setNotice("Enter a nonempty comment.");
                    return;
                  }
                  const form = e.currentTarget;
                  void send(
                    freezeCommand(`${path}/comments`, "POST", input.data),
                    "comment",
                  ).then((committed) => {
                    if (committed) form.reset();
                  });
                }}
              >
                <label>
                  Add a comment
                  <textarea
                    value={commentNote}
                    onChange={(event) => {
                      setCommentNote(event.target.value);
                    }}
                    aria-label="Add a comment"
                    name="comment"
                    required
                    maxLength={4000}
                    disabled={busy || dirty || command?.kind === "comment"}
                  />
                </label>
                <button disabled={busy || dirty || command?.kind === "comment"}>
                  Add comment
                </button>
              </form>
            )}
          </section>
          <section>
            <h2 className="task-section-heading">Acceptance history</h2>
            {[
              ...(data.history.completions?.items ?? []),
              ...history.completion,
            ].map((item) => (
              <article className="history-entry" key={item.id}>
                <p>
                  Human accepted revision {item.workRevision} ·{" "}
                  {item.acceptedAt}
                </p>
                <p>{item.evidenceNote}</p>
              </article>
            ))}
            {(historyUrls.completion === undefined
              ? data.history.completions?.nextUrl
              : historyUrls.completion) && (
              <button
                onClick={() =>
                  void loadHistory(
                    "completion",
                    (historyUrls.completion ??
                      data.history.completions!.nextUrl)!,
                  )
                }
              >
                Load more acceptances
              </button>
            )}
            <h2 className="task-section-heading">Reopen history</h2>
            {[...(data.history.reopens?.items ?? []), ...history.reopen].map(
              (item) => (
                <article className="history-entry" key={item.id}>
                  <p>
                    Reopened revision {item.workRevision} · {item.createdAt}
                  </p>
                  <p>{item.reason}</p>
                </article>
              ),
            )}
            {(historyUrls.reopen === undefined
              ? data.history.reopens?.nextUrl
              : historyUrls.reopen) && (
              <button
                onClick={() =>
                  void loadHistory(
                    "reopen",
                    (historyUrls.reopen ?? data.history.reopens!.nextUrl)!,
                  )
                }
              >
                Load more reopens
              </button>
            )}
          </section>
        </>
      )}
      <Attempts filters={`taskId=${task?.id ?? id}`} inline />
    </>
  );
}
function useComments(id: string, cursor: string | null) {
  return useRead(
    `/tasks/${id}/comments?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    commentsResponse,
  );
}
