import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { privateDestination, type AppRoot } from "../../src/server/filesystem";
function rootFixture() {
  const parent = mkdtempSync(join(realpathSync(tmpdir()), "agentflow-paths-"));
  const path = join(parent, "CaseApp");
  mkdirSync(path, { mode: 0o700 });
  const stat = lstatSync(path);
  const root: AppRoot = Object.freeze({
    path: realpathSync(path),
    dev: stat.dev,
    ino: stat.ino,
  });
  return { parent, root };
}
it("rejects root and missing descendants while permitting prefix siblings and external normalized paths", () => {
  const { parent, root } = rootFixture();
  for (const path of [
    root.path,
    join(root.path, "public", "missing", "data"),
    root.path + "/new/../private",
  ])
    expect(() => privateDestination(path, root)).toThrow(
      "PRIVATE_PATH_INSIDE_APP",
    );
  expect(privateDestination(root.path + "-sibling/missing", root)).toBe(
    root.path + "-sibling/missing",
  );
  expect(
    privateDestination(root.path + "/discarded/../../outside/data", root),
  ).toBe(join(parent, "outside", "data"));
  expect(existsSync(join(root.path, "discarded"))).toBe(false);
  expect(existsSync(join(parent, "outside"))).toBe(false);
});
it("rejects raw symlinks and dangling aliases before dot components can discard them", () => {
  const { parent, root } = rootFixture();
  const alias = join(parent, "alias");
  symlinkSync(root.path, alias);
  expect(() => privateDestination(alias + "/../outside", root)).toThrow(
    "SYMLINK",
  );
  const dangling = join(parent, "dangling");
  symlinkSync(join(parent, "absent"), dangling);
  expect(() => privateDestination(dangling + "/../outside", root)).toThrow(
    "SYMLINK",
  );
  expect(existsSync(join(parent, "outside"))).toBe(false);
});
it("uses actual directory identity for existing case aliases", () => {
  const { root } = rootFixture();
  const alias = join(dirname(root.path), basename(root.path).toUpperCase());
  if (existsSync(alias)) {
    expect(lstatSync(alias).ino).toBe(root.ino);
    expect(() =>
      privateDestination(join(alias, "public", "missing"), root),
    ).toThrow("PRIVATE_PATH_INSIDE_APP");
  } else {
    expect(privateDestination(join(alias, "missing"), root)).toBe(
      join(alias, "missing"),
    );
  }
});
it("rejects nondirectory intermediates and relative paths without writes", () => {
  const { parent, root } = rootFixture();
  const file = join(parent, "plain");
  writeFileSync(file, "unchanged", { mode: 0o600 });
  expect(() => privateDestination(file + "/child", root)).toThrow(
    "INVALID_DIRECTORY",
  );
  expect(() => privateDestination("relative", root)).toThrow(
    "ABSOLUTE_DATA_DIR_REQUIRED",
  );
});
