export const FIELD = Object.freeze({length:110,width:40,endzone:20,brick:20,unit:'yd'});
export const uid = () => globalThis.crypto.randomUUID();
export const emptyData = () => ({format:'fieldbook',version:1,teams:[],games:[],sources:[]});
export const event = (type,fields={}) => ({id:uid(),type,at:new Date().toISOString(),...fields});
export const other = side => side === 'us' ? 'them' : 'us';
export function pointsOf(game) {
 const points=[]; let point;
 for(const e of game.events){
  if(e.type==='point_start') {point={...e,events:[],winner:null};points.push(point);}
  else if(point){point.events.push(e); if(e.type==='pass' && e.outcome==='goal')point.winner=e.side; if(e.type==='point_end')point.winner=e.winner; if(e.type==='turnover'&&e.callahan)point.winner=other(e.side);}
 }
 return points;
}
export function gameState(game){
 const points=pointsOf(game), point=points.at(-1);let side=point?.starting==='D'?'them':'us',holder=null,location=null,marker=null,needsPickup=true;
 for(const e of point?.events||[]){
  if(e.type==='possession_start'){side=e.side;holder=e.playerId;location=e.location;marker=e.markerId||null;needsPickup=false;}
  if(e.type==='pass'){
   location=e.to;
   if(['complete','goal'].includes(e.outcome)){side=e.side;holder=e.receiverId;marker=e.receiverDefenderId||null;needsPickup=false;}
   else {side=other(e.side);holder=null;marker=null;needsPickup=true;}
  }
  if(e.type==='turnover'){side=other(e.side);holder=null;location=e.location||location;marker=null;needsPickup=true;}
 }
 return {points,point,side,holder,location,marker,needsPickup,score:[points.filter(p=>p.winner==='us').length,points.filter(p=>p.winner==='them').length],active:!!point&&!point.winner,nextStarting:point?.winner==='us'?'D':'O',nextDirection:point?-(point.direction||1):1};
}
export function passMetrics(e,point){
 if(!e.from||!e.to)return {distance:0,gain:0};
 return {distance:Math.hypot(e.to.x-e.from.x,e.to.y-e.from.y),gain:(e.to.x-e.from.x)*(point.direction||1)*(e.side==='them'?-1:1)};
}
export const STAT_COLUMNS = [
 ['points','Pts'],['oPoints','O pts'],['dPoints','D pts'],['opportunities','O opp'],['passes','Throws'],['completions','Comp'],['catches','Catch'],['initiated','Poss init'],['goals','Goals'],['assists','Ast'],['secondaryAssists','2nd ast'],['throwaways','TA'],['drops','Drops'],['blocks','Blocks'],['throwDistance','Throw yd'],['throwGain','Throw gain'],['catchDistance','Catch yd'],['catchGain','Catch gain'],['throwAllowed','Throw yd allowed'],['receiveAllowed','Catch yd allowed'],['goalsAllowed','Goals allowed'],['assistsAllowed','Ast allowed'],['targets','Targets'],['forcedThrowaways','Forced TA']
];
export function statsFor(teams,games){
 const rows=new Map();
 const row=id=>{if(!id)return null;if(!rows.has(id))rows.set(id,{id,name:'Unknown player',number:'',...Object.fromEntries(STAT_COLUMNS.map(([k])=>[k,0]))});return rows.get(id);};
 for(const t of teams)for(const p of t.players)Object.assign(row(p.id),{name:p.name,number:p.number});
 const add=(id,key,value=1)=>{const r=row(id);if(r)r[key]+=value;};
 for(const game of games)for(const p of pointsOf(game)){
  let opportunity=p.starting==='O';
  for(const e of p.events)if((e.type==='possession_start'&&e.side==='us')||(e.side==='them'&&((e.type==='pass'&&!['complete','goal'].includes(e.outcome))||e.type==='turnover')))opportunity=true;
  for(const id of new Set(p.line)){add(id,'points');add(id,p.starting==='O'?'oPoints':'dPoints');if(opportunity)add(id,'opportunities');}
  let previousPass=null;
  for(const e of p.events){
   if(e.type==='possession_start'){if(e.side==='us')add(e.playerId,'initiated');previousPass=null;}
   if(e.type==='turnover'){if(e.side==='them')add(e.blockerId,'blocks',e.reason==='block'?1:0);if(e.side==='us'&&e.reason==='stall')add(e.playerId,'throwaways');if(e.side==='them'&&e.callahan)add(e.blockerId,'goals');previousPass=null;}
   if(e.type!=='pass')continue;
   const complete=['complete','goal'].includes(e.outcome), {distance,gain}=passMetrics(e,p);
   if(e.side==='us'){
    add(e.throwerId,'passes');
    if(complete){add(e.throwerId,'completions');add(e.receiverId,'catches');add(e.throwerId,'throwDistance',distance);add(e.throwerId,'throwGain',gain);add(e.receiverId,'catchDistance',distance);add(e.receiverId,'catchGain',gain);}
    if(e.outcome==='drop')add(e.receiverId,'drops');
    if(['throwaway','block','stall'].includes(e.outcome))add(e.throwerId,'throwaways');
    if(e.outcome==='goal'){add(e.receiverId,'goals');add(e.throwerId,'assists');if(previousPass?.side==='us'&&previousPass.outcome==='complete')add(previousPass.throwerId,'secondaryAssists');}
   }else{
    add(e.receiverDefenderId,'targets');
    if(complete){add(e.markerId,'throwAllowed',distance);add(e.receiverDefenderId,'receiveAllowed',distance);}
    if(e.outcome==='goal'){add(e.markerId,'assistsAllowed');add(e.receiverDefenderId,'goalsAllowed');}
    if(e.outcome==='throwaway'||e.outcome==='stall')add(e.markerId,'forcedThrowaways');
    if(e.outcome==='block')add(e.blockerId,'blocks');
   }
   previousPass=complete?e:null;
  }
 }
 return [...rows.values()];
}
export function validateData(data){
 const fail=m=>{throw new Error(`Invalid game file: ${m}`);};
 if(data?.format!=='fieldbook'||data.version!==1)fail('expected Fieldbook JSON version 1.');
 if(!Array.isArray(data.teams)||!Array.isArray(data.games))fail('teams and games must be arrays.');
 const ids=new Set(), teamIds=new Set();
 const id=(s,scope)=>{if(typeof s!=='string'||!s||s.length>200)fail('invalid ID');const k=scope+':'+s;if(ids.has(k))fail('duplicate '+scope+' ID');ids.add(k);};
 const str=s=>{if(typeof s!=='string'||s.length>500)fail('invalid text');};
 const coordinate=c=>{if(!c||!Number.isFinite(c.x)||!Number.isFinite(c.y)||Math.abs(c.x)>1000||Math.abs(c.y)>1000)fail('invalid coordinates');};
 for(const t of data.teams){id(t.id,'team');teamIds.add(t.id);str(t.name);if(!Array.isArray(t.players))fail('missing roster');for(const p of t.players){id(p.id,'player');str(p.name);}}
 for(const g of data.games){id(g.id,'game');str(g.opponent);if(!teamIds.has(g.teamId))fail('game references a missing team');if(!Array.isArray(g.events)||!Array.isArray(g.opponents))fail('missing events/opponents');let hasPoint=false;for(const e of g.events){id(e.id,'event');if(!['point_start','possession_start','pass','turnover','point_end'].includes(e.type))fail('unknown event type');if(e.type==='point_start'){hasPoint=true;if(!Array.isArray(e.line)||!['O','D'].includes(e.starting)||![1,-1].includes(e.direction))fail('invalid point setup');}else if(!hasPoint)fail('event before first point');if(e.type==='pass'){if(!['us','them'].includes(e.side)||!['complete','goal','drop','throwaway','block','stall'].includes(e.outcome))fail('invalid pass');coordinate(e.from);coordinate(e.to);}if(e.type==='possession_start'){coordinate(e.location);if(!['us','them'].includes(e.side))fail('invalid possession');}if(e.type==='point_end'&&!['us','them'].includes(e.winner))fail('invalid point result');}}
 return data;
}
// Imports are additive. Existing game IDs are never silently overwritten.
export function mergeData(current,incoming){
 validateData(incoming);const next=structuredClone(current);let added=0,skipped=0;
 for(const t of incoming.teams){const existing=next.teams.find(x=>x.id===t.id);if(!existing)next.teams.push(t);else{for(const p of t.players)if(!existing.players.some(x=>x.id===p.id))existing.players.push(p);}}
 for(const g of incoming.games){if(next.games.some(x=>x.id===g.id))skipped++;else{next.games.push(g);added++;}}
 for(const source of incoming.sources||[])if(!next.sources.some(s=>s.id===source.id))next.sources.push(source);
 return {data:next,added,skipped};
}
