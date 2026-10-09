import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { Store, migrations } from "./index";
import { acquireInstance, type InstanceOwner } from "../server/instance";
import {
  createFile,
  secureDirectory,
  syncDirectory,
  syncFile,
  validateFile,
} from "../server/filesystem";
export type RestorePhase = "staged" | "archived" | "replaced";
const markerSchema = z
  .object({
    version: z.literal(1),
    phase: z.enum(["staged", "archived", "replaced"]),
    candidate: z.string().regex(/^restore-[a-f0-9-]+\.sqlite$/),
    damaged: z.string().regex(/^damaged-[a-f0-9-]+$/),
    generation: z.string().uuid(),
  })
  .strict();
type Marker = z.infer<typeof markerSchema>;
function writeMarker(dir: string, marker: Marker) {
  const path = join(dir, "restore-marker.json");
  validateFile(path);
  const staged = join(dir, `marker-${randomUUID()}.json`);
  createFile(staged, JSON.stringify(marker));
  renameSync(staged, path);
  syncDirectory(dir);
}
function readMarker(dir: string) {
  const path = join(dir, "restore-marker.json");
  validateFile(path);
  return markerSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}
function archiveCurrent(dir: string, marker: Marker) {
  const bundle = secureDirectory(join(dir, marker.damaged));
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    const current = join(dir, "agentflow.sqlite" + suffix);
    validateFile(current);
    const damaged = join(bundle, "agentflow.sqlite" + suffix);
    validateFile(damaged);
    if (existsSync(current)) {
      if (existsSync(damaged)) throw new Error("RESTORE_ARCHIVE_CONFLICT");
      renameSync(current, damaged);
    }
  }
  syncDirectory(bundle);
  syncDirectory(dir);
}
async function finishRestore(
  owner: InstanceOwner,
  marker: Marker,
  phase?: (phase: RestorePhase) => void,
) {
  const dir = owner.dataDir;
  if (marker.phase === "staged") {
    archiveCurrent(dir, marker);
    marker = { ...marker, phase: "archived" };
    writeMarker(dir, marker);
    phase?.("archived");
  }
  if (marker.phase === "archived") {
    const candidate = join(dir, marker.candidate);
    validateFile(candidate);
    if (existsSync(candidate)) {
      renameSync(candidate, join(dir, "agentflow.sqlite"));
      syncDirectory(dir);
    } else {
      if (!existsSync(join(dir, "agentflow.sqlite")))
        throw new Error("RESTORE_CANDIDATE_MISSING");
      const restored = new Store(owner);
      try {
        if (
          restored.metadata().generation !== marker.generation ||
          restored.sessionCount() !== 0
        )
          throw new Error("RESTORE_GENERATION_MISMATCH");
        restored.integrity();
      } finally {
        restored.close();
      }
    }
    marker = { ...marker, phase: "replaced" };
    writeMarker(dir, marker);
    phase?.("replaced");
  }
  const restored = new Store(owner);
  try {
    restored.validateMigrations();
    if (
      restored.metadata().generation !== marker.generation ||
      restored.sessionCount() !== 0
    )
      throw new Error("RESTORE_GENERATION_MISMATCH");
    restored.integrity();
    restored.checkpoint();
  } finally {
    restored.close();
  }
  unlinkSync(join(dir, "restore-marker.json"));
  syncDirectory(dir);
  return {
    generation: marker.generation,
    damagedBundle: join(dir, marker.damaged),
    integrity: "ok" as const,
  };
}
export async function restore(
  path: string,
  source: string,
  phase?: (phase: RestorePhase) => void,
) {
  const owner = acquireInstance(path);
  const dir = owner.dataDir;
  try {
    if (existsSync(join(dir, "restore-marker.json")))
      throw new Error("RESTORE_INTERRUPTED: Run local restore repair.");
    secureDirectory(dirname(source));
    validateFile(source);
    if (!existsSync(source)) throw new Error("BACKUP_NOT_FOUND");
    const candidateName = `restore-${randomUUID()}.sqlite`;
    const candidatePath = join(dir, candidateName);
    createFile(candidatePath);
    const input = new Database(source, { readonly: true, fileMustExist: true });
    try {
      if (
        input.pragma("integrity_check", { simple: true }) !== "ok" ||
        (input.pragma("foreign_key_check") as unknown[]).length
      )
        throw new Error("BACKUP_INTEGRITY_FAILED");
      await input.backup(candidatePath);
    } finally {
      input.close();
    }
    const candidate = new Store(owner, candidatePath);
    let generation: string;
    try {
      const history = candidate.validateMigrations();
      if (!history.length) throw new Error("RESTORE_SCHEMA_UNSUPPORTED");
      await candidate.migrate(migrations);
      candidate.renewGeneration();
      candidate.integrity();
      generation = candidate.metadata().generation;
      candidate.checkpoint();
    } finally {
      await candidate.drain();
      candidate.close();
    }
    syncFile(candidatePath);
    syncDirectory(dir);
    const marker: Marker = {
      version: 1,
      phase: "staged",
      candidate: candidateName,
      damaged: `damaged-${randomUUID()}`,
      generation,
    };
    writeMarker(dir, marker);
    phase?.("staged");
    return await finishRestore(owner, marker, phase);
  } finally {
    owner.release();
  }
}
export async function repairRestore(path: string) {
  const owner = acquireInstance(path);
  try {
    return await finishRestore(owner, readMarker(owner.dataDir));
  } finally {
    owner.release();
  }
}
