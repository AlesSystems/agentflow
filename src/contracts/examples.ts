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
  reviewRequired: false, verificationRequired: false, reworkRound: 0,
  createdAt: time,
  updatedAt: time,
  completedAt: null,
};
const readiness = {ready:true,prerequisites:[],blockedPrerequisiteIds:[]};
const gate = {required:false,approved:false,changesRequested:false,latestDecision:null};
const evidence = {currentArtifact:null,review:gate,verification:gate,implementationCurrent:true};
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
        items: status === "backlog" ? [{...task,readiness,evidence}] : [],
        total: status === "backlog" ? 1 : 0,
        nextCursor: null,
      }),
    ),
  }),
  listTasks: snapshot(list({...task,readiness,evidence})),
  createTask: snapshot(task),
  getTask: snapshot({
    task, readiness, evidence,
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
    task, readiness, evidence,
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
  artifactRef:null, reworkRound:null,
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
  trackingRuns: snapshot(list(runSummary)), trackingRun: snapshot(runSummary), trackingTasks: snapshot(list({ ...task, readiness, evidence, latestAttempt: runSummary })),
  trackingBoard: snapshot({ columns: ["backlog", "in_progress", "review", "completed"].map(status => ({ status, items: status === "backlog" ? [{ ...task, readiness, evidence, latestAttempt: null }] : [], total: status === "backlog" ? 1 : 0, nextCursor: null })) }),
  activity: snapshot(list({ id: "event:" + eventId, kind: "report", runId, projectId, agentId, taskId, agentName: observedAgent.displayName, agentSource: observedAgent.source, projectName: project.name, taskTitle: task.title, purpose: observedRun.purpose, model: null, receivedAt: time, occurredAt: time, event: { ...event, receivedAt: time }, reason: null })),
});
const workflowId = "10000000-0000-4000-8000-000000000011";
const revisionId = "10000000-0000-4000-8000-000000000012";
const nodeId = "10000000-0000-4000-8000-000000000013";
const workflowExample = { id: workflowId, projectId, name: "Synthetic workflow", version: 1, createdAt: time };
const revisionExample = { id: revisionId, workflowId, revision: 1, nodes: [{ id: nodeId, label: "Implementation", taskId }], edges: [], createdAt: time };
Object.assign(requestExamples, {
 createWorkflow: { id: workflowId, projectId, name: workflowExample.name }, listWorkflows: { projectId }, getWorkflow: {}, createWorkflowRevision: { id: revisionId, expectedWorkflowVersion: 1, nodes: revisionExample.nodes, edges: [] }, listWorkflowRevisions: {}, getWorkflowRevision: {},
});
Object.assign(responseExamples, { createWorkflow: snapshot(workflowExample), listWorkflows: snapshot(list(workflowExample)), getWorkflow: snapshot(workflowExample), createWorkflowRevision: snapshot({id:revisionId,workflowId,revision:1,createdAt:time}), listWorkflowRevisions: snapshot(list(revisionExample)), getWorkflowRevision: snapshot(revisionExample) });
const workflowRunId = "10000000-0000-4000-8000-000000000014";
const workflowRunExample = { id: workflowRunId, projectId, workflowId, planRevisionId: revisionId, state: "queued", version: 1, lastSequence: 0, lastReceivedAt: time, createdAt: time, startedAt: null, endedAt: null, freshness: { stale: false, reporting: "no_report_received" } };
const workflowEventExample = { schemaVersion: 1, eventId: factId, workflowRunId, sequence: 1, occurredAt: time, type: "workflow.started", payload: {} };
const workflowNodeExample = { ...workflowEventExample, sequence: 2, type: "workflow.node.reported", payload: { nodeId, state: "running", runId }, receivedAt: time };
Object.assign(requestExamples, { registerWorkflowRun: { id: workflowRunId, workflowId, planRevisionId: revisionId }, listWorkflowRuns: { workflowId }, getWorkflowRun: {}, getWorkflowRunSnapshot: {}, ingestWorkflowEvent: workflowEventExample, listWorkflowEvents: {}, listWorkflowNodeObservations: {}, closeWorkflowRun: { expectedVersion: 1, reason: "Synthetic stale closure" } });
Object.assign(responseExamples, { registerWorkflowRun: snapshot(workflowRunExample), listWorkflowRuns: snapshot(list(workflowRunExample)), getWorkflowRun: snapshot(workflowRunExample), getWorkflowRunSnapshot: snapshot({ ...workflowRunExample, closure: null, nodes: [{ nodeId, label: "Implementation", taskId, observation: null, linkedAttempt: null }] }), ingestWorkflowEvent: snapshot({ eventId: factId, workflowRunId, acceptedSequence: 1, receivedAt: time }), listWorkflowEvents: snapshot(list({ ...workflowEventExample, receivedAt: time })), listWorkflowNodeObservations: snapshot(list(workflowNodeExample)), closeWorkflowRun: snapshot({ ...workflowRunExample, state: "interrupted", version: 2, endedAt: time, freshness: { stale: false, reporting: "terminal" } }) });

export const taskRegistrationExample = snapshot({kind:"task",id:taskId,projectId,parentTaskId:null,assignedAgentId:null,version:1,workRevision:1});

Object.assign(requestExamples, { replaceDependencies:{expectedVersion:1,prerequisiteIds:[]},editReviewPolicy:{expectedVersion:1,reviewRequired:true,verificationRequired:false},publishArtifact:{expectedVersion:1,artifactRef:"synthetic:commit"},requestRework:{expectedVersion:1,reason:"Synthetic changes requested"},getReadiness:{},listArtifacts:{} });
Object.assign(responseExamples, { replaceDependencies:snapshot({...task,version:2}),editReviewPolicy:snapshot({...task,version:2,reviewRequired:true}),publishArtifact:snapshot({...task,version:2}),requestRework:snapshot({...task,version:2,workRevision:2,reworkRound:1}),getReadiness:snapshot(readiness),listArtifacts:snapshot({items:[],total:0,nextCursor:null}) });

