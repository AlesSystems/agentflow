"use client";
import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ReactFlow,
  Controls,
  Position,
  MarkerType,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useQueryClient } from "@tanstack/react-query";
import { freezeCommand, type FrozenCommand } from "../../client/commands";
import { ApiError } from "../../client/api";
import { useRead, useWorkspace, QueryFeedback } from "../../client/provider";
import { usePaged } from "../../client/paged";
import {
  workflowsResponse,
  workflowResponse,
  revisionsResponse,
  revisionResponse,
  workflowRunsResponse,
  workflowRunDetailResponse,
  workflowNodeHistoryResponse,
  workflowEventsResponse,
  workflowClose,
  type WorkflowPlan,
} from "../../contracts/workflows";
import { ReportingLabel } from "../tracking";
import { graphLayout } from "./layout";
function sameId(value: string, expected: string | null) {
  return expected !== null && value.toLowerCase() === expected.toLowerCase();
}
function subscribeNarrow(changed: () => void) {
  const media = window.matchMedia("(max-width: 700px)");
  media.addEventListener("change", changed);
  return () => media.removeEventListener("change", changed);
}
function More({
  page,
  label,
}: {
  page: {
    next?: string | null;
    busy: boolean;
    error: string;
    more: () => Promise<void>;
  };
  label: string;
}) {
  return (
    <>
      {page.error && <p role="alert">{page.error}</p>}
      {page.next && (
        <button disabled={page.busy} onClick={() => void page.more()}>
          Load more {label}
        </button>
      )}
    </>
  );
}
export function Workflows({
  projectId,
  initial,
}: {
  projectId: string;
  initial: Record<string, string>;
}) {
  const page = usePaged(
      `/workflows?projectId=${projectId}&limit=20`,
      workflowsResponse,
    ),
    [workflowId, setWorkflow] = useState(initial.workflowId ?? "");
  const id = workflowId || page.items[0]?.id;
  if (!workflowId && id) setWorkflow(id);
  return (
    <div className="workflow-page">
      <nav aria-label="Project views">
        <Link href={`/projects/${projectId}`}>Board</Link> ·{" "}
        <Link href={`/projects/${projectId}/workflows`} aria-current="page">
          Workflows
        </Link>
      </nav>
      <h1>Workflows</h1>
      <p className="intro">
        Published plans and reports from your external harness. Task acceptance
        remains on the board.
      </p>
      <QueryFeedback
        error={page.query.error}
        loading={page.query.isPending}
        retry={() => void page.query.refetch()}
      />
      <label>
        Workflow
        <select
          aria-label="Workflow"
          value={id ?? ""}
          onChange={(e) => setWorkflow(e.target.value)}
        >
          {id && !page.items.some((w) => w.id === id) && (
            <option value={id}>Selected workflow {id}</option>
          )}
          {page.items.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </label>
      <More page={page} label="workflows" />
      {!page.query.isPending && !page.items.length && (
        <p>
          No workflows published. Register a workflow and immutable plan with
          the CLI.
        </p>
      )}
      {id && (
        <BoundWorkflow
          key={id}
          projectId={projectId}
          workflowId={id}
          initial={initial.workflowId === id ? initial : {}}
        />
      )}
    </div>
  );
}
function BoundWorkflow(props: {
  projectId: string;
  workflowId: string;
  initial: Record<string, string>;
}) {
  const query = useRead(`/workflows/${props.workflowId}`, workflowResponse);
  const [knownBinding, setKnownBinding] = useState(false);
  const workflow = query.data?.data;
  const bound =
    workflow &&
    sameId(workflow.id, props.workflowId) &&
    sameId(workflow.projectId, props.projectId);
  if (bound && !knownBinding) setKnownBinding(true);
  // Preserve selector state during generation repair; each query still supplies
  // current-generation data, and an explicit mismatch hides the entire plan.
  const showPlan = bound || (knownBinding && !workflow);
  return (
    <>
      <QueryFeedback
        error={query.error}
        loading={query.isPending}
        retry={() => void query.refetch()}
      />
      {workflow && !bound && (
        <p role="alert">
          This workflow belongs to another project. Choose a matching workflow.
        </p>
      )}
      {showPlan && <PublishedPlan {...props} />}
    </>
  );
}
function PublishedPlan({
  projectId,
  workflowId,
  initial,
}: {
  projectId: string;
  workflowId: string;
  initial: Record<string, string>;
}) {
  const revisions = usePaged(
      `/workflows/${workflowId}/revisions?limit=20`,
      revisionsResponse,
    ),
    [revisionId, setRevision] = useState(initial.revisionId ?? "");
  const id = revisionId || revisions.items[0]?.id;
  if (!revisionId && id) setRevision(id);
  return (
    <>
      <label>
        Plan revision
        <select
          aria-label="Plan revision"
          value={id ?? ""}
          onChange={(e) => setRevision(e.target.value)}
        >
          {id && !revisions.items.some((r) => r.id === id) && (
            <option value={id}>Selected revision {id}</option>
          )}
          {revisions.items.map((r) => (
            <option key={r.id} value={r.id}>
              Revision {r.revision}
            </option>
          ))}
        </select>
      </label>
      <QueryFeedback
        error={revisions.query.error}
        loading={revisions.query.isPending}
        retry={() => void revisions.query.refetch()}
      />
      <More page={revisions} label="revisions" />
      {id && (
        <Plan
          key={id}
          {...{ projectId, workflowId, revisionId: id }}
          initial={initial.revisionId === id ? initial : {}}
        />
      )}
    </>
  );
}
function Plan({
  projectId,
  workflowId,
  revisionId,
  initial,
}: {
  projectId: string;
  workflowId: string;
  revisionId: string;
  initial: Record<string, string>;
}) {
  const revision = useRead(
      `/workflows/${workflowId}/revisions/${revisionId}`,
      revisionResponse,
    ),
    runs = usePaged(
      `/workflow-runs?workflowId=${workflowId}&planRevisionId=${revisionId}&limit=20`,
      workflowRunsResponse,
    ),
    [runId, setRun] = useState(initial.workflowRunId ?? ""),
    [nodeId, setNode] = useState(initial.nodeId ?? ""),
    [chosenView, setView] = useState(initial.view ?? "");
  const selectedRun = runId || runs.items[0]?.id;
  const selectedNode = nodeId || revision.data?.data.nodes[0]?.id || "";
  // Capture each default once; refresh/reset must not choose a different record.
  if (!runId && selectedRun) setRun(selectedRun);
  if (!nodeId && selectedNode) setNode(selectedNode);
  const narrow = useSyncExternalStore(
      subscribeNarrow,
      () => window.matchMedia("(max-width: 700px)").matches,
      () => false,
    ),
    view = chosenView || (narrow ? "list" : "graph");
  const context = new URLSearchParams({
    workflowId,
    revisionId,
    ...(selectedRun ? { workflowRunId: selectedRun } : {}),
    ...(selectedNode ? { nodeId: selectedNode } : {}),
    view,
  });
  const search = context.toString();
  useEffect(() => {
    window.history.replaceState(
      {},
      "",
      `/projects/${projectId}/workflows?${search}`,
    );
  }, [projectId, search]);
  return (
    <>
      <QueryFeedback
        error={revision.error}
        loading={revision.isPending}
        retry={() => void revision.refetch()}
      />
      <label>
        Workflow attempt
        <select
          aria-label="Workflow attempt"
          value={selectedRun ?? ""}
          onChange={(e) => setRun(e.target.value)}
        >
          {selectedRun && !runs.items.some((r) => r.id === selectedRun) && (
            <option value={selectedRun}>Selected attempt {selectedRun}</option>
          )}
          {runs.items.map((r) => (
            <option key={r.id} value={r.id}>
              {r.createdAt} · {r.state}
            </option>
          ))}
        </select>
      </label>
      <More page={runs} label="attempts" />
      {revision.data && (
        <PlanEvidence
          key={selectedRun ?? "unreported"}
          {...{
            projectId,
            workflowId,
            revisionId,
            nodeId: selectedNode,
            setNode,
            view,
            setView,
            context,
          }}
          plan={revision.data.data}
          runId={selectedRun}
        />
      )}
    </>
  );
}
function PlanEvidence({
  projectId,
  plan,
  runId,
  nodeId,
  setNode,
  view,
  setView,
  context,
}: {
  projectId: string;
  workflowId: string;
  revisionId: string;
  plan: WorkflowPlan;
  runId?: string;
  nodeId: string;
  setNode: (id: string) => void;
  view: string;
  setView: (v: string) => void;
  context: URLSearchParams;
}) {
  return runId ? (
    <ReportedPlan
      {...{ projectId, plan, runId, nodeId, setNode, view, setView, context }}
    />
  ) : (
    <>
      <p>No workflow attempt registered for this revision.</p>
      <PlanNodes
        {...{ plan, nodeId, setNode, view, setView }}
        statuses={new Map()}
      />
    </>
  );
}
function PlanNodes({
  plan,
  nodeId,
  setNode,
  view,
  setView,
  statuses,
}: {
  plan: WorkflowPlan;
  nodeId: string;
  setNode: (id: string) => void;
  view: string;
  setView: (v: string) => void;
  statuses: Map<string, string>;
}) {
  const root = useRef<HTMLElement>(null);
  function focusNode() {
    const element = root.current?.querySelector<HTMLElement>(
      view === "graph"
        ? `.react-flow__node[data-id="${nodeId}"]`
        : `button[data-node-id="${nodeId}"]`,
    );
    element?.focus();
  }
  function toggle(next: string) {
    setView(next);
    requestAnimationFrame(() =>
      root.current
        ?.querySelector<HTMLElement>(
          next === "graph"
            ? `.react-flow__node[data-id="${nodeId}"]`
            : `button[data-node-id="${nodeId}"]`,
        )
        ?.focus(),
    );
  }
  const nodes = useMemo<Node[]>(() => {
    const labels = new Map(plan.nodes.map((n) => [n.id, n.label]));
    return graphLayout(plan).map((n) => ({
      ...n,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      ariaLabel: `${labels.get(n.id)} · ${statuses.get(n.id) ?? "Unknown"}`,
      data: {
        label: (
          <>
            <span className="workflow-node-title">{labels.get(n.id)}</span>
            <span>{statuses.get(n.id) ?? "Unknown"}</span>
          </>
        ),
      },
      selected: n.id === nodeId,
    }));
  }, [plan, nodeId, statuses]);
  const edges: Edge[] = plan.edges.map((e, i) => ({
    id: String(i),
    source: e.source,
    target: e.target,
    markerEnd: { type: MarkerType.ArrowClosed },
  }));
  return (
    <section
      ref={root}
      aria-label="Published plan"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          focusNode();
        }
      }}
    >
      <div className="workflow-view">
        <button aria-pressed={view === "graph"} onClick={() => toggle("graph")}>
          Graph
        </button>
        <button aria-pressed={view === "list"} onClick={() => toggle("list")}>
          List
        </button>
      </div>
      <p className="metadata">
        Read-only plan. Select a node to inspect its reported evidence.
      </p>
      {view === "graph" ? (
        <div className="workflow-graph">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodesFocusable
            autoPanOnNodeFocus
            ariaLabelConfig={{
              "node.a11yDescription.default":
                "Read-only plan node. Press Enter or Space to inspect evidence. Arrow keys do not edit this plan.",
            }}
            nodesDraggable={false}
            nodesConnectable={false}
            edgesReconnectable={false}
            deleteKeyCode={null}
            onNodeClick={(_, n) => setNode(n.id)}
            onNodeDoubleClick={(_, n) => setNode(n.id)}
            fitView
            minZoom={0.02}
            fitViewOptions={{ duration: 0, minZoom: 0.02, maxZoom: 1 }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                const id = (e.target as HTMLElement)
                  .closest("[data-id]")
                  ?.getAttribute("data-id");
                if (id) {
                  e.preventDefault();
                  setNode(id);
                }
              }
            }}
          >
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      ) : (
        <ul className="workflow-node-list">
          {plan.nodes.map((n) => (
            <li key={n.id}>
              <button
                data-node-id={n.id}
                aria-pressed={nodeId === n.id}
                onClick={() => setNode(n.id)}
              >
                {n.label} · {statuses.get(n.id) ?? "Unknown"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
function ReportedPlan(props: {
  projectId: string;
  plan: WorkflowPlan;
  runId: string;
  nodeId: string;
  setNode: (id: string) => void;
  view: string;
  setView: (v: string) => void;
  context: URLSearchParams;
}) {
  function returnToPlan() {
    document
      .querySelector<HTMLElement>(
        props.view === "graph"
          ? `.react-flow__node[data-id="${selected?.nodeId ?? props.nodeId}"]`
          : `button[data-node-id="${selected?.nodeId ?? props.nodeId}"]`,
      )
      ?.focus();
  }
  const query = useRead(
      `/workflow-runs/${props.runId}/snapshot`,
      workflowRunDetailResponse,
    ),
    run = query.data?.data;
  const bound =
    run &&
    sameId(run.id, props.runId) &&
    sameId(run.projectId, props.projectId) &&
    sameId(run.planRevisionId, props.context.get("revisionId")) &&
    sameId(run.workflowId, props.context.get("workflowId"));
  const nodes = bound ? run.nodes : [],
    statuses = new Map(
      nodes.map((n) => [n.nodeId, n.observation?.payload.state ?? "Unknown"]),
    ),
    selected = nodes.find(
      (n) => n.nodeId === (props.nodeId || props.plan.nodes[0]?.id),
    );
  return (
    <>
      <QueryFeedback
        error={query.error}
        loading={query.isPending}
        retry={() => void query.refetch()}
      />
      {run && !bound && (
        <p role="alert">
          This attempt belongs to another plan. Choose a matching attempt.
        </p>
      )}
      {bound && (
        <>
          <ReportingLabel run={run} />
          <p className="metadata">
            Last received {run.lastReceivedAt} · Sequence {run.lastSequence}
          </p>
          {run.closure && <p>Operator closed tracking: {run.closure.reason}</p>}
          <CloseWorkflow
            id={run.id}
            version={run.version}
            eligible={
              run.freshness.stale && ["queued", "running"].includes(run.state)
            }
          />
        </>
      )}
      <PlanNodes
        {...props}
        nodeId={selected?.nodeId ?? props.nodeId}
        statuses={statuses}
      />
      {selected && (
        <section
          className="workflow-evidence"
          data-workflow-id={props.context.get("workflowId")}
          data-plan-revision-id={props.context.get("revisionId")}
          data-workflow-run-id={props.runId}
          data-node-id={selected.nodeId}
          data-event-id={selected.observation?.eventId}
          aria-label="Node evidence"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              returnToPlan();
            }
          }}
        >
          <button onClick={returnToPlan}>Back to selected plan node</button>
          <h2>{selected.label}</h2>
          {selected.observation ? (
            <>
              <p>Reported node state: {selected.observation.payload.state}</p>
              <p className="break-word">{selected.observation.eventId}</p>
              <p>
                Occurred {selected.observation.occurredAt}
                <br />
                Received {selected.observation.receivedAt}
              </p>
              <p>
                Skill{" "}
                {selected.observation.payload.reportedSkill?.name ?? "Unknown"}
              </p>
              {selected.observation.payload.reportedSkill && (
                <p className="break-word">
                  Source{" "}
                  {selected.observation.payload.reportedSkill.source ??
                    "Unknown"}{" "}
                  · Version{" "}
                  {selected.observation.payload.reportedSkill.version ??
                    "Unknown"}
                </p>
              )}
            </>
          ) : (
            <>
              <p>No node observation received.</p>
              <p>Skill Unknown</p>
            </>
          )}
          {selected.taskId && (
            <Link
              href={`/projects/${props.projectId}/tasks/${selected.taskId}?workflowReturn=${encodeURIComponent(props.context.toString())}`}
            >
              Open linked task
            </Link>
          )}
          {selected.observation?.payload.runId ? (
            <>
              <p>
                <Link
                  href={`/runs/${selected.observation.payload.runId}?workflowReturn=${encodeURIComponent(props.context.toString())}&projectId=${props.projectId}`}
                >
                  Open reported attempt
                </Link>
              </p>
              {selected.linkedAttempt && (
                <>
                  <p>Linked attempt current tracking</p>
                  <ReportingLabel run={selected.linkedAttempt} />
                </>
              )}
            </>
          ) : (
            <p>Linked attempt Unknown</p>
          )}
          <NodeHistory
            key={selected.nodeId}
            runId={props.runId}
            nodeId={selected.nodeId}
          />
        </section>
      )}
      {bound && <WorkflowEvents runId={props.runId} />}
    </>
  );
}
function NodeHistory({ runId, nodeId }: { runId: string; nodeId: string }) {
  const page = usePaged(
    `/workflow-runs/${runId}/nodes/${nodeId}/observations?limit=20`,
    workflowNodeHistoryResponse,
  );
  return (
    <>
      <h3>Node observation history</h3>
      <QueryFeedback
        error={page.query.error}
        loading={page.query.isPending}
        retry={() => void page.query.refetch()}
      />
      <ol>
        {page.items.map((o) => (
          <li key={o.eventId}>
            {o.sequence} · {o.payload.state}
            <p className="break-word">
              Report {o.eventId}
              <br />
              Occurred {o.occurredAt}
              <br />
              Received {o.receivedAt}
            </p>
            <p>
              Reported attempt {o.payload.runId ?? "Unknown"} · Skill{" "}
              {o.payload.reportedSkill?.name ?? "Unknown"}
            </p>
            <p className="break-word">
              Skill source {o.payload.reportedSkill?.source ?? "Unknown"} ·
              Version {o.payload.reportedSkill?.version ?? "Unknown"}
            </p>
          </li>
        ))}
      </ol>
      <More page={page} label="observations" />
    </>
  );
}

function CloseWorkflow({
  id,
  version,
  eligible,
}: {
  id: string;
  version: number;
  eligible: boolean;
}) {
  const { api, pair } = useWorkspace(),
    cache = useQueryClient(),
    [reason, setReason] = useState(""),
    [open, setOpen] = useState(false),
    [request, setRequest] = useState<FrozenCommand | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  async function send(command: FrozenCommand) {
    setRequest(command);
    setBusy(true);
    try {
      await api.command(command);
      await cache.invalidateQueries();
      setOpen(false);
      setRequest(null);
      setReason("");
      setNotice("Tracking record closed. No process signal was sent.");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) pair();
      setNotice(
        "Could not confirm closure. Your reason is retained; retry the exact request.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!eligible && !open && !request && !notice) return null;
  return (
    <section>
      <button disabled={!eligible || busy} onClick={() => setOpen(true)}>
        Close stale workflow tracking
      </button>
      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const parsed = workflowClose.safeParse({
              expectedVersion: version,
              reason,
            });
            if (parsed.success)
              void send(
                freezeCommand(
                  `/workflow-runs/${id}/close`,
                  "POST",
                  parsed.data,
                ),
              );
          }}
        >
          <p>
            The external process may still be running. This closes tracking
            only.
          </p>
          <label>
            Reason
            <textarea
              required
              maxLength={4000}
              value={reason}
              disabled={busy}
              onChange={(e) => {
                setReason(e.target.value);
                setRequest(null);
              }}
            />
          </label>
          <button disabled={busy || !eligible}>
            Confirm workflow tracking closure
          </button>
          <button type="button" disabled={busy} onClick={() => setOpen(false)}>
            Keep tracking
          </button>
        </form>
      )}
      {request && (
        <button disabled={busy} onClick={() => void send(request)}>
          Retry exact workflow closure
        </button>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
function WorkflowEvents({ runId }: { runId: string }) {
  const page = usePaged(
    `/workflow-runs/${runId}/events?limit=20`,
    workflowEventsResponse,
  );
  return (
    <section>
      <h2>Workflow report history</h2>
      <QueryFeedback
        error={page.query.error}
        loading={page.query.isPending}
        retry={() => void page.query.refetch()}
      />
      <ol>
        {page.items.map((e) => (
          <li key={e.eventId}>
            {e.sequence} · {e.type}
            <p>
              Occurred {e.occurredAt}
              <br />
              Received {e.receivedAt}
            </p>
            {"summary" in e.payload && <p>{e.payload.summary}</p>}
            {"message" in e.payload && <p>{e.payload.message}</p>}
            {"reason" in e.payload && <p>{e.payload.reason}</p>}
          </li>
        ))}
      </ol>
      <More page={page} label="workflow reports" />
    </section>
  );
}
