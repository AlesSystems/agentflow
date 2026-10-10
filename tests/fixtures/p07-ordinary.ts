export async function ordinaryStages<T>(steps:{repetitions:number;load:(index:number)=>Promise<void>;resource:()=>Promise<void>;flush:(index:number)=>Promise<void>;prepareNative:()=>Promise<T>;compare:(index:number,input:T)=>Promise<void>}){
 for(let index=0;index<steps.repetitions;index++)await steps.load(index);await steps.resource();for(let index=1;index<=steps.repetitions;index++)await steps.flush(index);const input=await steps.prepareNative();for(let index=1;index<=steps.repetitions;index++)await steps.compare(index,input);
}
export async function ordinaryBoundary(result:{failures:string[];finishedAt?:string;cleanup?:string},work:()=>Promise<void>,save:()=>void,summary:()=>void,exitFailure:()=>void){
 try{await work();}catch(error){result.failures.push(error instanceof Error?error.message:"unknown failure");exitFailure();}
 finally{result.finishedAt=new Date().toISOString();result.cleanup="Owned teardown attempted; synthetic roots retained";save();summary();}
}
