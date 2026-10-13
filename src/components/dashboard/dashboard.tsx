"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ReactFlow, Controls, Position, MarkerType, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useRead, useWorkspace, QueryFeedback } from "../../client/provider";
import { overviewResponse, projectResponse } from "../../contracts/responses";
import { trackingAgentsResponse, trackingRunsResponse, activityResponse } from "../../contracts/tracking";
import { usageResponse } from "../../contracts/usage";
import { workflowsResponse, revisionsResponse, workflowRunsResponse, workflowRunDetailResponse, type WorkflowPlan } from "../../contracts/workflows";
import { Board } from "../board/board";
import { Modal } from "../ui/dialog";
import { Scribble, EmptyNote } from "../ui/sketch";
import { ReportingLabel, RunDetail, Attempts, StateIcon } from "../tracking";
import { CodexLink } from "../codex";
import { graphLayout } from "../workflows/layout";

type Panel = { kind: "run" | "agent"; id: string; title: string } | null;

function clock(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function excerpt(text: string, length = 140) {
  return text.length > length ? text.slice(0, length).trimEnd() + "…" : text;
}
function opensPanel(event: React.MouseEvent, open: () => void) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  open();
}
function SheetHead({ id, title, variant, children }: { id: string; title: string; variant: number; children?: React.ReactNode }) {
  return (
    <div className="sheet-head">
      <h2 id={id} className="scribbled">
        {title}
        <Scribble variant={variant} />
      </h2>
      {children && <div className="sheet-head-end">{children}</div>}
    </div>
  );
}

export function Dashboard({ projectId, initialFilters }: { projectId: string; initialFilters: string }) {
  const project = useRead(`/projects/${projectId}`, projectResponse);
  const [panel, setPanel] = useState<Panel>(null);
  return (
    <>
      <h1 className="sr-only">{project.data?.data.name ?? "Project"} dashboard</h1>
      <Attention projectId={projectId} />
      <Board projectId={projectId} initialFilters={initialFilters} />
      <div className="dash-grid">
        <WorkflowSheet projectId={projectId} />
        <AgentsSheet onOpen={setPanel} />
        <RunsSheet projectId={projectId} onOpen={setPanel} />
        <ActivitySheet projectId={projectId} onOpen={setPanel} />
        <UsageSheet projectId={projectId} />
      </div>
      <Modal title={panel?.title ?? "Details"} open={!!panel} panel onClose={() => setPanel(null)}>
        {panel?.kind === "run" && (
          <>
            <RunDetail key={panel.id} id={panel.id} embedded />
            <p>
              <Link href={`/runs/${panel.id}`}>Open the full attempt page</Link>
            </p>
          </>
        )}
        {panel?.kind === "agent" && (
          <>
            <p>
              <Link href={`/agents/${panel.id}`}>Open the full agent page</Link>
            </p>
            <Attempts key={panel.id} filters={`agentId=${panel.id}`} inline />
          </>
        )}
      </Modal>
    </>
  );
}

