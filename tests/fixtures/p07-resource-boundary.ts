export async function resourceBoundary(result: {endedMs:number|null}, measure:()=>Promise<void>, cleanup:[string,()=>Promise<void>][], save:()=>void) {
  await measure(); for(const [,action]of cleanup)await action();result.endedMs=performance.now();save();
}
