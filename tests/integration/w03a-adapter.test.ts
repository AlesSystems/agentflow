import { createServer, type RequestListener } from "node:http";
import { mkdtempSync, realpathSync, writeFileSync, chmodSync, symlinkSync, linkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { GithubAdapter } from "../../src/integrations/github/adapter";
const metadata={number:9,html_url:"https://github.com/a/b/pull/9",title:"Synthetic PR",state:"open",draft:false,head:{sha:"a".repeat(40)},base:{ref:"main"},merged_at:null,body:"DISCARDED_BODY",user:{login:"DISCARDED_PROFILE"}};
async function fixture(handler:RequestListener){
 const server=createServer(handler);await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 const port=(server.address() as {port:number}).port;
 const transport:typeof fetch=(url,init)=>fetch(String(url).replace("https://api.github.com",`http://127.0.0.1:${port}`),init);
 return {transport,close:()=>new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();})};
}
function credential(){const root=mkdtempSync(join(realpathSync(tmpdir()),"w03a-token-"));const path=join(root,"token.json");writeFileSync(path,JSON.stringify({token:"SYNTHETIC_TOKEN"}),{mode:0o600});return {root,path};}
it("uses selected fixed-origin GET and discards extra fields",async()=>{
 const file=credential();const requests:{url:string;method:string|undefined;headers:unknown}[]=[];
 const http=await fixture((req,res)=>{requests.push({url:req.url!,method:req.method,headers:req.headers});res.setHeader("Content-Type","application/json");res.end(JSON.stringify(metadata));});
 try{const adapter=new GithubAdapter(file.path,http.transport);const result=await adapter.observe({expectedVersion:2,repository:"a/b",number:9},new AbortController().signal);
 expect(result.outcome).toBe("fetched");expect(JSON.stringify(result)).not.toMatch(/DISCARDED|SYNTHETIC_TOKEN/);
 expect(requests).toMatchObject([{url:"/repos/a/b/pulls/9",method:"GET",headers:{accept:"application/vnd.github+json","x-github-api-version":"2026-03-10",authorization:"Bearer SYNTHETIC_TOKEN"}}]);
 }finally{await http.close();}
});
it("rejects redirects, malformed identities, unsafe pagination and invalid bytes without following",async()=>{
 const file=credential();let calls=0;let mode="redirect";
 const http=await fixture((req,res)=>{calls++;if(mode==="redirect"){res.writeHead(302,{location:"/unselected"});res.end();}else if(mode==="utf8")res.end(Buffer.from([0xff]));else if(mode==="identity")res.end(JSON.stringify({...metadata,number:10}));else {res.setHeader("Link",'<https://evil/repos/a/b/pulls?page=2>; rel="next"');res.end(JSON.stringify([metadata]));}});
 try{const adapter=new GithubAdapter(file.path,http.transport);
 for(const [value,error]of [["redirect","redirect_rejected"],["utf8","invalid_payload"],["identity","invalid_payload"]]){mode=value;expect(await adapter.observe({expectedVersion:2,repository:"a/b",number:9},new AbortController().signal)).toMatchObject({outcome:"failed",error});}
 mode="link";expect(await adapter.observe({expectedVersion:2,repository:"a/b",page:1},new AbortController().signal)).toMatchObject({outcome:"failed",error:"invalid_payload"});expect(calls).toBe(4);
 }finally{await http.close();}
});
it("redacts status failures and respects bounded rate windows",async()=>{
 const file=credential();let status=401;
 const http=await fixture((req,res)=>{res.writeHead(status,status===429?{"Retry-After":"10"}:{});res.end("SYNTHETIC_TOKEN raw failure");});
 try{const adapter=new GithubAdapter(file.path,http.transport);for(const [code,error]of [[401,"authentication"],[403,"forbidden"],[404,"inaccessible"],[429,"rate_limited"],[500,"upstream"]] as const){status=code;const result=await adapter.observe({expectedVersion:2,repository:"a/b",number:9},new AbortController().signal);expect(result).toMatchObject({outcome:"failed",error});expect(JSON.stringify(result)).not.toContain("SYNTHETIC_TOKEN");if(code===429)expect(result.retryNotBefore).toBeGreaterThan(Date.now());}}
 finally{await http.close();}
});
it("guards credential descriptors before network",async()=>{
 const file=credential();let calls=0;const http=await fixture((req,res)=>{calls++;res.end(JSON.stringify(metadata));});
 try{const cases=[undefined,file.path];chmodSync(file.path,0o644);
 for(const path of cases)expect(await new GithubAdapter(path,http.transport).observe({expectedVersion:2,repository:"a/b",number:9},new AbortController().signal)).toMatchObject({outcome:"failed",error:path?"credential_repair":"credential_unavailable"});
 chmodSync(file.path,0o600);const link=join(file.root,"link.json");symlinkSync(file.path,link);expect((await new GithubAdapter(link,http.transport).observe({expectedVersion:2,repository:"a/b",number:9},new AbortController().signal)).error).toBe("credential_repair");
 const hard=join(file.root,"hard.json");linkSync(file.path,hard);expect((await new GithubAdapter(file.path,http.transport).observe({expectedVersion:2,repository:"a/b",number:9},new AbortController().signal)).error).toBe("credential_repair");expect(calls).toBe(0);
 }finally{await http.close();}
});
it("rejects intermediate head lengths and oversized bodies, and accepts a same-query next-page hint",async()=>{
 const file=credential();let mode="sha";
 const http=await fixture((req,res)=>{if(mode==="sha")res.end(JSON.stringify({...metadata,head:{sha:"a".repeat(41)}}));else if(mode==="large")res.end("x".repeat(2097153));else{res.setHeader("Link",'<https://api.github.com/repos/a/b/pulls?state=all&per_page=20&sort=created&page=2>; rel="next"');res.end(JSON.stringify([metadata]));}});
 try{const adapter=new GithubAdapter(file.path,http.transport);expect(await adapter.observe({expectedVersion:2,repository:"a/b",number:9},new AbortController().signal)).toMatchObject({error:"invalid_payload"});mode="large";expect(await adapter.observe({expectedVersion:2,repository:"a/b",number:9},new AbortController().signal)).toMatchObject({error:"response_too_large"});mode="link";expect(await adapter.observe({expectedVersion:2,repository:"a/b",page:1},new AbortController().signal)).toMatchObject({outcome:"fetched",nextPage:2});}finally{await http.close();}
});
it("enforces the total eight-second deadline before headers and during a streaming body",async()=>{
 const file=credential();let mode="headers";
 const http=await fixture((req,res)=>{if(mode==="body"){res.writeHead(200);res.write("[");}});
 try{const adapter=new GithubAdapter(file.path,http.transport);for(const value of ["headers","body"]){mode=value;const started=Date.now();expect(await adapter.observe({expectedVersion:2,repository:"a/b",page:1},new AbortController().signal)).toMatchObject({outcome:"failed",error:"timeout"});expect(Date.now()-started).toBeGreaterThanOrEqual(7900);expect(Date.now()-started).toBeLessThan(9500);}}finally{await http.close();}
},20000);
it("rejects invalid credential JSON, UTF-8, unknown keys and excessive sizes without remote requests",async()=>{
 const file=credential();let calls=0;const http=await fixture((req,res)=>{calls++;res.end("{}");});
 try{for(const contents of ["{bad",Buffer.from([0xff]),JSON.stringify({token:"SYNTHETIC",path:"forbidden"}),"x".repeat(4097),JSON.stringify({token:"has whitespace"})]){writeFileSync(file.path,contents);expect(await new GithubAdapter(file.path,http.transport).observe({expectedVersion:2,repository:"a/b",number:9},new AbortController().signal)).toMatchObject({error:"credential_repair"});}expect(calls).toBe(0);}finally{await http.close();}
});
it("keeps valid rows when unused pagination exceeds the local cap, and bounds only emitted next hints",async()=>{
 const file=credential();let link='';const wires:string[]=[];
 const target=(page:string,origin="https://api.github.com",query="state=all&per_page=20&sort=created")=>`${origin}/repos/a/b/pulls?${query}&page=${page}`;
 const http=await fixture((req,res)=>{wires.push(req.url!);res.setHeader("Link",link);res.end(JSON.stringify([metadata]));});
 try{
  const adapter=new GithubAdapter(file.path,http.transport);
  for(const last of ["1001","1000000000000000000000000000000"]){
   link=`<${target("2")}>; rel="next", <${target(last)}>; rel="last"`;
   expect(await adapter.observe({expectedVersion:2,repository:"a/b",page:1},new AbortController().signal)).toMatchObject({outcome:"fetched",items:[{number:9}],nextPage:2});
  }
  link=`<${target("1001")}>; rel="next", <${target("1001")}>; rel="last"`;
  expect(await adapter.observe({expectedVersion:2,repository:"a/b",page:1000},new AbortController().signal)).toMatchObject({outcome:"fetched",items:[{number:9}],nextPage:null});
  for(const malicious of [target("1001","https://evil.test"),target("1001","https://api.github.com","state=closed&per_page=20&sort=created")]){
   link=`<${target("2")}>; rel="next", <${malicious}>; rel="last"`;
   expect(await adapter.observe({expectedVersion:2,repository:"a/b",page:1},new AbortController().signal)).toMatchObject({outcome:"failed",error:"invalid_payload",items:[]});
  }
  expect(wires).toHaveLength(5);expect(wires.filter(value=>value.endsWith("page=1"))).toHaveLength(4);expect(wires[2]).toContain("page=1000");
 }finally{await http.close();}
});
