import {mergeData,clearBlankPlayerIds,applyUnguarded,recomputeBreaks} from './core.js';

// PostgreSQL JSONB changes object-key order. Compare values, not serialization order.
export function sameRecord(a,b){const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).filter(key=>value[key]!==undefined).sort().map(key=>[key,ordered(value[key])])):value;return JSON.stringify(ordered(a))===JSON.stringify(ordered(b));}
const content=record=>Object.fromEntries(Object.entries(record).filter(([key])=>key!=='updatedAt'));
function teamDiffers(shared,device){
 for(const key of ['name','rating'])if(Object.hasOwn(device,key)&&!sameRecord(shared[key],device[key]))return true;
 for(const collection of ['players','groups'])for(const row of device[collection]||[]){const known=shared[collection]?.find(item=>item.id===row.id);if(known&&Object.entries(row).some(([key,value])=>key!=='updatedAt'&&!sameRecord(known[key],value)))return true;}
 return false;
}
export function prepareDeviceImport(current,incoming){
 const local=structuredClone(incoming);for(const game of local.games){clearBlankPlayerIds(game);applyUnguarded(game);recomputeBreaks(game);}
 const result=mergeData(current,local),conflicts=[];
 // Existing records stay intact unless explicitly selected in the review.
 result.data.games=result.data.games.map(game=>structuredClone(current.games.find(known=>known.id===game.id)||game));
 for(const team of result.data.teams){const shared=current.teams.find(known=>known.id===team.id);if(!shared)continue;const extra=Object.fromEntries(['players','groups'].map(key=>[key,(team[key]||[]).filter(row=>!shared[key]?.some(known=>known.id===row.id))]));Object.assign(team,structuredClone(shared));for(const key of ['players','groups'])team[key]=[...structuredClone(shared[key]||[]),...extra[key]];}
 const add=(kind,device,shared,label,detail)=>conflicts.push({key:kind+':'+device.id,kind,id:device.id,device,shared,label,detail,recommendDevice:(Date.parse(device.updatedAt)||0)>(Date.parse(shared.updatedAt)||0)});
 for(const device of local.games){const shared=current.games.find(game=>game.id===device.id);if(!shared||sameRecord(content(shared),content(device)))continue;
  const byId=new Map(shared.events.map(event=>[event.id,event])),changed=device.events.filter(event=>byId.has(event.id)&&!sameRecord(event,byId.get(event.id))).length,newPlays=device.events.filter(event=>!byId.has(event.id)).length,deviceIds=new Set(device.events.map(event=>event.id)),sharedOnly=shared.events.filter(event=>!deviceIds.has(event.id)).length;
  const detail=[changed?`${changed} changed plays`:'',newPlays?`${newPlays} plays only on this device`:'',sharedOnly?`${sharedOnly} plays only in the shared copy`:'',!sameRecord(shared.veoSession,device.veoSession)?'Video setup differs':''].filter(Boolean).join(' · ')||'Game details or edit history differ';
  add('game',device,shared,`${current.teams.find(t=>t.id===device.teamId)?.name||'Team'} vs ${device.opponent} · ${device.date.slice(0,10)}`,detail);
 }
 for(const device of local.teams){const shared=current.teams.find(team=>team.id===device.id);if(shared&&teamDiffers(shared,device))add('team',device,shared,device.name,'Roster or team details differ. Merging keeps players recorded in either library.');}
 if(!current.games.length&&!current.teams.length)result.data.settings=structuredClone(local.settings||current.settings);
 else if(local.settings&&!sameRecord(local.settings,current.settings))add('settings',{id:'settings',...local.settings},{id:'settings',...current.settings},'Statistics settings',`Shared: ${JSON.stringify(current.settings)} · This device: ${JSON.stringify(local.settings)}`);
 return {...result,conflicts};
}
export function resolveDeviceImport(plan,deviceChoices){
 const data=structuredClone(plan.data),selected=new Set(deviceChoices);
 for(const conflict of plan.conflicts){if(!selected.has(conflict.key))continue;const local=structuredClone(conflict.device);
  if(conflict.kind==='game'){data.games[data.games.findIndex(game=>game.id===conflict.id)]=local;}
  else if(conflict.kind==='settings'){delete local.id;data.settings=local;}
  else{const team=data.teams.find(team=>team.id===conflict.id);for(const [key,value] of Object.entries(local))if(!['players','groups'].includes(key))team[key]=value;for(const collection of ['players','groups']){team[collection]??=[];for(const row of local[collection]||[]){const known=team[collection].find(item=>item.id===row.id);if(known)Object.assign(known,row);else team[collection].push(row);}}}
 }
 return data;
}
