import { expect, it } from "vitest";
import { readConfig } from "../../src/server/config";
import { inspectManaged } from "../../src/server/filesystem";
it("parses only supported local absolute configuration", () => {
  expect(
    readConfig({ PORT: "3333", AGENTFLOW_DATA_DIR: "/tmp/synthetic" }),
  ).toEqual({
    port: 3333,
    dataDir: "/tmp/synthetic",
    host: "127.0.0.1",
    mode: "production",
  });
  for (const PORT of ["0", "abc", "65536", "3333x"])
    expect(() => readConfig({ PORT })).toThrow("INVALID_PORT");
  expect(() => readConfig({ AGENTFLOW_DATA_DIR: "relative" })).toThrow(
    "ABSOLUTE",
  );
});
it("refuses wrong ownership through the filesystem inspection seam", () => {
  expect(() =>
    inspectManaged(
      {
        isSymbolicLink: () => false,
        isDirectory: () => true,
        isFile: () => false,
        uid: (process.getuid?.() || 0) + 1,
        mode: 0o700,
      },
      true,
    ),
  ).toThrow("WRONG_OWNER");
});
