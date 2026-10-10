import {constants,closeSync,fstatSync,fchmodSync,lstatSync,openSync,realpathSync} from "node:fs";
import {join} from "node:path";
export type Identity={uid:number;dev:number;ino:number;mode:number};
export type CopyIdentity={dir:Identity;main:Identity;credentials:Identity};
export const identity=(path:string):Identity=>{const s=lstatSync(path);return {uid:s.uid,dev:s.dev,ino:s.ino,mode:s.mode&0o777};};
export function registerCopy(dir:string):CopyIdentity{return {dir:identity(dir),main:identity(join(dir,"agentflow.sqlite")),credentials:identity(join(dir,"credentials.json"))};}
export function privateCopy(dir:string,expected:CopyIdentity,normalize=false){
 const same=(a:Identity,b:Identity)=>a.uid===b.uid&&a.dev===b.dev&&a.ino===b.ino;
 const root=lstatSync(dir);
 if(realpathSync(dir)!==dir||!root.isDirectory()||root.isSymbolicLink()||!same(identity(dir),expected.dir)||root.uid!==process.getuid!()||(root.mode&0o777)!==0o700)throw new Error("UNSAFE_COPY_DIRECTORY");
 const opened:{path:string;fd:number;before:Identity;database:boolean}[]=[];
 try{
  for(const name of ["agentflow.sqlite","credentials.json","agentflow.sqlite-wal","agentflow.sqlite-shm","agentflow.sqlite-journal"]){
   const path=join(dir,name);let stat;try{stat=lstatSync(path);}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT"&&name!=="agentflow.sqlite"&&name!=="credentials.json")continue;throw error;}
   if(stat.isSymbolicLink()||!stat.isFile()||stat.nlink!==1||stat.uid!==process.getuid!()||stat.dev!==root.dev||realpathSync(path)!==path)throw new Error("UNSAFE_COPY_FILE");
   const before=identity(path),known=name==="agentflow.sqlite"?expected.main:name==="credentials.json"?expected.credentials:null;
   if(known&&!same(before,known))throw new Error("COPY_IDENTITY_CHANGED");
   const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);const descriptor=fstatSync(fd);
   if(descriptor.dev!==before.dev||descriptor.ino!==before.ino||descriptor.uid!==before.uid||descriptor.nlink!==1||!descriptor.isFile()){closeSync(fd);throw new Error("COPY_DESCRIPTOR_CHANGED");}
   opened.push({path,fd,before,database:name!=="credentials.json"});
  }
  // Validate every input before changing any inode. Credentials must already be private.
  for(const file of opened)if((!normalize||!file.database)&&file.before.mode!==0o600)throw new Error("UNSAFE_COPY_MODE");
  for(const file of opened){if(normalize&&file.database)fchmodSync(file.fd,0o600);const after=fstatSync(file.fd);if(after.dev!==file.before.dev||after.ino!==file.before.ino||after.uid!==file.before.uid||after.nlink!==1||(after.mode&0o777)!==0o600||!same(identity(file.path),file.before))throw new Error("COPY_POSTCHECK_FAILED");}
  return opened.map(file=>({path:file.path,...identity(file.path),nlink:fstatSync(file.fd).nlink}));
 }finally{for(const file of opened)closeSync(file.fd);}
}
