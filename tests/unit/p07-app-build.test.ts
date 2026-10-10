import {it,expect} from "vitest";
import {retainedApplication,reviewedOutboxSHA256} from "../fixtures/p07-app-build";
it("qualifies only the reviewed CLI hash and complete unchanged application graph/assets",()=>{
 const facts=retainedApplication("36f6d1bc4699c706e3f57a17cfcc85a1576c648b");
 expect(facts.reviewedOutboxSHA256).toBe(reviewedOutboxSHA256);expect(Object.keys(facts.unchanged)).toHaveLength(87);expect(Object.keys(facts.assets)).toHaveLength(417);expect(facts.reachable).not.toContain("src/cli/outbox.ts");expect(facts.roots.length).toBeGreaterThan(0);expect(facts.driverHashes["tests/fixtures/p07-flush-stage.ts"]).toMatch(/^[a-f0-9]{64}$/);
});
