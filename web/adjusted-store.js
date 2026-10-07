// Point-level snapshots invalidate on edits, imports, roster changes and filters.
// A worker keeps model fitting and nested validation off the interaction thread.
export function createAdjustedStore(onChange,createWorker=()=>new Worker(new URL('./adjusted-worker.js',import.meta.url),{type:'module'})){
 const cache=new Map(),jobs=new Map();let sequence=0,worker;
 function fail(message){for(const entry of jobs.values()){entry.status='error';entry.error=message;}const failed=[...jobs.values()];jobs.clear();worker?.terminate();worker=null;for(const entry of failed)onChange(entry);}
 return {get(dataset){
  const key=JSON.stringify(dataset);if(cache.has(key))return cache.get(key);
  const entry={id:String(++sequence),status:'pending'};cache.set(key,entry);jobs.set(entry.id,entry);
  // Pending work is retained; completed snapshots are bounded across filters.
  if(cache.size>12)for(const [oldKey,old] of cache){if(cache.size<=12)break;if(old.status!=='pending')cache.delete(oldKey);}
  try{
   if(!worker){worker=createWorker();worker.onmessage=({data})=>{const entry=jobs.get(data.id);if(!entry)return;jobs.delete(data.id);Object.assign(entry,{status:data.error?'error':'ready',result:data.result,error:data.error});onChange(entry);};worker.onerror=()=>fail('The rating calculation could not run. Reload to try again.');}
   worker.postMessage({id:entry.id,dataset});
  }catch(error){fail(error.message||'The rating calculation could not run.');}
  return entry;
 }};
}
