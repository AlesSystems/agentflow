const projectId = "10000000-0000-4000-8000-000000000001";
const taskId = "10000000-0000-4000-8000-000000000002";
const factId = "10000000-0000-4000-8000-000000000003";
const time = "2026-10-09T00:00:00.000Z";
const project = {
  id: projectId,
  name: "Synthetic project",
  repositoryPath: null,
  archivedAt: null,
  version: 1,
  createdAt: time,
  updatedAt: time,
};
const task = {
  id: taskId,
  projectId,
  parentTaskId: null,
  title: "Synthetic task",
  description: "",
  acceptanceCriteria: "",
  status: "backlog",
  priority: "normal",
  tags: [],
  assignedAgentId: null,
  targetRole: null,
  branch: null,
  pullRequestUrl: null,
  blockedReason: null,
  version: 1,
  workRevision: 1,
  createdAt: time,
  updatedAt: time,
  completedAt: null,
};
const comment = {
  id: factId,
  taskId,
  text: "Synthetic comment",
  actor: "operator",
  createdAt: time,
};
const completion = {
  id: factId,
  taskId,
  workRevision: 1,
  implementationRunId: null,
  actor: "operator",
  evidenceNote: "Synthetic browser acceptance fixture",
  evidenceUrl: null,
  acceptedAt: time,
};
const settings = {
  timezone: "UTC",
  version: 1,
  dataLocation: "/private/synthetic-agentflow",
  storageBytes: 4096,
  storageMeasurement: "observational",
};
const list = (item: unknown) => ({ items: [item], total: 1, nextCursor: null });
const snapshot = (data: unknown) => ({
  data,
  snapshotCursor: "0",
  generation: "10000000-0000-4000-8000-000000000004",
});
export const requestExamples: Record<string, unknown> = {
  listProjects: {},
  createProject: { name: project.name },
  getProject: {},
  patchProject: { expectedVersion: 1, name: "Updated synthetic project" },
  getBoard: {},
  listTasks: { projectId },
  createTask: { projectId, title: task.title },
  getTask: {},
  patchTask: { expectedVersion: 1, status: "review" },
  completeTask: { expectedVersion: 2, evidenceNote: completion.evidenceNote },
  reopenTask: { expectedVersion: 3, reason: "Synthetic rework" },
  listComments: {},
  createComment: { text: comment.text },
  getSettings: {},
  patchSettings: { expectedVersion: 1, timezone: "Europe/London" },
  getOverview: { timezone: "UTC" },
};
export const responseExamples: Record<string, unknown> = {
  listProjects: snapshot(list(project)),
  createProject: snapshot(project),
  getProject: snapshot(project),
  patchProject: snapshot({
    ...project,
    name: "Updated synthetic project",
    version: 2,
  }),
  getBoard: snapshot({
    columns: ["backlog", "in_progress", "review", "completed"].map(
      (status) => ({
        status,
        items: status === "backlog" ? [task] : [],
        total: status === "backlog" ? 1 : 0,
        nextCursor: null,
      }),
    ),
  }),
  listTasks: snapshot(list(task)),
  createTask: snapshot(task),
  getTask: snapshot({
    task,
    currentCompletion: null,
    latestRun: null,
    history: {
      commentsUrl: `/api/v1/tasks/${taskId}/comments`,
      completions: { items: [], nextCursor: null, nextUrl: null },
      reopens: { items: [], nextCursor: null, nextUrl: null },
    },
  }),
  patchTask: snapshot({ ...task, status: "review", version: 2 }),
  completeTask: snapshot(completion),
  reopenTask: snapshot({ ...task, version: 4, workRevision: 2 }),
  listComments: snapshot(list(comment)),
  createComment: snapshot(comment),
  getSettings: snapshot(settings),
  patchSettings: snapshot({
    ...settings,
    timezone: "Europe/London",
    version: 2,
  }),
  getOverview: snapshot({
    metrics: {
      activeProjects: 1,
      reportingAgents: 0,
      completedToday: 0,
      awaitingReview: 0,
      failedRunsToday: 0,
    },
    attention: { items: [], total: 0, nextCursor: null },
    timezone: "UTC",
    capturedAt: time,
    day: { start: time, end: "2026-10-10T00:00:00.000Z" },
  }),
};
export const detailContinuationExample = {
  data: {
    task,
    currentCompletion: null,
    latestRun: null,
    history: {
      commentsUrl: `/api/v1/tasks/${taskId}/comments`,
      completions: { items: [completion], nextCursor: null, nextUrl: null },
      reopens: null,
    },
  },
  snapshotCursor: "0",
  generation: "10000000-0000-4000-8000-000000000004",
};
const agentId = "10000000-0000-4000-8000-000000000005";
const runId = "20000000-0000-4000-8000-000000000001";
const eventId = "30000000-0000-4000-8000-000000000001";
const observedAgent = {
  id: agentId,
  displayName: "Synthetic agent",
  source: "fixture",
  defaultRole: "implementation",
  version: 1,
  createdAt: time,
  reporting: false,
  activeRunsUrl: `/api/v1/runs?agentId=${agentId}&state=running`,
  queuedRunsUrl: `/api/v1/runs?agentId=${agentId}&state=queued`,
  historyUrl: `/api/v1/runs?agentId=${agentId}`,
};
const observedRun = {
  id: runId,
  projectId,
  agentId,
  taskId,
  purpose: "implementation",
  model: null,
  workRevision: 2,
  state: "queued",
  lastSequence: 0,
  lastReceivedAt: time,
  startedAt: null,
  endedAt: null,
  version: 1,
  createdAt: time,
  freshness: { stale: false, reporting: "no_report_received" },
};
const event = {
  schemaVersion: 1,
  eventId,
  runId,
  sequence: 1,
  type: "run.started",
  occurredAt: time,
  payload: {},
};
Object.assign(requestExamples, {
  listAgents: {},
  createAgent: {
    displayName: "Synthetic agent",
    source: "fixture",
    defaultRole: "implementation",
  },
  getAgent: {},
  patchAgent: { expectedVersion: 1, displayName: "Updated agent" },
  listRuns: {},
  registerRun: {
    id: runId,
    projectId,
    agentId,
    taskId,
    purpose: "implementation",
    expectedTaskVersion: 1,
  },
  getRun: {},
  listEvents: {},
  ingestEvent: event,
  closeRun: { expectedVersion: 1, reason: "Synthetic stale tracking closure" },
});
Object.assign(responseExamples, {
  listAgents: snapshot(list(observedAgent)),
  createAgent: snapshot(observedAgent),
  getAgent: snapshot(observedAgent),
  patchAgent: snapshot({
    ...observedAgent,
    version: 2,
    displayName: "Updated agent",
  }),
  listRuns: snapshot(list(observedRun)),
  registerRun: snapshot(observedRun),
  getRun: snapshot(observedRun),
  listEvents: snapshot(list({ ...event, receivedAt: time })),
  ingestEvent: snapshot({
    eventId,
    runId,
    acceptedSequence: 1,
    receivedAt: time,
  }),
  closeRun: snapshot({
    ...observedRun,
    state: "interrupted",
    version: 2,
    endedAt: time,
    freshness: { stale: false, reporting: "terminal" },
  }),
});
const runSummary = { ...observedRun, agentName: observedAgent.displayName, agentSource: observedAgent.source, projectName: project.name, taskTitle: task.title, message: null, evidenceUrl: null };
Object.assign(requestExamples, { trackingAgents: {}, trackingRuns: {}, trackingRun: {}, trackingTasks: { projectId }, trackingBoard: {}, activity: { projectId } });
Object.assign(responseExamples, {
  trackingAgents: snapshot(list({ id: agentId, displayName: observedAgent.displayName, source: observedAgent.source, defaultRole: observedAgent.defaultRole, version: 1, createdAt: time, freshRunning: 0, queuedNoReport: 1, staleActive: 0 })),
  trackingRuns: snapshot(list(runSummary)), trackingRun: snapshot(runSummary), trackingTasks: snapshot(list({ ...task, latestAttempt: runSummary })),
  trackingBoard: snapshot({ columns: ["backlog", "in_progress", "review", "completed"].map(status => ({ status, items: status === "backlog" ? [{ ...task, latestAttempt: null }] : [], total: status === "backlog" ? 1 : 0, nextCursor: null })) }),
  activity: snapshot(list({ id: "event:" + eventId, kind: "report", runId, projectId, agentId, taskId, agentName: observedAgent.displayName, agentSource: observedAgent.source, projectName: project.name, taskTitle: task.title, purpose: observedRun.purpose, model: null, receivedAt: time, occurredAt: time, event: { ...event, receivedAt: time }, reason: null })),
});