function Attention({ projectId }: { projectId: string }) {
  const query = useRead("/overview?limit=50", overviewResponse, 15000);
  const data = query.data?.data;
  const { api, generation } = useWorkspace();
  type Item = NonNullable<typeof data>["attention"]["items"][number];
  const [extra, setExtra] = useState<{ snapshot?: string; items: Item[]; next?: string | null }>({ items: [] });
  const [error, setError] = useState("");
  const fresh = extra.snapshot === query.data?.snapshotCursor + generation;
  const next = fresh && extra.next !== undefined ? extra.next : data?.attention.nextCursor;
  const items = [...(data?.attention.items ?? []), ...(fresh ? extra.items : [])].filter(
    (item, index, all) => item.projectId === projectId && all.findIndex((other) => other.id === item.id) === index,
  );
  async function more() {
    if (!next || !query.data) return;
    const snapshot = query.data.snapshotCursor + generation;
    try {
      const page = await api.read(`/overview?limit=50&cursor=${encodeURIComponent(next)}`, overviewResponse);
      if (page.snapshotCursor + api.generation !== snapshot) {
        void query.refetch();
        return;
      }
      setExtra((old) => ({ snapshot, items: [...(old.snapshot === snapshot ? old.items : []), ...page.data.attention.items], next: page.data.attention.nextCursor }));
      setError("");
    } catch {
      setError("Could not load more attention items. Retry this page.");
    }
  }
  return (
    <section className="attention-strip" aria-labelledby="attention-heading">
      <h2 id="attention-heading">
        Needs attention{" "}
        <span className={`scribble-count ${items.length ? "" : "calm"}`}>{data ? `${items.length}${next ? "+" : ""}` : "…"}</span>
      </h2>
      <QueryFeedback error={query.error} loading={false} retry={() => void query.refetch()} />
      {items.map((item) => {
        const reasons = item.reasons.map((reason) => (reason === "blocked" ? "Blocked" : reason === "failed" ? "Failed run" : "Stale report")).join(" · ");
        return item.taskId ? (
          <a
            key={item.id}
            className="attention-chip"
            href={`/projects/${projectId}/tasks/${item.taskId}`}
            onClick={(event) => {
              const card = document.getElementById(`card-${item.taskId}`);
              if (card?.getClientRects().length) opensPanel(event, () => card.click());
            }}
          >
            <b>{reasons}</b> {item.title}
          </a>
        ) : (
          <span key={item.id} className="attention-chip">
            <b>{reasons}</b> {item.title}
          </span>
        );
      })}
      {data && !items.length && !next && <p className="attention-clear">No blocked tasks, failed runs, or stale reports in this project.</p>}
      {next && (
        <button className="secondary" onClick={() => void more()}>
          Load more attention items
        </button>
      )}
      {error && <p role="alert" className="error">{error}</p>}
      {data && (
        <p className="dash-summary">
          <span className="sr-only">Across active projects:</span>
          <span><b>{data.metrics.reportingAgents}</b> {data.metrics.reportingAgents === 1 ? "agent" : "agents"} reporting</span>
          <span><b>{data.metrics.awaitingReview}</b> awaiting review</span>
          <span><b>{data.metrics.failedRunsToday}</b> failed {data.metrics.failedRunsToday === 1 ? "run" : "runs"} today</span>
          <span><b>{data.metrics.completedToday}</b> completed today</span>
        </p>
      )}
    </section>
  );
}

