import { constants, openSync, closeSync, fstatSync, lstatSync, readSync } from "node:fs";
import { isAbsolute, dirname, join, parse, resolve } from "node:path";
import { z } from "zod";
import { githubRepository, type GithubRefreshInput, type GithubOutcome, type GithubError, type GithubMetadata } from "../../contracts/github";
import { activeAppRoot, privateDestination } from "../../server/filesystem";
const failure=(error:GithubError,retryNotBefore:number|null=null):GithubOutcome=>({outcome:error==="interrupted"?"interrupted":"failed",error,retryNotBefore,items:[],nextPage:null});
function token(path:string|undefined){
 if(!path)throw Error("credential_unavailable");
 let fd:number|undefined;
 try{
  if(!isAbsolute(path))throw Error();
  path=privateDestination(path,activeAppRoot());
  let current=parse(path).root;
  for(const part of path.slice(current.length).split("/").filter(Boolean)){current=join(current,part);if(lstatSync(current).isSymbolicLink())throw Error();}
  const parent=dirname(path);if(!lstatSync(parent).isDirectory())throw Error();
  fd=openSync(resolve(path),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const before=fstatSync(fd);
  if(!before.isFile()||before.nlink!==1||(before.mode&0o777)!==0o600||before.uid!==process.getuid?.()||before.size>4096)throw Error();
  const buffer=Buffer.alloc(4097);let offset=0;while(offset<buffer.length){const read=readSync(fd,buffer,offset,buffer.length-offset,null);if(!read)break;offset+=read;}
  const after=fstatSync(fd);if(offset>4096||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw Error();
  return z.strictObject({token:z.string().min(1).max(2048).regex(/^[\x21-\x7e]+$/)}).parse(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(buffer.subarray(0,offset)))).token;
 }catch{throw Error("credential_repair");}finally{if(fd!==undefined)closeSync(fd);}
}
const remote=z.object({number:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),html_url:z.string().max(300),title:z.string().max(1000),state:z.enum(["open","closed"]),draft:z.boolean(),head:z.object({sha:z.string().regex(/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/)}),base:z.object({ref:z.string().min(1).max(255)}),merged_at:z.iso.datetime().nullable()});
function project(value:unknown,request:GithubRefreshInput):GithubMetadata{
 const row=remote.parse(value);const url=`https://github.com/${request.repository}/pull/${row.number}`;
 const parsed=new URL(row.html_url);
 if(parsed.protocol!=="https:"||parsed.hostname!=="github.com"||parsed.port||parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname.toLowerCase()!==`/${request.repository}/pull/${row.number}`||"number" in request&&row.number!==request.number)throw Error();
 return {repository:request.repository,number:row.number,url,title:row.title,state:row.state,draft:row.draft,headSha:row.head.sha.toLowerCase(),baseBranch:row.base.ref,mergedAt:row.merged_at};
}
function nextPage(link:string|null,request:GithubRefreshInput){
 if(!link)return null;if(!("page" in request))throw Error();
 let next:number|null=null;let hasNext=false;
 for(const part of link.split(",")){
  const match=/^\s*<([^>]+)>;\s*rel="([a-z ]+)"\s*$/.exec(part);if(!match)throw Error();
  const url=new URL(match[1]);
  if(url.origin!=="https://api.github.com"||url.pathname!==`/repos/${request.repository}/pulls`||url.username||url.password||url.hash)throw Error();
  const params=url.searchParams;const keys=[...params.keys()];
  if(keys.length!==4||new Set(keys).size!==4||params.get("state")!=="all"||params.get("per_page")!=="20"||params.get("sort")!=="created"||!/^[1-9][0-9]*$/.test(params.get("page")??""))throw Error();
  const page=params.get("page")!;
  if(match[2].split(" ").includes("next")){if(hasNext||page!==String(request.page+1))throw Error();hasNext=true;if(request.page<1000)next=request.page+1;}
 }
 return next;
}
function rate(response:Response,now:number){
 const retry=response.headers.get("retry-after");const reset=response.headers.get("x-ratelimit-reset");
 let value:number|null=null;
 if(retry){const seconds=/^\d+$/.test(retry)?Number(retry)*1000:Date.parse(retry)-now;if(Number.isFinite(seconds)&&seconds>0)value=now+Math.min(seconds,86400000);}
 if(response.headers.get("x-ratelimit-remaining")==="0"&&reset&&/^\d+$/.test(reset)){const time=Number(reset)*1000;if(Number.isSafeInteger(time)&&time>now)value=Math.max(value??0,Math.min(time,now+86400000));}
 return value;
}
export class GithubAdapter {
 constructor(private credentialPath:string|undefined,private transport:typeof fetch=fetch){}
 credentialState():"configured"|"unavailable"{return this.credentialPath?"configured":"unavailable";}
 async observe(request:GithubRefreshInput,signal:AbortSignal):Promise<GithubOutcome>{
  let credential:string;try{credential=token(this.credentialPath);}catch(error){return failure((error as Error).message==="credential_unavailable"?"credential_unavailable":"credential_repair");}
  const controller=new AbortController();let timeout=false;
  const abort=()=>controller.abort();signal.addEventListener("abort",abort,{once:true});if(signal.aborted)abort();
  const timer=setTimeout(()=>{timeout=true;controller.abort();},8000);let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;let received=false;
  try{
   const repository=githubRepository.parse(request.repository);
   const url=`https://api.github.com/repos/${repository}/pulls`+("number" in request?`/${request.number}`:`?state=all&per_page=20&sort=created&page=${request.page}`);
   const response=await this.transport(url,{method:"GET",headers:{Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2026-03-10",Authorization:`Bearer ${credential}`},redirect:"manual",signal:controller.signal});
   received=true;const retry=rate(response,Date.now());
   if(response.status>=300&&response.status<400){await response.body?.cancel();return failure("redirect_rejected");}
   if(!response.ok){await response.body?.cancel();return failure(response.status===401?"authentication":response.status===403?(retry?"rate_limited":"forbidden"):response.status===404?"inaccessible":response.status===429?"rate_limited":"upstream",response.status===429?(retry??Date.now()+60000):retry);}
   const declared=response.headers.get("content-length");if(declared&&Number(declared)>2097152){await response.body?.cancel();return failure("response_too_large");}
   reader=response.body?.getReader();if(!reader)return failure("invalid_payload");
   const chunks:Uint8Array[]=[];let bytes=0;
   while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>2097152){await reader.cancel();return failure("response_too_large");}chunks.push(chunk.value);}
   const parsed=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks)));
   const values="number" in request?[parsed]:z.array(z.unknown()).max(20).parse(parsed);
   const items=values.map(value=>project(value,request));if(new Set(items.map(item=>item.number)).size!==items.length)throw Error();
   return {outcome:"fetched",error:null,retryNotBefore:retry,items,nextPage:nextPage(response.headers.get("link"),request)};
  }catch{if(controller.signal.aborted)return failure(timeout?"timeout":"interrupted");return failure(received?"invalid_payload":"offline");}
  finally{clearTimeout(timer);signal.removeEventListener("abort",abort);if(reader){try{await reader.cancel();}catch{}reader.releaseLock();}}
 }
}
