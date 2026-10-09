import { expect, test } from "vitest";
import { safeCursor, validatedChange } from "../../src/client/tracking";
const generation = "86abc230-e4a0-4c68-9dd8-777a0bbfb93d";
test("independently captured snapshots begin at the lowest lossless cursor", () => {
  expect(safeCursor([{ generation, snapshotCursor: "9007199254740993" }, { generation, snapshotCursor: "9007199254740992" }], generation)).toBe("9007199254740992");
  expect(safeCursor([{ generation: "other", snapshotCursor: "1" }], generation)).toBe("0");
});
test("only strict change frames can advance replay and duplicate cursors are inert", () => {
  const data = JSON.stringify({ entityType: "run", entityId: "test", kind: "reported" });
  expect(validatedChange("9007199254740993", data, "9007199254740992")).toBe("9007199254740993");
  expect(validatedChange("9007199254740992", data, "9007199254740992")).toBeNull();
  expect(() => validatedChange("01", data, "0")).toThrow();
  expect(() => validatedChange("1", '{"entityType":"run"}', "0")).toThrow();
});
