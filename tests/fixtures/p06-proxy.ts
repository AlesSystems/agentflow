import { createServer,type IncomingMessage } from "node:http";
import type { launch } from "./server";
import { freePort } from "./server";
type Decision={drop:true}|{status:number;body:string;headers?:Record<string,string>};
export async function publicProxy(server: Awaited<ReturnType<typeof launch>>,decide: (request: IncomingMessage,body: Buffer,reply?: {status:number;body:Buffer;generation:string|null})=>Promise<Decision|undefined>|Decision|undefined) {
  const port=await freePort();
  const proxy=createServer(async(req,res)=> {
    try {
      const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=Buffer.concat(chunks);
      function finish(result:Decision){if("drop"in result){res.destroy();return;}res.writeHead(result.status,result.headers);res.end(result.body);}
      const before=await decide(req,body);if(before){finish(before);return;}
      const headers:Record<string,string>={};for(const name of ["authorization","content-type","idempotency-key"]){const value=req.headers[name];if(typeof value==="string")headers[name]=value;}
      const response=await fetch(server.url+req.url,{method:req.method,headers,body:req.method==="POST"?body:undefined,redirect:"manual"});
      const bytes=Buffer.from(await response.arrayBuffer());
      const after=await decide(req,body,{status:response.status,body:bytes,generation:response.headers.get("agentflow-generation")});if(after){finish(after);return;}
      const forwarded=Object.fromEntries([...response.headers].filter(([name])=>!["content-encoding","content-length","transfer-encoding","connection","keep-alive"].includes(name)));
      res.writeHead(response.status,forwarded);res.end(bytes);
    }catch{res.destroy();}
  });
  await new Promise<void>(resolve=>proxy.listen(port,"127.0.0.1",resolve));
  return {port,close:()=>new Promise<void>(resolve=>proxy.close(()=>resolve()))};
}
