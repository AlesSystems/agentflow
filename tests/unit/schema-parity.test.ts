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
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sql))) {
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
