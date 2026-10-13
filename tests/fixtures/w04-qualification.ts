import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { lstatSync,readFileSync,readdirSync,realpathSync } from "node:fs";
import { isAbsolute,join,relative } from "node:path";
import type Database from "better-sqlite3";
export const sha256=(bytes:string|Buffer)=>createHash("sha256").update(bytes).digest("hex");
export const fileSHA256=(path:string)=>sha256(readFileSync(path));
export function ownedDirectory(path:string,privateMode=false){
 assert(isAbsolute(path),"absolute owned directory required");const stat=lstatSync(path);
 assert(stat.isDirectory()&&!stat.isSymbolicLink()&&realpathSync(path)===path,"real directory required");assert.equal(stat.uid,process.getuid!(),"non-owned directory");
 if(privateMode)assert.equal(stat.mode&0o777,0o700,"mode0700 directory required");
 return {path,dev:stat.dev,ino:stat.ino,uid:stat.uid,gid:stat.gid,mode:stat.mode&0o777};
}
export function validateOutputRoot(path:string){const identity=ownedDirectory(path,true);assert.equal(readdirSync(path).length,0,"unused output directory required");return identity;}
export function fileManifest(root:string,paths:string[]){
 assert(paths.length>0,"nonempty manifest required");return Object.fromEntries(paths.sort().map(path=>{assert(!isAbsolute(path)&&!path.split("/").includes(".."),"safe manifest path required");const p=join(root,path),s=lstatSync(p);assert(s.isFile()&&!s.isSymbolicLink(),"regular manifest file required");return [path,fileSHA256(p)];}));
}
export function compiledManifest(root:string){
 const files:string[]=[];const walk=(dir:string)=>{for(const name of readdirSync(dir).sort()){if(name==="cache"||name==="diagnostics")continue;const p=join(dir,name),s=lstatSync(p);assert(!s.isSymbolicLink(),"compiled links forbidden");if(s.isDirectory())walk(p);else if(s.isFile())files.push(relative(root,p));}};
 walk(join(root,".next"));assert(files.includes(".next/BUILD_ID")&&files.some(p=>p.startsWith(".next/static/")),"compiled Next assets required");return fileManifest(root,files);
}
export type SourceBinding={root:ReturnType<typeof ownedDirectory>;commit:string;tree:string;shipping:Record<string,string>;packageSHA256:string;lockSHA256:string;helpers:Record<string,string>;runtime:{node:string;nodeSHA256:string;version:string;abi:string;npm:string;npmSHA256:string;addon:string;addonSHA256:string;sqlite:string;arch:string;platform:string};compiled:{buildId:string;files:Record<string,string>};browser:{executable:string;sha256:string;version:string};fingerprint:string};
export function captureSourceBinding(root:string,runtimeRoot:string,browser:SourceBinding["browser"],helperPaths:string[]):SourceBinding{
 const identity=ownedDirectory(root),runtime=ownedDirectory(runtimeRoot),node=join(runtime.path,"bin/node"),npm=join(runtime.path,"lib/node_modules/npm/bin/npm-cli.js");
 assert.equal(realpathSync(process.execPath),node,"owned executing runtime required");assert.equal(process.version,"v24.15.0");assert.equal(process.versions.modules,"137");assert.equal(process.platform,"darwin");assert.equal(process.arch,"arm64");
 assert.equal(execFileSync(node,[npm,"--version"],{encoding:"utf8"}).trim(),"11.12.1");
 const req=createRequire(join(root,"package.json")),Driver=req("better-sqlite3") as typeof Database;const db=new Driver(":memory:");let sqlite:string;try{sqlite=(db.prepare("SELECT sqlite_version() version").get() as {version:string}).version;}finally{db.close();}
 const addons=Object.keys(req.cache).filter(path=>path.endsWith(".node")&&path.startsWith(join(root,"node_modules/better-sqlite3")+"/"));assert.equal(addons.length,1,"actual loaded source addon required");
 assert.equal(fileSHA256(browser.executable),browser.sha256);assert.equal(execFileSync(browser.executable,["--version"],{encoding:"utf8"}).trim(),browser.version,"actual native Chrome version required");
 const git=(args:string[])=>execFileSync("/usr/bin/git",args,{cwd:root,encoding:"utf8"}).trim();const tracked=git(["ls-files"]).split("\n");
 const shippingPaths=tracked.filter(p=>p.startsWith("src/")||p.startsWith("migrations/")||["package.json","package-lock.json","next.config.ts","tsconfig.json","postcss.config.mjs",".npmrc",".node-version",".nvmrc"].includes(p));
 const binding={root:identity,commit:git(["rev-parse","HEAD"]),tree:git(["rev-parse","HEAD^{tree}"]),shipping:fileManifest(root,shippingPaths),packageSHA256:fileSHA256(join(root,"package.json")),lockSHA256:fileSHA256(join(root,"package-lock.json")),helpers:fileManifest(root,helperPaths),runtime:{node,nodeSHA256:fileSHA256(node),version:process.version,abi:process.versions.modules!,npm,npmSHA256:fileSHA256(npm),addon:addons[0],addonSHA256:fileSHA256(addons[0]),sqlite,arch:process.arch,platform:process.platform},compiled:{buildId:readFileSync(join(root,".next/BUILD_ID"),"utf8").trim(),files:compiledManifest(root)},browser};
 assert.equal(sqlite,"3.53.4");return {...binding,fingerprint:sha256(JSON.stringify(binding))};
}
export function verifySourceBinding(expected:SourceBinding,actual:SourceBinding){assert.deepEqual(actual,expected,"source/build/helper/runtime/browser binding changed");assert.equal(actual.fingerprint,sha256(JSON.stringify(Object.fromEntries(Object.entries(actual).filter(([key])=>key!=="fingerprint")))),"binding fingerprint invalid");}