const nodeTone: Record<string, string> = { succeeded: "ok", running: "live", failed: "fail", cancelled: "fail", pending: "pending" };
function WorkflowSheet({ projectId }: { projectId: string }) {
  const workflows = useRead(`/workflows?projectId=${projectId}&limit=20`, workflowsResponse);
  const workflow = workflows.data?.data.items[0];
  return (
    <section className="sheet span-8" aria-labelledby="workflow-heading">
      <SheetHead id="workflow-heading" title={workflow?.name ?? "Workflow"} variant={1}>
        {workflow && (
          <Link className="view-all" href={`/projects/${projectId}/workflows?workflowId=${workflow.id}`}>
            Open workflow
          </Link>
        )}
      </SheetHead>
      <QueryFeedback error={workflows.error} loading={workflows.isPending} retry={() => void workflows.refetch()} />
      {workflows.data && !workflow && (
        <EmptyNote title="No workflow published yet">Register a workflow and an immutable plan with the CLI. Its graph appears here.</EmptyNote>
      )}
      {workflow && <LatestPlan projectId={projectId} workflowId={workflow.id} />}
    </section>
  );
}
function LatestPlan({ projectId, workflowId }: { projectId: string; workflowId: string }) {
  const revisions = useRead(`/workflows/${workflowId}/revisions?limit=20`, revisionsResponse);
  const revision = revisions.data?.data.items[0];
  if (!revision) return <QueryFeedback error={revisions.error} loading={revisions.isPending} retry={() => void revisions.refetch()} />;
  return <PlanAttempt projectId={projectId} workflowId={workflowId} revisionId={revision.id} revisionNumber={revision.revision} plan={revision} />;
}
function PlanAttempt({ projectId, workflowId, revisionId, revisionNumber, plan }: { projectId: string; workflowId: string; revisionId: string; revisionNumber: number; plan: WorkflowPlan }) {
  const runs = useRead(`/workflow-runs?workflowId=${workflowId}&planRevisionId=${revisionId}&limit=20`, workflowRunsResponse);
  const runId = runs.data?.data.items[0]?.id;
  return runId ? (
    <ObservedPlan key={runId} {...{ projectId, workflowId, revisionId, revisionNumber, plan, runId }} />
  ) : (
    <>
      <div className="graph-meta">
        <span>Revision {revisionNumber}</span>
        <span>{runs.data ? "No workflow attempt registered for this revision." : "Loading attempts…"}</span>
      </div>
      <PlanGraph {...{ projectId, workflowId, revisionId, plan }} states={new Map()} />
    </>
  );
}
function ObservedPlan({ projectId, workflowId, revisionId, revisionNumber, plan, runId }: { projectId: string; workflowId: string; revisionId: string; revisionNumber: number; plan: WorkflowPlan; runId: string }) {
  const snapshot = useRead(`/workflow-runs/${runId}/snapshot`, workflowRunDetailResponse);
  const run = snapshot.data?.data;
  const states = useMemo(() => new Map((run?.nodes ?? []).map((node) => [node.nodeId, node.observation?.payload.state ?? "Unknown"])), [run]);
  return (
    <>
      <div className="graph-meta">
        {run && <ReportingLabel run={run} />}
        <span>Revision {revisionNumber}</span>
        {run && (
          <span>
            Last received <time dateTime={run.lastReceivedAt}>{clock(run.lastReceivedAt)}</time> · Sequence {run.lastSequence}
          </span>
        )}
        <span>Read-only plan. Select a node to inspect its reported evidence.</span>
      </div>
      <PlanGraph {...{ projectId, workflowId, revisionId, plan }} states={states} />
    </>
  );
}
function PlanGraph({ projectId, workflowId, revisionId, plan, states }: { projectId: string; workflowId: string; revisionId: string; plan: WorkflowPlan; states: Map<string, string> }) {
  const router = useRouter();
  const inspect = (nodeId: string) =>
    router.push(`/projects/${projectId}/workflows?${new URLSearchParams({ workflowId, revisionId, nodeId, focus: "node" })}`);
  const nodes = useMemo<Node[]>(() => {
    const labels = new Map(plan.nodes.map((node) => [node.id, node.label]));
    return graphLayout(plan).map((node) => {
      const state = states.get(node.id) ?? "Unknown";
      return {
        ...node,
        position: { x: node.position.x * 0.62, y: node.position.y * 0.62 },
        width: 150,
        height: 62,
        className: `node-state-${nodeTone[state] ?? "pending"}`,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        ariaLabel: `${labels.get(node.id)} · ${state}`,
        data: {
          label: (
            <span className="flow-node">
              <b className="workflow-node-title">{labels.get(node.id)}</b>
              <span className="state">{state}</span>
            </span>
          ),
        },
      };
    });
  }, [plan, states]);
  const edges: Edge[] = plan.edges.map((edge, index) => ({
    id: String(index),
    source: edge.source,
    target: edge.target,
    markerEnd: { type: MarkerType.ArrowClosed, color: "#5e5a54" },
  }));
  return (
    <div className="flow-preview">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodesFocusable
        nodesDraggable={false}
        nodesConnectable={false}
        edgesReconnectable={false}
        elementsSelectable={false}
        deleteKeyCode={null}
        onNodeClick={(_, node) => inspect(node.id)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          const id = (event.target as HTMLElement).closest("[data-id]")?.getAttribute("data-id");
          if (id) {
            event.preventDefault();
            inspect(id);
          }
        }}
        ariaLabelConfig={{ "node.a11yDescription.default": "Read-only plan node. Press Enter to inspect its reported evidence." }}
        fitView
        minZoom={0.1}
        fitViewOptions={{ duration: 0, maxZoom: 1, padding: 0.12 }}
        proOptions={{ hideAttribution: true }}
      >
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  );
}

