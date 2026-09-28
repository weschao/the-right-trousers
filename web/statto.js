import {emptyData,FIELD,validateData} from './core.js';
const sorted=a=>[...(a||[])].sort((a,b)=>(a.createdAt||'').localeCompare(b.createdAt||''));
const string=v=>typeof v==='string'?v:'';
// Read the ZIP central directory; accept only the requested JSON member, never extract paths.
export async function readStattoZip(buffer){
 const v=new DataView(buffer), bytes=new Uint8Array(buffer);let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(v.getUint32(i,true)===0x06054b50){end=i;break;}
 if(end<0)throw new Error('Not a supported Statto ZIP archive.');
 let p=v.getUint32(end+16,true);const count=v.getUint16(end+10,true);
 for(let i=0;i<count;i++){
  if(p+46>bytes.length||v.getUint32(p,true)!==0x02014b50)throw new Error('Damaged ZIP directory.');
  const flags=v.getUint16(p+8,true),method=v.getUint16(p+10,true),size=v.getUint32(p+20,true),expanded=v.getUint32(p+24,true),n=v.getUint16(p+28,true),extra=v.getUint16(p+30,true),comment=v.getUint16(p+32,true),offset=v.getUint32(p+42,true);
  const name=new TextDecoder().decode(bytes.slice(p+46,p+46+n));p+=46+n+extra+comment;
  if(name!=='data.json')continue;
  if(flags&1)throw new Error('Encrypted Statto archives are not supported.');
  if(expanded>50000000||size>50000000)throw new Error('Archive is too large (50 MB limit).');
  if(offset+30>bytes.length||v.getUint32(offset,true)!==0x04034b50)throw new Error('Damaged ZIP entry.');
  const start=offset+30+v.getUint16(offset+26,true)+v.getUint16(offset+28,true);
  if(start+size>bytes.length)throw new Error('Truncated ZIP entry.');
  let result=bytes.slice(start,start+size);
  if(method===8){
   let decompressor;try{decompressor=new DecompressionStream('deflate-raw');}catch{throw new Error('This browser cannot open compressed Statto files. Update your browser or use the included desktop converter.');}
   const reader=new Blob([result]).stream().pipeThrough(decompressor).getReader();const chunks=[];let length=0;
   while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>50000000){await reader.cancel();throw new Error('Expanded archive exceeds 50 MB.');}chunks.push(value);}
   result=new Uint8Array(length);let pos=0;for(const chunk of chunks){result.set(chunk,pos);pos+=chunk.length;}
  }else if(method!==0)throw new Error('Unsupported ZIP compression.');
  return JSON.parse(new TextDecoder().decode(result));
 }
 throw new Error('This archive does not contain data.json.');
}
export function convertStatto(raw,{length=110,width=40}={}){
 if(!raw||!Array.isArray(raw.teams)||!raw.teams.every(t=>t.data?.team&&t.data?.relations))throw new Error('Unrecognized Statto export.');
 const output=emptyData();const sourceId='statto:'+String(raw.filename||raw.metadata?.date||'archive');
 output.sources.push({id:sourceId,kind:'statto',original:raw});
 const location=(x,y)=>({x:(1-Number(y))*length,y:Number(x)*width});
 const base=(r,type,fields)=>({id:'statto:'+r.uuid,type,at:r.createdAt,...fields});
 for(const entry of raw.teams){
  const {team:t,relations:r}=entry.data;
  output.teams.push({id:t.uuid,name:t.name,players:(r.players||[]).map(p=>({id:p.uuid,name:string(p.name).trim()||'Unknown',number:typeof p.number==='number'?String(p.number):string(p.number)})),groups:(r.groups||[]).map(g=>({id:g.uuid,name:g.title,playerIds:g.playerUUIDs}))});
  const possessionById=new Map((r.possessions||[]).map(p=>[p.uuid,p]));
  for(const g of r.games||[]){
   const game={id:g.uuid,teamId:t.uuid,opponent:g.opponent||'Unknown',date:g.date,finished:!!g.isFinished,opponents:[],field:{...FIELD,length,width},events:[],source:{id:sourceId,pitchKind:g.pitchKind,coordinates:'inferred: normalized portrait; attacks toward y=0',defenseAvailable:false},importNotes:['Historical opponent passes and defender assignments were not recorded. Defensive yardage is unavailable.','Coordinates rotated from Statto portrait orientation. Imported yardage uses '+length+' × '+width+' yd; original pitchKind is retained but not decoded.'],updatedAt:g.createdAt};
   for(const p of sorted((r.points||[]).filter(p=>p.gameUUID===g.uuid))){
    game.events.push(base(p,'point_start',{line:p.playerUUIDs||[],starting:p.isOffense?'O':'D',direction:1}));
    const records=[];
    for(const possession of (r.possessions||[]).filter(s=>s.pointUUID===p.uuid))records.push({...possession,_type:'possession_start'});
    for(const pass of (r.passes||[]).filter(s=>possessionById.get(s.possessionUUID)?.pointUUID===p.uuid))records.push({...pass,_type:'pass'});
    for(const block of (r.defensiveBlocks||[]).filter(b=>b.pointUUID===p.uuid))records.push({...block,_type:'block'});
    for(const error of (r.oppositionErrors||[]).filter(b=>b.pointUUID===p.uuid))records.push({...error,_type:'opponent_error'});
    for(const stall of (r.stallOutsAgainst||[]).filter(s=>possessionById.get(s.possessionUUID)?.pointUUID===p.uuid))records.push({...stall,_type:'stall'});
    for(const rec of sorted(records)){
     let e;
     if(rec._type==='possession_start')e=base(rec,'possession_start',{side:'us',playerId:rec.initiatorUUID||null,location:location(rec.startX,rec.startY),markerId:null});
     if(rec._type==='pass')e=base(rec,'pass',{side:'us',throwerId:rec.throwerUUID||null,receiverId:rec.receiverUUID||null,from:location(rec.startX,rec.startY),to:location(rec.endX,rec.endY),outcome:rec.isAssist?'goal':rec.isReceiverError?'drop':rec.isThrowerError?'throwaway':'complete',markerId:null,receiverDefenderId:null,blockerId:null,sourcePossessionId:rec.possessionUUID,sourceSecondaryAssist:rec.isSecondaryAssist});
     if(rec._type==='block')e=base(rec,'turnover',{side:'them',reason:rec.isStallOut?'stall':'block',blockerId:rec.playerUUID||null,location:location(rec.locationX,rec.locationY),callahan:!!rec.isCallahan});
     if(rec._type==='opponent_error')e=base(rec,'turnover',{side:'them',reason:'opponent_error'});
     if(rec._type==='stall')e=base(rec,'turnover',{side:'us',reason:'stall',playerId:rec.playerUUID,location:location(rec.locationX,rec.locationY)});
     if(e)game.events.push(e);
    }
    if(p.result===1||p.result===-1)game.events.push({id:'statto:result:'+p.uuid,type:'point_end',at:game.events.at(-1).at,winner:p.result===1?'us':'them'});
   }
   output.games.push(game);
  }
 }
 return validateData(output);
}
