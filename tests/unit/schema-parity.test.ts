import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { getTableConfig, SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import {
  projects,
  agents,
  comments,
  completions,
  reopens,
  settings,
} from "../../src/db/schema";
const expected = {
  projects: ["projects_version"],
  agents: ["agents_default_role", "agents_version"],
  comments: ["comments_actor"],
  completions: ["completions_actor", "completions_work_revision"],
  reopens: ["reopens_actor", "reopens_work_revision"],
  settings: ["settings_singleton", "settings_version"],
};
function checks(sql: string): string[] {
  const found: string[] = [];
  const pattern = /\bCHECK\s*\(/gi;
  while (pattern.exec(sql) !== null) {
    const start = pattern.lastIndex;
    let depth = 1;
    let end = start;
    for (; end < sql.length && depth; end++) {
      if (sql[end] === "(") depth++;
      if (sql[end] === ")") depth--;
    }
    if (depth) throw new Error("UNBALANCED_CHECK");
    found.push(sql.slice(start, end - 1));
    pattern.lastIndex = end;
  }
  return found;
}
const normalize = (sql: string) =>
  sql
    .replace(/"[a-z_]+"\./g, "")
    .replace(/"/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
it("mirrors all ten reviewed CHECK names, counts and exact constraint expressions in six Drizzle tables", () => {
  const migration = readFileSync("migrations/0001_application.sql", "utf8");
  const dialect = new SQLiteSyncDialect();
  for (const table of [
    projects,
    agents,
    comments,
    completions,
    reopens,
    settings,
  ]) {
    const config = getTableConfig(table);
    const key = config.name as keyof typeof expected;
    const start = migration.search(
      new RegExp("CREATE TABLE " + config.name + "\\b"),
    );
    expect(start).toBeGreaterThanOrEqual(0);
    const next = migration.indexOf("CREATE TABLE ", start + 1);
    const statement = migration.slice(start, next < 0 ? undefined : next);
    const migrated = checks(statement).map(normalize).sort();
    expect(config.checks.map((c) => c.name).sort()).toEqual(
      expected[key].sort(),
    );
    expect(
      config.checks
        .map((c) => normalize(dialect.sqlToQuery(c.value).sql))
        .sort(),
    ).toEqual(migrated);
  }
});

it("mirrors additive order checks and allocator checks while documenting trigger-enforced requiredness", async () => {
  const { runs, runOrderAllocator } = await import("../../src/db/schema");
  const migration = readFileSync(
    "migrations/0002_registration_order.sql",
    "utf8",
  );
  const dialect = new SQLiteSyncDialect();
  const runConfig = getTableConfig(runs);
  const orderColumn = runConfig.columns.find(
    (column) => column.name === "registration_order",
  );
  expect(orderColumn?.notNull).toBe(true);
  const orderCheck = runConfig.checks.find(
    (check) => check.name === "runs_registration_order",
  );
  expect(normalize(dialect.sqlToQuery(orderCheck!.value).sql)).toBe(
    normalize(checks(migration.slice(0, migration.indexOf(";")))[0]),
  );
  expect(
    runConfig.indexes
      .filter((index) => index.config.name === "runs_registration_order")
      .map((index) => index.config.unique),
  ).toEqual([true]);
  const allocator = getTableConfig(runOrderAllocator);
  const start = migration.indexOf("CREATE TABLE run_order_allocator");
  const statement = migration.slice(start, migration.indexOf(";", start));
  expect(
    allocator.checks
      .map((check) => normalize(dialect.sqlToQuery(check.value).sql))
      .sort(),
  ).toEqual(checks(statement).map(normalize).sort());
  expect(allocator.columns.map((column) => column.name)).toEqual([
    "singleton",
    "last_value",
  ]);
});
it("mirrors workflow plan checks in the additive migration", async () => {
  const { workflows, workflowRevisions, workflowIdentities } = await import("../../src/db/schema");
  const migration = readFileSync("migrations/0006_workflows.sql", "utf8");
  const dialect = new SQLiteSyncDialect();
  for (const table of [workflows, workflowRevisions, workflowIdentities]) {
    const config = getTableConfig(table);
    const start = migration.indexOf("CREATE TABLE " + config.name + " (");
    const end = migration.indexOf(";", start);
    expect(config.checks.map(c => normalize(dialect.sqlToQuery(c.value).sql)).sort()).toEqual(checks(migration.slice(start, end)).map(normalize).sort());
  }
});
it("mirrors workflow attempt, event, history and allocator checks", async () => {
 const { workflowOrderAllocator, workflowRuns, workflowRunRegistrations, workflowEvents, workflowNodeObservations, workflowClosures } = await import("../../src/db/schema");
 const migration = readFileSync("migrations/0006_workflows.sql", "utf8"); const dialect = new SQLiteSyncDialect();
 for (const table of [workflowOrderAllocator, workflowRuns, workflowRunRegistrations, workflowEvents, workflowNodeObservations, workflowClosures]) {
  const config = getTableConfig(table), start = migration.indexOf("CREATE TABLE " + config.name + " (");
  expect(config.checks.map(c => normalize(dialect.sqlToQuery(c.value).sql)).sort()).toEqual(checks(migration.slice(start, migration.indexOf(";", start))).map(normalize).sort());
 }
});