function AgentsSheet({ onOpen }: { onOpen: (panel: Panel) => void }) {
  const query = useRead("/tracking/agents?limit=50", trackingAgentsResponse);
  const agents = query.data?.data.items ?? [];
  return (
    <section className="sheet span-4" aria-labelledby="agents-heading">
      <SheetHead id="agents-heading" title="Agents" variant={2}>
        <Link className="view-all" href="/agents">View all</Link>
      </SheetHead>
      <p className="metadata">Reported by your tools. AgentFlow only observes.</p>
      <QueryFeedback error={query.error} loading={query.isPending} retry={() => void query.refetch()} />
      {query.data && !agents.length && <EmptyNote title="No agents reported yet">Agents appear when an external producer registers them.</EmptyNote>}
      <ul className="feed scroll-list">
        {agents.map((agent) => (
          <li key={agent.id}>
            <div className="feed-top">
              <a className="agent-name" href={`/agents/${agent.id}`} onClick={(event) => opensPanel(event, () => onOpen({ kind: "agent", id: agent.id, title: agent.displayName }))}>
                {agent.displayName}
              </a>
              {agent.staleActive > 0 && (
                <span className="report-label report-stale">
                  <StateIcon tone="stale" />
                  Stale · {agent.staleActive} active {agent.staleActive === 1 ? "run" : "runs"} without a recent report
                </span>
              )}
            </div>
            <p className="metadata break-word">{agent.source} · {agent.defaultRole}</p>
            <p className="metadata">
              {agent.freshRunning} fresh running · {agent.queuedNoReport} queued, no report · {agent.staleActive} stale active
            </p>
          </li>
        ))}
      </ul>
      <CodexLink />
    </section>
  );
}

