import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFileSync,existsSync} from "node:fs";
import {resolve,dirname,relative} from "node:path";
import ts from "typescript";
const outbox="src/cli/outbox.ts";
export const reviewedOutboxSHA256="1eef5f50075acf4bcf5334c1ede3539f9781af1c127e899f3a3f9fa2e8dd93b9";
const hash=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
export function retainedApplication(baseline:string){
 const paths=["src","migrations","package.json","package-lock.json","next.config.ts"];
 const changed=execFileSync("git",["diff","--name-only",baseline,"--",...paths],{encoding:"utf8"}).trim().split("\n").filter(Boolean);
 assert(changed.every(path=>path===outbox),"Only the reviewed CLI outbox change qualifies retained application assets");
 assert.equal(hash(readFileSync(outbox)),reviewedOutboxSHA256,"Reviewed CLI source hash required");
 const files=execFileSync("git",["ls-files","--",...paths],{encoding:"utf8"}).trim().split("\n");
 const unchanged=Object.fromEntries(files.filter(path=>path!==outbox).map(path=>{const bytes=readFileSync(path);assert(bytes.equals(execFileSync("git",["show",`${baseline}:${path}`],{maxBuffer:10*1024*1024})),`Changed application input: ${path}`);return [path,hash(bytes)];}));
 const config=ts.readConfigFile("tsconfig.json",ts.sys.readFile);assert(!config.error);const options=ts.parseJsonConfigFileContent(config.config,ts.sys,process.cwd()).options;
 const roots=files.filter(path=>/^src\/(app|server)\//.test(path)&&/\.[cm]?[jt]sx?$/.test(path));
 const visited=new Set<string>();const edges:Record<string,string[]>={};
 function visit(file:string){file=resolve(file);if(visited.has(file))return;visited.add(file);assert.notEqual(file,resolve(outbox),"Changed CLI outbox must be unreachable from application/server roots");
  const source=ts.createSourceFile(file,readFileSync(file,"utf8"),ts.ScriptTarget.Latest,true);const dependencies:string[]=[];
  function walk(node:ts.Node){let spec:string|undefined;if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier))spec=node.moduleSpecifier.text;
   if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(node.expression)&&node.expression.text==="require")){assert(node.arguments.length&&ts.isStringLiteral(node.arguments[0]),`Nonliteral module dependency: ${relative(process.cwd(),file)}`);spec=(node.arguments[0] as ts.StringLiteral).text;}
   if(spec){const resolved=ts.resolveModuleName(spec,file,options,ts.sys).resolvedModule;if(resolved&&!resolved.isExternalLibraryImport&&existsSync(resolved.resolvedFileName)){dependencies.push(relative(process.cwd(),resolved.resolvedFileName));visit(resolved.resolvedFileName);}else if(spec.startsWith(".")||spec.startsWith("@/")){assert(!/outbox/.test(resolve(dirname(file),spec)),"Unresolved outbox module");}}
   ts.forEachChild(node,walk);
  }walk(source);edges[relative(process.cwd(),file)]=dependencies;
 }roots.forEach(visit);
 return {baseline,cliSource:outbox,reviewedOutboxSHA256,unchanged,roots,reachable:[...visited].map(path=>relative(process.cwd(),path)).sort(),edges,qualification:"Retained initial fresh-build assets qualify unchanged application only; changed CLI executes current tsx source"};
}
