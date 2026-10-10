import {constants,closeSync,fstatSync,fchmodSync,lstatSync,openSync,realpathSync,existsSync} from "node:fs";
import {join} from "node:path";
export type Identity={uid:number;dev:number;ino:number;mode:number};
export type CopyIdentity={dir:Identity;main:Identity;credentials:Identity};
export const identity=(path:string):Identity=>{const s=lstatSync(path);return {uid:s.uid,dev:s.dev,ino:s.ino,mode:s.mode&0o777};};
export function registerCopy(dir:string):CopyIdentity{return {dir:identity(dir),main:identity(join(dir,"agentflow.sqlite")),credentials:identity(join(dir,"credentials.json"))};}
export function privateCopy(dir:string,expected:CopyIdentity,normalize=false){
 void dir;void expected;void normalize;void constants;void closeSync;void fstatSync;void fchmodSync;void openSync;void realpathSync;void existsSync;
 throw new Error("COPY_PERMISSION_SEAM_NOT_IMPLEMENTED");
}