function RunsSheet({ projectId, onOpen }: { projectId: string; onOpen: (panel: Panel) => void }) {
  const query = useRead(`/tracking/runs?limit=20&projectId=${projectId}`, trackingRunsResponse);
  const runs = query.data?.data.items ?? [];
  return (
    <section className="sheet span-5" aria-labelledby="runs-heading">
      <SheetHead id="runs-heading" title="Recent runs" variant={3}>
        {query.data && <span className="metadata">{query.data.data.total} registered</span>}
        <Link className="view-all" href="/agents">View all</Link>
      </SheetHead>
      <QueryFeedback error={query.error} loading={query.isPending} retry={() => void query.refetch()} />
      {query.data && !runs.length && <EmptyNote title="No runs reported yet">Runs appear when your harness registers an attempt for a task.</EmptyNote>}
      <ul className="feed scroll-list">
        {runs.map((run) => (
          <li key={run.id}>
            <div className="feed-top">
              <ReportingLabel run={run} />
              <a href={`/runs/${run.id}`} onClick={(event) => opensPanel(event, () => onOpen({ kind: "run", id: run.id, title: `${run.purpose} · ${run.agentName}` }))}>
                {run.taskTitle ?? "Project planning attempt"}
              </a>
            </div>
            <p className="metadata">
              {run.purpose} · {run.agentName} · last report <time dateTime={run.lastReceivedAt}>{clock(run.lastReceivedAt)}</time>
            </p>
            {run.message && <p className="metadata break-word">{excerpt(run.message)}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ActivitySheet({ projectId, onOpen }: { projectId: string; onOpen: (panel: Panel) => void }) {
  const query = useRead(`/activity?limit=30&projectId=${projectId}`, activityResponse);
  const items = query.data?.data.items ?? [];
  return (
    <section className="sheet span-4" aria-labelledby="activity-heading">
      <SheetHead id="activity-heading" title="Activity" variant={4}>
        <Link className="view-all" href={`/activity?projectId=${projectId}`}>View all activity</Link>
      </SheetHead>
      <QueryFeedback error={query.error} loading={query.isPending} retry={() => void query.refetch()} />
      {query.data && !items.length && <EmptyNote title="Quiet so far">Reports appear here when an external producer sends them.</EmptyNote>}
      <ol className="feed scroll-list">
        {items.map((item) => {
          const payload = item.event?.payload;
          const detail = item.reason ?? (payload && "message" in payload ? payload.message : payload && "summary" in payload ? payload.summary : null);
          return (
            <li key={item.id} className="feed-time">
              <time dateTime={item.receivedAt}>{clock(item.receivedAt)}</time>
              <span>
                <a className="what" href={`/runs/${item.runId}`} onClick={(event) => opensPanel(event, () => onOpen({ kind: "run", id: item.runId, title: `${item.purpose} · ${item.agentName}` }))}>
                  {item.kind === "tracking_closed" ? "Human closed tracking" : item.event!.type.replace("run.", "Reported ")}
                </a>{" "}
                · {item.agentName}
              </span>
              <span className="metadata break-word">{detail ? excerpt(detail, 110) : (item.taskTitle ?? item.projectName)}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function today() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}
const tokens = (value: string) => BigInt(value).toLocaleString("en-US");
function UsageSheet({ projectId }: { projectId: string }) {
  const [day] = useState(today);
  const query = useRead(`/usage?from=${encodeURIComponent(day.from)}&limit=50&projectId=${projectId}&to=${encodeURIComponent(day.to)}`, usageResponse);
  const value = query.data?.data;
  const largest = value?.groups.reduce((max, group) => (BigInt(group.knownTotalTokens) > max ? BigInt(group.knownTotalTokens) : max), BigInt(0)) ?? BigInt(0);
  return (
    <section className="sheet span-3" aria-labelledby="usage-heading">
      <SheetHead id="usage-heading" title="Usage" variant={0}>
        <Link className="view-all" href="/usage">Details</Link>
      </SheetHead>
      <QueryFeedback error={query.error} loading={query.isPending} retry={() => void query.refetch()} />
      {value && (
        <>
          <p className="metadata">Reported tokens · today, {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
          {value.filteredReportCount ? (
            <>
              <p className="usage-total">{tokens(value.knownTotalTokens)}</p>
              <p className="metadata">
                tokens from complete reports · {value.runsWithReports} of {value.eligibleRuns} runs reported
              </p>
              <dl className="usage-kv">
                <dt>Known input</dt>
                <dd>{tokens(value.knownInputTokens)}</dd>
                <dt>Known output</dt>
                <dd>{tokens(value.knownOutputTokens)}</dd>
                <dt>Unknown total reports</dt>
                <dd>{value.unknownTotalReports}</dd>
              </dl>
              <ul className="usage-bars">
                {value.groups.map((group) => {
                  const total = BigInt(group.knownTotalTokens);
                  const width = largest ? Number((total * BigInt(100)) / largest) : 0;
                  return (
                    <li key={JSON.stringify([group.source, group.model])}>
                      <span className="label">
                        <span>{group.source} · {group.model}</span>
                        <b>{total ? tokens(group.knownTotalTokens) : "unknown"}</b>
                      </span>
                      <span className="bar" aria-hidden="true">
                        <i style={{ width: `${width}%` }} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <p>
              No usage reported today. {value.eligibleRuns} eligible {value.eligibleRuns === 1 ? "run" : "runs"}; usage is unknown.
            </p>
          )}
          <div className="estimate-note">
            <h3 className="hand">Cost estimate</h3>
            <p className="metadata">No price snapshot selected, so no cost is shown.</p>
            <Link href="/usage">Choose a price snapshot</Link>
          </div>
        </>
      )}
    </section>
  );
}
