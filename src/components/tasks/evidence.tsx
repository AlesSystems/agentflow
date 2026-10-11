"use client";
import type { TaskReadiness, TaskGateSummary } from "../../contracts/evidence";
import type { Task, TaskSnapshot } from "../../contracts/tasks";
import { evidenceResponse, decisionsResponse, reworksResponse } from "../../contracts/evidence";
import { usePaged } from "../../client/paged";
export function AcceptanceFacts({task,readiness,evidence,headingLevel=3}:{task:Task;readiness:TaskReadiness;evidence:TaskGateSummary;headingLevel?:2|3}) {
  const Heading=headingLevel === 2 ? "h2" : "h3";
  return <section className="acceptance-facts" aria-label="Current acceptance requirements" data-task-id={task.id} data-task-version={task.version} data-review-event-id={evidence.review.latestDecision?.eventId ?? ""} data-review-decision={evidence.review.changesRequested ? "changes_requested" : evidence.review.approved ? "approved" : "none"} data-work-revision={task.workRevision} data-rework-round={task.reworkRound} data-artifact-ref={evidence.currentArtifact?.artifactRef ?? ""} data-ready={readiness.ready}>
    <Heading className="task-section-heading">Current acceptance requirements</Heading>
    <p>Revision {task.workRevision} · Rework round {task.reworkRound}</p>
    <p>{readiness.ready ? "Prerequisites ready" : "Prerequisites blocked"}</p>
    {!readiness.prerequisites.length && <p className="metadata">No prerequisites recorded.</p>}
    {readiness.prerequisites.length > 0 && <ul>{readiness.prerequisites.map(p=><li key={p.taskId} className="break-word">{p.taskId} · Current revision {p.currentWorkRevision} · Accepted revision {p.acceptedWorkRevision ?? "None"} · {p.reason === null ? "Accepted current work" : p.reason === "not_completed" ? "Human acceptance needed" : "Acceptance is obsolete"}</li>)}</ul>}
    {!evidence.implementationCurrent && <p className="notice">A successful implementation on the current revision is needed. Replacing an artifact does not update an older implementation.</p>}
    {evidence.currentArtifact ? <><p className="break-word">Current artifact: {evidence.currentArtifact.artifactRef}</p>{evidence.currentArtifact.displayUrl && <p className="break-word">Artifact display URL (inert text): {evidence.currentArtifact.displayUrl}</p>}</> : <p>No current artifact reference.</p>}
    {(["review","verification"] as const).map(purpose=>{const gate=evidence[purpose];return <div key={purpose}><p>{purpose === "review" ? "Review" : "Verification"} · {gate.required ? "Required" : "Optional"} · {gate.changesRequested ? "Changes requested" : gate.approved ? "Reported approval" : "No current reported approval"}</p>{gate.latestDecision && <p className="preserve-lines">{gate.latestDecision.evidenceNote}</p>}{gate.required && gate.changesRequested && <p className="notice">Changes requested on this tuple remain blocking even after another approval. New work or rework needs fresh evidence.</p>}</div>;})}
    <p className="metadata">Reported evidence never completes a task. Human acceptance remains separate.</p>
  </section>;
}
export function ReportedEvidenceHistory({id,task,currentArtifact}:{id:string;task:Task;currentArtifact:string|null}) {
  const artifacts=usePaged(`/tasks/${id}/artifacts?limit=20`,evidenceResponse),decisions=usePaged(`/tasks/${id}/decisions?limit=20`,decisionsResponse),reworks=usePaged(`/tasks/${id}/reworks?limit=20`,reworksResponse);
  return <details className="evidence-history"><summary>Artifact, review and rework history</summary>
    <h3>Reported artifacts</h3>{artifacts.items.map(a=><article key={a.id}><p className="break-word">{a.artifactRef}</p><p>Revision {a.workRevision} · Round {a.reworkRound} · {a.workRevision===task.workRevision&&a.reworkRound===task.reworkRound&&a.artifactRef===currentArtifact ? "Current" : "Obsolete"}</p>{a.displayUrl&&<p className="break-word">Display URL (inert text): {a.displayUrl}</p>}</article>)}
    <h3>Reported gate decisions</h3>{decisions.items.map(d=><article key={d.id}><p>{d.purpose} · {d.decision.replaceAll("_"," ")} · {d.workRevision===task.workRevision&&d.reworkRound===task.reworkRound&&d.artifactRef===currentArtifact ? "Current tuple" : "Obsolete tuple"}</p><p className="break-word">Revision {d.workRevision} · Round {d.reworkRound} · {d.artifactRef}</p><p className="preserve-lines">{d.evidenceNote}</p></article>)}
    <h3>Rework reasons</h3>{reworks.items.map(r=><article key={r.id}><p>Revision {r.workRevision} · Round {r.reworkRound}</p><p className="preserve-lines">{r.reason}</p></article>)}
    {[{page:artifacts,label:"artifacts"},{page:decisions,label:"decisions"},{page:reworks,label:"reworks"}].map(({page,label})=><div key={label}>{page.query.isPending&&<p>Loading {label}…</p>}{(page.error||page.query.error)&&<p role="alert">Could not load {label}. <button onClick={()=>void page.query.refetch()}>Retry {label}</button></p>}{page.next&&<button disabled={page.busy} onClick={()=>void page.more()}>Load more {label}</button>}</div>)}
  </details>;
}

export function acceptanceLabel(task:TaskSnapshot) {
  if(!task.readiness.ready)return `Prerequisites blocked (${task.readiness.blockedPrerequisiteIds.length})`;
  if(!task.evidence.implementationCurrent)return "Current implementation needed";
  for(const gate of [task.evidence.review,task.evidence.verification]) {
    if(gate.required&&gate.changesRequested)return "Changes requested";
    if(gate.required&&!gate.approved)return "Required approval needed";
  }
  return task.status === "completed" ? "Human accepted" : "Prerequisites ready";
}
