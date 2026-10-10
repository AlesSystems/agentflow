import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync,readFileSync,readdirSync,statSync,writeFileSync } from "node:fs";
import { join } from "node:path";
const output=process.argv[2];assert(output&&!existsSync(output),"fresh private output path required");
const hash=(path:string)=>createHash("sha256").update(readFileSync(path)).digest("hex");
const lock=JSON.parse(readFileSync("package-lock.json","utf8"));
const entries=Object.entries(lock.packages as Record<string,{version?:string;integrity?:string;license?:string;optional?:boolean}>).filter(([path])=>path).map(([path,entry])=>{
  const metadataPath=join(path,"package.json"),installed=existsSync(metadataPath);
  const metadata=installed?JSON.parse(readFileSync(metadataPath,"utf8")):null;
  const notices=installed?readdirSync(path).filter(name=>/^(license|licence|copying|notice)(\.|$)/i.test(name)&&statSync(join(path,name)).isFile()).map(name=>({name,sha256:hash(join(path,name))})):[];
  return {packagePath:path,version:entry.version??null,integrity:entry.integrity??null,lockedLicense:entry.license??null,installedLicense:metadata?.license??null,optional:entry.optional??false,installed,notices,status:installed?(notices.length?"notice files inventoried":"metadata only; notice files unknown"):(entry.optional?"optional not installed":"not installed")};
});
const assets=(existsSync("public")?readdirSync("public",{recursive:true}):[]).map(String).filter(path=>statSync(join("public",path)).isFile()).map(path=>({path,sha256:hash(join("public",path))}));
writeFileSync(output,JSON.stringify({lockSha256:hash("package-lock.json"),entries,assets,qualification:"Installed top-level license/notice hashes and lock metadata inventory. Optional missing and unknown entries remain explicit. This is not a legal completeness opinion."},null,2)+"\n",{mode:0o600});
console.log(JSON.stringify({entries:entries.length,installed:entries.filter(entry=>entry.installed).length,optionalMissing:entries.filter(entry=>!entry.installed&&entry.optional).length,unknownNotices:entries.filter(entry=>entry.installed&&!entry.notices.length).length,assets:assets.length}));
