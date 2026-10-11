import assert from "node:assert/strict";
export const reviewedOutboxSHA256="1eef5f50075acf4bcf5334c1ede3539f9781af1c127e899f3a3f9fa2e8dd93b9";
export const retainedAssetCount=417;
export const retainedAssetSHA256="2a6051ff1b4eee8e0d4fbfb9ac7765a4f7366df112c5d36cf5507b8a0b35457b";
export type RetainedSourceFacts={changedPaths:string[];cliSHA256:string;differingInputs:string[]};
export type RetainedApplicationFacts=RetainedSourceFacts&{assetCount:number;assetSHA256:string;reachable:string[]};
export function validateRetainedSourceFacts(facts:RetainedSourceFacts){
 assert(facts.changedPaths.every(path=>path==="src/cli/outbox.ts"),`retained_application_difference: ${facts.changedPaths.filter(path=>path!=="src/cli/outbox.ts").join(", ")}`);
 assert.equal(facts.cliSHA256,reviewedOutboxSHA256,"retained_cli_hash");
 assert.equal(facts.differingInputs.length,0,`retained_application_input: ${facts.differingInputs.join(", ")}`);
}
export function validateRetainedApplicationFacts(facts:RetainedApplicationFacts){
 validateRetainedSourceFacts(facts);
 assert.equal(facts.assetCount,retainedAssetCount,"retained_asset_count");
 assert.equal(facts.assetSHA256,retainedAssetSHA256,"retained_asset_hash");
 assert(!facts.reachable.includes("src/cli/outbox.ts"),"retained_cli_reachable");
}
