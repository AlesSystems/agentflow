import { expect, it } from "vitest";
import { githubRepositoriesInput, githubRefreshInput, githubQuery, pullRequestIdentity } from "../../src/contracts/github";
it("accepts exact normalized selections and rejects broad or secret-bearing input", () => {
 expect(githubRepositoriesInput.parse({expectedVersion:1,enabled:true,repositories:["AlesSystems/AgentFlow"]}).repositories).toEqual(["alessystems/agentflow"]);
 for (const repositories of [["a/*"],["a/b","A/B"],Array.from({length:11},(_,i)=>`a/r${i}`)]) expect(githubRepositoriesInput.safeParse({expectedVersion:1,enabled:true,repositories}).success).toBe(false);
 expect(githubRepositoriesInput.safeParse({expectedVersion:1,enabled:false,repositories:[],token:"secret"}).success).toBe(false);
});
it("bounds one refresh target and local lookups", () => {
 expect(githubRefreshInput.safeParse({expectedVersion:1,repository:"a/b",page:1,number:1}).success).toBe(false);
 for (const page of [0,1001]) expect(githubRefreshInput.safeParse({expectedVersion:1,repository:"a/b",page}).success).toBe(false);
 expect(githubQuery.safeParse({limit:"101"}).success).toBe(false);
 expect(pullRequestIdentity("https://github.com/A/B/pull/12")).toEqual({repository:"a/b",number:12});
 for(const url of ["https://github.com/a/b/pull/12?q=x","https://evil/a/b/pull/12","https://github.com/a/b/pull/01"]) expect(pullRequestIdentity(url)).toBeNull();
});
