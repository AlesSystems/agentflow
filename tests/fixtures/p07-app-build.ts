import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFileSync,existsSync,readdirSync,statSync} from "node:fs";
import {resolve,dirname,relative} from "node:path";
import ts from "typescript";
import {reviewedOutboxSHA256,validateRetainedSourceFacts,validateRetainedApplicationFacts} from "./p07-app-build-policy";
export {reviewedOutboxSHA256} from "./p07-app-build-policy";
const outbox="src/cli/outbox.ts";
const hash=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
export function retainedApplication(baseline:string){
 const paths=["src","migrations","package.json","package-lock.json","next.config.ts","postcss.config.mjs","tsconfig.json"];
 const changed=execFileSync("git",["diff","--name-only",baseline,"--",...paths],{encoding:"utf8"}).trim().split("\n").filter(Boolean);
 const cliSHA256=hash(readFileSync(outbox));
 const files=execFileSync("git",["ls-files","--",...paths],{encoding:"utf8"}).trim().split("\n");
 const differingInputs:string[]=[];
 const unchanged=Object.fromEntries(files.filter(path=>path!==outbox).map(path=>{const bytes=readFileSync(path);if(!bytes.equals(execFileSync("git",["show",`${baseline}:${path}`],{maxBuffer:10*1024*1024})))differingInputs.push(path);return [path,hash(bytes)];}));
 const sourceFacts={changedPaths:changed,cliSHA256,differingInputs};validateRetainedSourceFacts(sourceFacts);
 const assets:Record<string,string>={};for(const path of readdirSync(".next",{recursive:true}).map(String).sort()){if(statSync(resolve(".next",path)).isFile())assets[path]=hash(readFileSync(resolve(".next",path)));}
 const assetCount=Object.keys(assets).length,assetSHA256=hash(Buffer.from(JSON.stringify(assets)));
 const config=ts.readConfigFile("tsconfig.json",ts.sys.readFile);assert(!config.error);const options=ts.parseJsonConfigFileContent(config.config,ts.sys,process.cwd()).options;
 const roots=files.filter(path=>/^src\/(app|server)\//.test(path)&&/\.[cm]?[jt]sx?$/.test(path));
 const visited=new Set<string>();const edges:Record<string,string[]>={};const nonExecutableLeaves:Record<string,string>={};
 function visit(file:string){file=resolve(file);if(visited.has(file))return;visited.add(file);assert.notEqual(file,resolve(outbox),"Changed CLI outbox must be unreachable from application/server roots");
  const source=ts.createSourceFile(file,readFileSync(file,"utf8"),ts.ScriptTarget.Latest,true);const dependencies:string[]=[];
  function walk(node:ts.Node){let spec:string|undefined;if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier))spec=node.moduleSpecifier.text;
   if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(node.expression)&&node.expression.text==="require")){assert(node.arguments.length&&ts.isStringLiteral(node.arguments[0]),`Nonliteral module dependency: ${relative(process.cwd(),file)}`);spec=(node.arguments[0] as ts.StringLiteral).text;}
   if(spec){const resolved=ts.resolveModuleName(spec,file,options,ts.sys).resolvedModule;if(resolved&&!resolved.isExternalLibraryImport&&existsSync(resolved.resolvedFileName)){dependencies.push(relative(process.cwd(),resolved.resolvedFileName));visit(resolved.resolvedFileName);}else if(spec.startsWith(".")||spec.startsWith("@/")){const leaf=resolve(dirname(file),spec);assert.equal(leaf,resolve("src/app/globals.css"),`Unresolved application dependency: ${spec}`);assert(existsSync(leaf));const css=readFileSync(leaf,"utf8");assert(!/@import\s+["'](?:\.|@\/)/.test(css),"Unresolved internal CSS import");nonExecutableLeaves[relative(process.cwd(),leaf)]=hash(Buffer.from(css));dependencies.push(relative(process.cwd(),leaf));}}
   ts.forEachChild(node,walk);
  }walk(source);edges[relative(process.cwd(),file)]=dependencies;
 }roots.forEach(visit);
 const qualificationFacts={...sourceFacts,assetCount,assetSHA256,reachable:[...visited].map(path=>relative(process.cwd(),path)).sort()};validateRetainedApplicationFacts(qualificationFacts);
 return {qualificationFacts,head:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),workingDiffSHA256:hash(execFileSync("git",["diff","HEAD"])),node:{version:process.version,platform:process.platform,arch:process.arch,executableSHA256:hash(readFileSync(process.execPath))},driverHashes:Object.fromEntries(["tests/performance/p07.ts","tests/performance/p07-cli.ts","tests/fixtures/p07-flush-stage.ts","tests/fixtures/p07-app-build-policy.ts","tests/fixtures/p07-flush.ts","tests/fixtures/p07-flush-boundary.ts","tests/fixtures/p07-ordinary.ts","tests/fixtures/p07-proof-errors.ts","tests/fixtures/p06-performance.ts","tests/fixtures/p06-proxy.ts","tests/fixtures/server.ts"].map(path=>[path,hash(readFileSync(path))])),assets,baseline,cliSource:outbox,reviewedOutboxSHA256,unchanged,roots,nonExecutableLeaves,externalDependencyQualification:"External package behavior pinned by unchanged package and lock; literal internal imports resolved using current TypeScript config; exact globals.css is a nonexecutable leaf",reachable:[...visited].map(path=>relative(process.cwd(),path)).sort(),edges,qualification:"Retained initial fresh-build assets qualify unchanged application only; changed CLI executes current tsx source"};
}