Object.assign(requestExamples,{listGateDecisions:{},listReworks:{}});
Object.assign(responseExamples,{listGateDecisions:snapshot({items:[],total:0,nextCursor:null}),listReworks:snapshot({items:[],total:0,nextCursor:null})});

Object.assign(requestExamples,{getWorkflowReadiness:{}});
Object.assign(responseExamples,{getWorkflowReadiness:snapshot({workflowId,revisionId,tasks:[{...task,readiness,evidence}]})});

const githubConnectionExample={enabled:false,repositories:[],version:1,lastAttemptedAt:null,lastFetchedAt:null,lastError:null,retryNotBefore:null,credential:"unavailable",busy:false};
Object.assign(requestExamples,{getGithubConnection:{},replaceGithubRepositories:{expectedVersion:1,enabled:true,repositories:["synthetic/example"]},refreshGithub:{expectedVersion:2,repository:"synthetic/example",page:1}});
Object.assign(responseExamples,{getGithubConnection:snapshot({connection:githubConnectionExample,items:[],total:0,nextCursor:null,lookupAttempt:null}),replaceGithubRepositories:snapshot({...githubConnectionExample,enabled:true,repositories:["synthetic/example"],version:2}),refreshGithub:snapshot({repository:"synthetic/example",page:1,number:null,outcome:"failed",error:"credential_unavailable",attemptedAt:time,fetchedAt:null,nextPage:null,count:0})});

const exportCounts={project:1,task:0,agent:0,comment:0,completion:0,reopen:0,dependency:0,artifact:0,decision:0,rework:0,runClosure:0,workflowClosure:0};
export const historyExportExamples=[
  {kind:"manifest",schemaVersion:2,generation:"10000000-0000-4000-8000-000000000004",snapshotCursor:"0",createdAt:time,content:["tasks"],counts:exportCounts},
  {kind:"project",data:{id:project.id,name:project.name,archivedAt:project.archivedAt,version:project.version,createdAt:project.createdAt,updatedAt:project.updatedAt}},
  {kind:"complete",schemaVersion:2,counts:exportCounts},
];
Object.assign(requestExamples,{exportHistory:{content:"tasks",generation:"10000000-0000-4000-8000-000000000004"}});
Object.assign(responseExamples,{exportHistory:historyExportExamples[0]});

const retentionPreviewExample={previewId:"10000000-0000-4000-8000-000000000010",cutoff:time,expiresAt:time,expectedGeneration:"10000000-0000-4000-8000-000000000004",expectedVersion:1,candidateDigest:"a".repeat(64),counts:{eventPayloads:0,changes:0},hasMore:{eventPayloads:false,changes:false}};
Object.assign(requestExamples,{previewRetention:{cutoff:time},pruneRetention:{previewId:retentionPreviewExample.previewId,expectedGeneration:retentionPreviewExample.expectedGeneration,expectedVersion:1,candidateDigest:retentionPreviewExample.candidateDigest}});
Object.assign(responseExamples,{previewRetention:snapshot(retentionPreviewExample),pruneRetention:snapshot({previewId:retentionPreviewExample.previewId,applied:{eventPayloads:0,changes:0},prunedAt:time,priorGeneration:retentionPreviewExample.expectedGeneration,generation:"10000000-0000-4000-8000-000000000011",retentionVersion:2,displayBodyBytesRemoved:0})});

const usagePriceExample={id:factId,name:"Synthetic local quote",capturedAt:time,effectiveAt:null,createdAt:time,entries:[{source:"fixture",model:"model",currency:"USD",inputPrice:"1",outputPrice:"2"}]};
Object.assign(requestExamples,{getUsage:{projectId,from:time,to:"2026-10-10T00:00:00.000Z"},listUsagePrices:{},createUsagePriceSnapshot:{id:factId,name:usagePriceExample.name,capturedAt:time,entries:usagePriceExample.entries}});
Object.assign(responseExamples,{getUsage:snapshot({projectId,from:time,to:"2026-10-10T00:00:00.000Z",source:null,model:null,eligibleRuns:0,runsWithReports:0,runsWithoutReports:0,filteredReportCount:0,filteredRunsWithReports:0,knownInputTokens:"0",knownOutputTokens:"0",knownTotalTokens:"0",unknownInputReports:0,unknownOutputReports:0,unknownTotalReports:0,groups:[],totalGroups:0,groupsTruncated:false,runDetails:[],totalRuns:0,nextCursor:null,estimate:null}),listUsagePrices:snapshot({items:[usagePriceExample],total:1,nextCursor:null}),createUsagePriceSnapshot:snapshot(usagePriceExample)});

const codexConnectionExample = {state: "connected", observedAt: time, message: "Local stored history. Live desktop status is unavailable."};
const codexChatExample = {id: taskId, title: "Synthetic Codex task", cwd: null, updatedAt: time, parentId: null, agentNickname: null, agentRole: null, model: null, status: "unknown", statusSource: "stored", archived: false};
Object.assign(requestExamples, {listCodexChats: {}, getCodexChat: {}});
Object.assign(responseExamples, {
  listCodexChats: {connection: codexConnectionExample, data: [codexChatExample], nextCursor: null},
  getCodexChat: {connection: codexConnectionExample, data: {chat: codexChatExample, turns: [], agents: [], nextTurnsCursor: null, nextAgentsCursor: null}},
});
