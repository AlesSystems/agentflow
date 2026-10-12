import type Database from "better-sqlite3";
import type { UsagePayload } from "../contracts/usage";
import { canonicalDigest } from "../domain/request-digest";
import { Conflict } from "../domain/tasks";
export class UsageData {
 constructor(private readonly db: Database.Database) {}
 accept(runId: string, eventId: string, payload: UsagePayload, receivedAt: number): void {
  const digest = canonicalDigest(payload);
  const existing = this.db.prepare("SELECT payload_digest FROM usage_measurements WHERE run_id=? AND usage_id=?").get(runId, payload.usageId) as {payload_digest: string} | undefined;
  if (existing) {
   if (existing.payload_digest !== digest) throw new Conflict("usage_conflict");
   return;
  }
  this.db.prepare("INSERT INTO usage_measurements(run_id,usage_id,event_id,payload_digest,source,model,input_tokens,output_tokens,billing_basis,measured_at,first_received_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(runId,payload.usageId,eventId,digest,payload.source,payload.model,payload.inputTokens,payload.outputTokens,payload.billingBasis,Date.parse(payload.measuredAt),receivedAt);
 }
}
