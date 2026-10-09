import { expect, it } from "vitest";
import { changeCursor } from "../../src/contracts/common";
import { parseStreamRequest } from "../../src/contracts/stream";
it("accepts only canonical signed SQLite range cursors losslessly", () => {
  for (const value of ["0", "9007199254740991", "9007199254740992", "9007199254740993", "9223372036854775807"])
    expect(changeCursor.parse(value)).toBe(value);
  for (const value of ["", "00", "01", "-1", "+1", "1.0", " 1", "9223372036854775808"])
    expect(changeCursor.safeParse(value).success).toBe(false);
});
it("validates both cursor sources before choosing Last-Event-ID", () => {
  const generation = "10000000-0000-4000-8000-000000000001";
  expect(parseStreamRequest(new URL(`http://localhost/changes?after=1&generation=${generation}`), ["2"]).after).toBe("2");
  for (const query of ["after=00", "after=1&after=2", "after=1&secret=x", "after=1&__proto__=x", "", "generation=" + generation])
    expect(() => parseStreamRequest(new URL(`http://localhost/changes?${query}&generation=${generation}`), ["2"])).toThrow();
  expect(() => parseStreamRequest(new URL(`http://localhost/changes?after=1&generation=${generation}`), ["00"])).toThrow();
  expect(() => parseStreamRequest(new URL(`http://localhost/changes?after=1&generation=${generation}`), ["1", "1"])).toThrow();
});
