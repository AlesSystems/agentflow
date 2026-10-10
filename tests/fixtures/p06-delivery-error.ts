import Database from "better-sqlite3";
import { main } from "../../src/cli/main";
const mode=process.argv[2],original=Database.prototype.exec;
Database.prototype.exec=function(sql:string){
 if(sql==="BEGIN EXCLUSIVE"&&this.name.endsWith("delivery.sqlite")) {
  if(mode==="forged")throw Object.assign(new Error("private forged delivery failure"),{code:"SQLITE_BUSY"});
  throw new Database.SqliteError("private native delivery failure",mode);
 }
 return original.call(this,sql);
};
try{process.exitCode=await main(process.argv.slice(3));}finally{Database.prototype.exec=original;}
