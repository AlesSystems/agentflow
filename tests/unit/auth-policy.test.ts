import { expect, it } from "vitest";
import { authorize } from "../../src/server/security";
import { equalSecret, sessionCookie } from "../../src/server/auth";
it("reporters cannot authorize human commands", () => {
  expect(() =>
    authorize({ kind: "reporter", id: "reporter" }, "human"),
  ).toThrow("human_required");
});
it("cookies expire and secrets are compared using their hashes", () => {
  expect(sessionCookie("synthetic")).toBe(
    "agentflow_session=synthetic; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200",
  );
  expect(equalSecret("short", "longer")).toBe(false);
});
it('an empty session cookie still makes bearer authentication ambiguous',async()=>{
 const {authenticate}=await import('../../src/server/security');
 const headers=new Headers({Cookie:'agentflow_session=',Authorization:'Bearer '+'a'.repeat(64)});
 expect(()=>authenticate(headers,{} as import('../../src/db').Store,{schemaVersion:1,pairingToken:'b'.repeat(64),reporterToken:'a'.repeat(64)},'read')).toThrow('ambiguous_auth');
});
