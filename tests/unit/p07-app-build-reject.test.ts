import {it,expect} from "vitest";
import {validateRetainedApplicationFacts,reviewedOutboxSHA256,retainedAssetCount,retainedAssetSHA256,type RetainedApplicationFacts} from "../fixtures/p07-app-build-policy";
const validFacts=():RetainedApplicationFacts=>({changedPaths:["src/cli/outbox.ts"],cliSHA256:reviewedOutboxSHA256,differingInputs:[],assetCount:retainedAssetCount,assetSHA256:retainedAssetSHA256,reachable:["src/app/layout.tsx","src/server/launcher.ts"]});
const cases: [keyof RetainedApplicationFacts,unknown,string][]=[
 ["changedPaths",["src/server/launcher.ts"],"retained_application_difference: src/server/launcher.ts"],
 ["differingInputs",["next.config.ts"],"retained_application_input: next.config.ts"],
 ["cliSHA256","0".repeat(64),"retained_cli_hash"],
 ["assetCount",416,"retained_asset_count"],
 ["assetSHA256","0".repeat(64),"retained_asset_hash"],
 ["reachable",["src/app/layout.tsx","src/cli/outbox.ts"],"retained_cli_reachable"],
];
it.each(cases)("rejects only the independently corrupted %s fact with its specific reason",(field,value,reason)=>{
 const facts=validFacts();Object.assign(facts,{[field]:value});expect(()=>validateRetainedApplicationFacts(facts)).toThrow(reason);
});
