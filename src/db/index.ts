import { validateMigrationSql } from "./migration-sql";
import {
  ApplicationData,
  type ApplicationCommand,
  type ApplicationQuery,
  type CommandContext,
} from "./application";
import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createFile,
  privateDestination,
  type AppRoot,
  secureDirectory,
  syncFile,
  syncDirectory,
  validateFile,
} from "../server/filesystem";
import { acquireInstance, type InstanceOwner } from "../server/instance";
import { loadCredentials } from "../server/auth";

export type Migration = Readonly<{ id: string; sql: string; sha256: string }>;
export type Metadata = { generation: string; schemaVersion: number };
export type StoredSession = {
  id: string;
  principal: "operator";
  expiresAt: number;
};
export const migrations: Migration[] = [
  "0000_foundation",
  "0001_application",
  "0002_registration_order",
].map((id) => {
  const sql = readFileSync(
    join(process.cwd(), "migrations", id + ".sql"),
    "utf8",
  );
  return { id, sql, sha256: createHash("sha256").update(sql).digest("hex") };
});
export class Store {
  private db: Database.Database;
  private readonly appRoot: AppRoot;
  private work = new Set<Promise<unknown>>();
  readonly dataDir: string;
  private unregister: (() => void) | undefined;
  constructor(
    owner: InstanceOwner,
    file = join(owner.dataDir, "agentflow.sqlite"),
  ) {
    owner.assertOwned();
    this.appRoot = owner.appRoot;
    file = privateDestination(file, this.appRoot);
    this.dataDir = owner.dataDir;
    for (const suffix of ["", "-wal", "-shm", "-journal"])
      validateFile(file + suffix);
    if (!existsSync(file)) createFile(file);
    this.db = new Database(file);
    this.unregister = owner.registerConnection();
    try {
      this.db.pragma("foreign_keys = ON");
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("synchronous = FULL");
      this.db.pragma("busy_timeout = 250");
    } catch (error) {
      this.db.close();
      this.unregister();
      throw error;
    }
  }
  command(command: ApplicationCommand, context: CommandContext) {
    return new ApplicationData(this.db, this.dataDir).command(command, context);
  }
  snapshot(query: ApplicationQuery, now = Date.now()) {
    return new ApplicationData(this.db, this.dataDir).snapshot(query, now);
  }
  pragmas() {
    return Object.fromEntries(
      ["journal_mode", "synchronous", "foreign_keys", "busy_timeout"].map(
        (key) => [key, this.db.pragma(key, { simple: true })],
      ),
    );
  }
  transaction<T>(operation: () => T): T {
    return this.db.transaction(operation)();
  }
  metadata(): Metadata {
    return this.db
      .prepare(
        "SELECT generation, schema_version AS schemaVersion FROM instance_metadata WHERE singleton = 1",
      )
      .get() as Metadata;
  }
  createSession(hash: string, created: number, expires: number) {
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO sessions VALUES (?, ?, 'operator', ?, ?)")
      .run(id, hash, created, expires);
    return id;
  }
  session(hash: string, now = Date.now()): StoredSession | null {
    return (
      (this.db
        .prepare(
          "SELECT id, principal, expires_at AS expiresAt FROM sessions WHERE secret_hash = ? AND expires_at > ?",
        )
        .get(hash, now) as StoredSession) || null
    );
  }
  revoke(hash: string) {
    this.db.prepare("DELETE FROM sessions WHERE secret_hash = ?").run(hash);
  }
  revokeAll() {
    this.transaction(() => this.db.prepare("DELETE FROM sessions").run());
  }
  sessionCount() {
    return (
      this.db.prepare("SELECT count(*) AS count FROM sessions").get() as {
        count: number;
      }
    ).count;
  }
  renewGeneration() {
    this.transaction(() => {
      this.db.prepare("DELETE FROM sessions").run();
      this.db
        .prepare(
          "UPDATE instance_metadata SET generation = ? WHERE singleton = 1",
        )
        .run(randomUUID());
    });
  }
  integrity() {
    const rows = this.db.pragma("integrity_check") as {
      integrity_check: string;
    }[];
    const foreignKeys = this.db.pragma("foreign_key_check") as unknown[];
    if (
      rows.length !== 1 ||
      rows[0].integrity_check !== "ok" ||
      foreignKeys.length
    )
      throw new Error("INTEGRITY_FAILED");
    return { integrity: "ok" as const, foreignKeys };
  }
  validateMigrations(registry = migrations) {
    const table = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE name = 'migration_history'",
      )
      .get();
    if (!table) {
      const tables = this.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        )
        .all();
      if (tables.length) throw new Error("UNKNOWN_SCHEMA");
      return [] as string[];
    }
    const history = this.db
      .prepare("SELECT id, sha256 FROM migration_history ORDER BY id")
      .all() as { id: string; sha256: string }[];
    for (const [i, row] of history.entries())
      if (
        !registry[i] ||
        registry[i].id !== row.id ||
        registry[i].sha256 !== row.sha256
      )
        throw new Error("MIGRATION_CHECKSUM_OR_SCHEMA");
    if (history.length && this.metadata().schemaVersion !== history.length)
      throw new Error("UNKNOWN_SCHEMA");
    return history.map((row) => row.id);
  }
  async migrate(registry = migrations) {
    for (const migration of registry) validateMigrationSql(migration.sql);
    const applied = this.validateMigrations(registry);
    if (applied.length === registry.length) {
      this.integrity();
      return;
    }
    if (applied.length)
      await this.backup(
        join(
          secureDirectory(join(this.dataDir, "backups")),
          `pre-migration-${randomUUID()}.sqlite`,
        ),
      );
    this.db.transaction(() => {
      this.db.exec(
        "CREATE TABLE IF NOT EXISTS migration_history (id TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at INTEGER NOT NULL)",
      );
      for (const migration of registry.slice(applied.length)) {
        this.db.exec(migration.sql);
        this.db
          .prepare("INSERT INTO migration_history VALUES (?, ?, ?)")
          .run(migration.id, migration.sha256, Date.now());
      }
      if (!applied.length)
        this.db
          .prepare("INSERT INTO instance_metadata VALUES (1, ?, ?)")
          .run(randomUUID(), registry.length);
      else
        this.db
          .prepare("UPDATE instance_metadata SET schema_version = ?")
          .run(registry.length);
      this.integrity();
    }).immediate();
  }
  backup(destination: string) {
    const pending = this.writeBackup(destination).finally(() =>
      this.work.delete(pending),
    );
    this.work.add(pending);
    return pending;
  }
  async drain() {
    await Promise.allSettled([...this.work]);
  }
  private async writeBackup(destination: string) {
    destination = privateDestination(destination, this.appRoot);
    secureDirectory(join(destination, ".."));
    validateFile(destination);
    createFile(destination);
    await this.db.backup(destination);
    const backup = new Database(destination, { readonly: true });
    try {
      if (
        backup.pragma("integrity_check", { simple: true }) !== "ok" ||
        (backup.pragma("foreign_key_check") as unknown[]).length
      )
        throw new Error("BACKUP_INTEGRITY_FAILED");
    } finally {
      backup.close();
    }
    syncFile(destination);
    syncDirectory(join(destination, ".."));
    return { file: destination, ...this.metadata(), integrity: "ok" as const };
  }
  checkpoint() {
    this.db.pragma("wal_checkpoint(TRUNCATE)");
  }
  close() {
    if (this.work.size) throw new Error("STORAGE_WORK_PENDING");
    if (this.db.open) this.db.close();
    this.unregister?.();
  }
}
export async function openOwnedStore(path: string, registry = migrations) {
  const instance = acquireInstance(path);
  let store: Store | undefined;
  try {
    if (existsSync(join(instance.dataDir, "restore-marker.json")))
      throw new Error(
        "RESTORE_INTERRUPTED: Run local restore repair before starting.",
      );
    validateFile(join(instance.dataDir, "credentials.json"));
    store = new Store(instance);
    await store.migrate(registry);
    const credentials = loadCredentials(instance.dataDir);
    const ownedStore = store;
    return {
      store: ownedStore,
      credentials,
      instance,
      close() {
        ownedStore.close();
        instance.release();
      },
    };
  } catch (error) {
    store?.close();
    instance.release();
    throw error;
  }
}
