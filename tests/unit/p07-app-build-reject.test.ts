import {it,expect,vi,afterEach} from "vitest";
const control=vi.hoisted(()=>({kind:""}));
vi.mock("node:child_process",async importOriginal=>{const actual=await importOriginal<typeof import("node:child_process")>();return {...actual,execFileSync:(file:string,args:string[],options:unknown)=>{if(control.kind==="other-input"&&file==="git"&&args[0]==="diff"&&args.includes("--name-only"))return "src/server/launcher.ts\n";return Reflect.apply(actual.execFileSync,null,[file,args,options]);}};});
vi.mock("node:fs",async importOriginal=>{const actual=await importOriginal<typeof import("node:fs")>();return {...actual,readFileSync:(path:string,...args:unknown[])=>{const bytes=Reflect.apply(actual.readFileSync,null,[path,...args]);if(control.kind==="cli-hash"&&path==="src/cli/outbox.ts")return Buffer.concat([bytes as Buffer,Buffer.from("\n")]);if(control.kind==="asset"&&path.endsWith("BUILD_ID"))return Buffer.from("different");return bytes;}};});
import {retainedApplication} from "../fixtures/p07-app-build";
afterEach(()=>{control.kind="";});
it.each(["other-input","cli-hash","asset"])("actual retained-application guard rejects %s",kind=>{control.kind=kind;expect(()=>retainedApplication("36f6d1bc4699c706e3f57a17cfcc85a1576c648b")).toThrow();});
