import type { ReviewTuple, TaskGateSummary } from "../contracts/evidence";
import { Conflict } from "../domain/tasks";
export function sameTuple(a: ReviewTuple | null, b: ReviewTuple | null) {
  return !!a && !!b && a.workRevision === b.workRevision && a.artifactRef === b.artifactRef && a.reworkRound === b.reworkRound;
}
export function assertAcceptanceEvidence(summary: TaskGateSummary) {
  for (const gate of [summary.review, summary.verification]) {
    if (!gate.required) continue;
    if (!summary.currentArtifact) throw new Conflict("artifact_required");
    if (gate.changesRequested) throw new Conflict("changes_requested");
    if (!gate.approved) throw new Conflict("approval_required");
  }
}
