import { expect,it } from "vitest";
import { backoff } from "../../src/cli/http";
it("bounds full exponential jitter and valid Retry-After independently of the invocation's remaining window",()=> {
  expect([1,2,3,4,9,30].map(attempt=>backoff(attempt,0,1))).toEqual([100,200,400,800,25600,30000]);
  expect(backoff(1,0,0)).toBe(0);expect(backoff(2,0,0.5)).toBe(100);
  expect(backoff(1,2000,0.5)).toBe(2000);expect(backoff(30,1000,1)).toBe(30000);expect(backoff(1,30000,0)).toBe(30000);
});
