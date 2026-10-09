import type { Task } from "../contracts/tasks";
export type FrozenCommand = {path:string;method:"POST"|"PATCH";body:string;key:string};
export function freezeCommand(path:string,method:FrozenCommand["method"],body:unknown):FrozenCommand{return {path,method,body:JSON.stringify(body),key:crypto.randomUUID()};}
export function moveIntent(from:Task["status"],to:Task["status"]){
 if(from===to)return {kind:"none"} as const;
 if(to==="completed")return from==="review"?{kind:"accept"} as const:{kind:"reviewFirst"} as const;
 return {kind:"patch",status:to} as const;
}
