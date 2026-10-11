import {it,expect} from "vitest";
import {validateRetainedApplicationFacts,reviewedOutboxSHA256,retainedAssetCount,retainedAssetSHA256,type RetainedApplicationFacts} from "../fixtures/p07-app-build-policy";
export const validFacts=():RetainedApplicationFacts=>({changedPaths:["src/cli/outbox.ts"],cliSHA256:reviewedOutboxSHA256,differingInputs:[],assetCount:retainedAssetCount,assetSHA256:retainedAssetSHA256,reachable:["src/app/layout.tsx","src/server/launcher.ts"]});
it("validates synthetic qualification facts without filesystem, Git ancestry or historical build",()=>{expect(()=>validateRetainedApplicationFacts(validFacts())).not.toThrow();});
