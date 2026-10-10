import { randomUUID } from "node:crypto";
import { openOwnedStore } from "../../src/db";
import type { ApplicationCommand } from "../../src/db/application";
import { eventInput } from "../../src/contracts/observations";
import { canonicalDigest } from "../../src/domain/request-digest";

export async function seedPerformance(dir: string, counts: { tasks: number; events: number; producers: number }) {
  const owned = await openOwnedStore(dir);
  let now = Date.now();
  function send(command: ApplicationCommand) {
    const reply = owned.store.command(command, { principal: "reporter", method: "POST", path: command.kind, key: randomUUID(), digest: canonicalDigest(command.input), now: now++ });
    if (reply.status !== 201) throw new Error("fixture_seed_rejected");
    return (reply.body.data as { id: string }).id;
  }
  try {
    const projectId = send({ kind: "project.create", input: { name: "Synthetic P06 P07 dataset" } });
    const tasks = Array.from({ length: counts.tasks }, (_, index) => send({ kind: "task.create", input: { projectId, title: `Synthetic P06 dataset task ${index}` } }));
    const agents = Array.from({ length: counts.producers }, (_, index) => send({ kind: "agent.create", input: { displayName: `Synthetic P06 producer ${index}`, source: "qualified synthetic fixture", defaultRole: "implementation" } }));
    const historic: string[] = [], runs: string[] = [];
    for (const agentId of agents) {
      const id = randomUUID(); historic.push(id);
      send({ kind: "run.register", input: { id, projectId, agentId, purpose: "planning" } });
      for (let sequence = 1; sequence <= counts.events / counts.producers; sequence++) {
        const last = sequence === counts.events / counts.producers;
        send({ kind: "run.event", id, input: eventInput.parse({ schemaVersion: 1, eventId: randomUUID(), runId: id, sequence, type: sequence === 1 ? "run.started" : last ? "run.succeeded" : "run.heartbeat", occurredAt: new Date().toISOString(), payload: last ? { summary: "Synthetic historical fixture" } : {} }) });
      }
    }
    for (let index = 0; index < agents.length; index++) {
      const id = randomUUID(); runs.push(id);
      send({ kind: "run.register", input: { id, projectId, agentId: agents[index], taskId: tasks[index], purpose: "implementation", expectedTaskVersion: 1 } });
    }
    return { projectId, tasks, agents, historic, runs, qualification: "Historical dataset seeded through Store commands in an owned synthetic fixture. Active observations use public HTTP and real CLI; no operator database inspected." };
  } finally { owned.close(); }
}
