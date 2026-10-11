import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { canonicalDigest } from "../../src/domain/request-digest";
import { eventInput } from "../../src/contracts/observations";
import { workflowEventInput } from "../../src/contracts/workflows";
import { failureFact } from "./p07-warm-error";
export type SpoolProducer = { kind: "run" | "workflow-run"; id: string };
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
function leaf(outbox: string, producer: SpoolProducer) {
  return producer.kind === "run"
    ? join(outbox, producer.id)
    : join(outbox, "workflow-runs", producer.id);
}
function parsed(bytes: Buffer) {
  try {
    return {
      value: JSON.parse(bytes.toString("utf8")) as Record<string, unknown>,
      error: null,
    };
  } catch (error) {
    return { value: null, error: failureFact(error) };
  }
}
function captureFile(outbox: string, producer: SpoolProducer, name: string) {
  const path = join(leaf(outbox, producer), name),
    bytes = readFileSync(path),
    record = parsed(bytes),
    statePath = join(leaf(outbox, producer), "state.json"),
    stateBytes = readFileSync(statePath),
    state = parsed(stateBytes);
  return {
    producer,
    path,
    filename: basename(path),
    originalBytesBase64: bytes.toString("base64"),
    sha256: hash(bytes),
    record: record.value,
    body: record.value?.body as Record<string, unknown> | undefined,
    digest: record.value?.digest as string | undefined,
    parseError: record.error,
    state: state.value,
    statePath,
    stateOriginalBytesBase64: stateBytes.toString("base64"),
    stateSha256: hash(stateBytes),
    stateParseError: state.error,
  };
}
export function captureEventSpool(
  outbox: string,
  producer: SpoolProducer,
  input: { sequence: number; eventId: string },
) {
  return captureFile(
    outbox,
    producer,
    `${input.sequence}-${input.eventId}.json`,
  );
}
export function capturePendingSpool(outbox: string, producer: SpoolProducer) {
  const dir = leaf(outbox, producer);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /^\d+-[0-9a-f-]{36}\.json$/i.test(name))
    .sort()
    .map((name) => captureFile(outbox, producer, name));
}
export function validateEventSpool(
  capture: ReturnType<typeof captureEventSpool>,
  input: unknown,
) {
  assert.equal(capture.parseError, null);
  assert.equal(capture.stateParseError, null);
  assert(capture.record && capture.state && capture.body);
  const body = (
    capture.producer.kind === "run" ? eventInput : workflowEventInput
  ).parse(capture.body);
  assert.deepEqual(capture.body, input);
  assert.equal(capture.digest, canonicalDigest(capture.body));
  assert.equal(capture.record.producerKind ?? "run", capture.producer.kind);
  const id = "runId" in body ? body.runId : body.workflowRunId;
  assert.equal(id.toLowerCase(), capture.producer.id.toLowerCase());
  assert.equal(capture.filename, `${body.sequence}-${body.eventId}.json`);
  assert.equal(
    hash(Buffer.from(capture.originalBytesBase64, "base64")),
    capture.sha256,
  );
  assert.equal(
    hash(Buffer.from(capture.stateOriginalBytesBase64, "base64")),
    capture.stateSha256,
  );
  assert(Number(capture.state.allocatedThrough) >= body.sequence);
  assert(Number(capture.state.acknowledgedThrough) < body.sequence);
  assert.equal(capture.state.producerKind ?? "run", capture.producer.kind);
  assert.equal(
    String(capture.state.runId).toLowerCase(),
    capture.producer.id.toLowerCase(),
  );
  return body;
}
