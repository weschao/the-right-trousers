export const FIELD = Object.freeze({length:110,width:40,endzone:20,brick:20,unit:'yd'});
export const uid = () => globalThis.crypto.randomUUID();
export const emptyData = () => ({format:'righttrousers',version:1,teams:[],games:[],sources:[],settings:{secondaryPreviousShare:.3,secondaryPreviousPreviousShare:.1,includeSecondaryInTotal:false}});
export const event = (type,fields={}) => ({id:uid(),type,at:new Date().toISOString(),...fields});
export const other = side => side === 'us' ? 'them' : 'us';
export function playersForGroup(team,groupId){
 if(!groupId||groupId==='all')return team.players;
 const group=(team.groups||[]).find(group=>group.id===groupId),ids=new Set(group?.playerIds||[]);
 return team.players.filter(player=>ids.has(player.id));
}
export function lineSlots(roster,playerIds=[],limit=7){
 const unique=[...new Set(playerIds)].slice(0,limit),players=unique.map(id=>roster.find(player=>player.id===id)).filter(Boolean);
 return [...players,...Array(Math.max(0,limit-players.length)).fill(null)];
}
export function pointsOf(game) {
 const points=[]; let point;
 for(const e of game.events){
  if(e.type==='point_start') {point={opponentLine:[],...e,events:[],winner:null};points.push(point);}
  else if(point){point.events.push(e);if(e.type==='substitution'){const key=e.side==='us'?'line':'opponentLine',index=point[key].indexOf(e.outId);if(e.inId&&!point[key].includes(e.inId)){if(index>=0)point[key][index]=e.inId;else if(point[key].length<7)point[key].push(e.inId);}}if(e.type==='pass' && e.outcome==='goal')point.winner=e.side; if(e.type==='point_end')point.winner=e.winner; if(e.type==='turnover'&&e.callahan)point.winner=other(e.side);}
 }
 return points;
}
export function mirrorGame(game){
 const flip=side=>side==='us'?'them':side==='them'?'us':side,swap=(event,first,second)=>{const firstValue=event[first];event[first]=event[second];event[second]=firstValue;};
 return {...game,events:game.events.map(source=>{const e={...source};if(e.side)e.side=flip(e.side);
  if(e.type==='point_start'){const line=e.line;e.line=e.opponentLine||[];e.opponentLine=line;e.starting=e.starting==='O'?'D':'O';e.direction=-e.direction;}
  if(e.type==='possession_start'||e.type==='pass'){swap(e,'markerId','opponentMarkerId');}
  if(e.type==='pass')swap(e,'receiverDefenderId','opponentReceiverDefenderId');
  if(e.type==='point_end')e.winner=flip(e.winner);
  return e;})};
}
export const FORCES=['forehand','backhand','middle'];
// lateral is measured from the thrower facing the end zone they attack: positive is their right (forehand side)
export function isBreak(pass,point,field){
 if(!pass.force||!pass.from||!pass.to||passMetrics(pass,point).gain<0)return false;
 const sideways=pass.to.y-pass.from.y,attack=(point.direction||1)*(pass.side==='them'?-1:1),toThrowerRight=sideways*attack;
 if(pass.force==='forehand')return toThrowerRight<-5;
 if(pass.force==='backhand')return toThrowerRight>5;
 const towardMiddle=Math.sign(field.width/2-pass.from.y);
 return towardMiddle!==0&&sideways*towardMiddle<-5;
}
export function gameState(game){
 const points=pointsOf(game), point=points.at(-1);let side=point?.starting==='D'?'them':'us',holder=null,location=null,marker=null,needsPickup=true;
 for(const e of point?.events||[]){
  if(e.type==='possession_start'){side=e.side;holder=e.playerId;location=e.location;marker=e.markerId||e.opponentMarkerId||null;needsPickup=false;}
  if(e.type==='pass'){
   location=e.to;
   if(['complete','goal'].includes(e.outcome)){side=e.side;holder=e.receiverId;marker=e.receiverDefenderId||e.opponentReceiverDefenderId||null;needsPickup=false;}
   else {side=other(e.side);holder=null;marker=null;needsPickup=true;}
  }
  if(e.type==='turnover'){side=other(e.side);holder=null;location=e.location||location;marker=null;needsPickup=true;}
 }
 const forces={us:null,them:null};for(const e of game.events)if(e.type==='force')forces[e.side]=e.force;
 return {points,point,side,holder,location,marker,needsPickup,forces,score:[points.filter(p=>p.winner==='us').length,points.filter(p=>p.winner==='them').length],active:!!point&&!point.winner,nextStarting:point?.winner==='us'?'D':'O',nextDirection:point?-(point.direction||1):1};
}
export function passMetrics(e,point){
 if(!e.from||!e.to)return {distance:0,gain:0};
 return {distance:Math.hypot(e.to.x-e.from.x,e.to.y-e.from.y),gain:(e.to.x-e.from.x)*(point.direction||1)*(e.side==='them'?-1:1)};
}
export const BRICK_TOLERANCE_YARDS=3;
// the first possession of a point is the pull; distances run from the pulling team's goal line, horizontal is offset from the field's centre line
export function pullMetrics(possession,point,field){
 const length=field.length,width=field.width,endzone=field.endzone||20,pullingSide=possession.side==='us'?'them':'us',attack=(point.direction||1)*(pullingSide==='us'?1:-1),location=possession.location;
 const brick={x:attack===1?length-endzone-20:endzone+20,y:width/2};
 return {pullingSide,outOfBounds:Math.hypot(location.x-brick.x,location.y-brick.y)<=BRICK_TOLERANCE_YARDS,vertical:attack===1?location.x-endzone:length-endzone-location.x,horizontal:Math.abs(location.y-width/2)};
}
export const STAT_COLUMNS = [
 ['points','Pts'],['oPoints','O pts'],['dPoints','D pts'],['opportunities','O opp'],['passes','Throws'],['completions','Comp'],['catches','Catch'],['initiated','Poss init'],['goals','Goals'],['assists','Ast'],['secondaryAssists','2nd ast'],['throwaways','TA'],['drops','Drops'],['blocks','Blocks'],['throwDistance','Throw yd'],['throwGain','Throw gain'],['catchDistance','Catch yd'],['catchGain','Catch gain'],['throwAllowed','Throw yd allowed'],['receiveAllowed','Catch yd allowed'],['goalsAllowed','Goals allowed'],['assistsAllowed','Ast allowed'],['targets','Targets'],['forcedThrowaways','Forced TA'],['breaks','Breaks'],['breaksAllowed','Breaks allowed'],['pulls','Pulls'],['pullsOutOfBounds','Pulls OB'],['pullVertical','Pull depth'],['pullHorizontal','Pull side offset']
];
export function statsFor(teams,games,huckYards=35){
 const rows=new Map();
 const row=id=>{if(!id)return null;if(!rows.has(id))rows.set(id,{id,name:'Unknown player',number:'',huckAttempts:0,huckCompletions:0,huckCompletionRate:0,pullsInBounds:0,pullVerticalTotal:0,pullHorizontalTotal:0,...Object.fromEntries(STAT_COLUMNS.map(([k])=>[k,0]))});return rows.get(id);};
 for(const t of teams)for(const p of t.players)Object.assign(row(p.id),{name:p.name,number:p.number,gender:p.gender||''});
 const add=(id,key,value=1)=>{const r=row(id);if(r)r[key]+=value;};
 for(const game of games)for(const p of pointsOf(game)){
  let opportunity=p.starting==='O';
  for(const e of p.events)if((e.type==='possession_start'&&e.side==='us')||(e.side==='them'&&((e.type==='pass'&&!['complete','goal'].includes(e.outcome))||e.type==='turnover')))opportunity=true;
  const playersOnPoint=[...p.line,...p.events.filter(e=>e.type==='substitution'&&e.side==='us').flatMap(e=>[e.outId,e.inId])];
  for(const id of new Set(playersOnPoint)){add(id,'points');add(id,p.starting==='O'?'oPoints':'dPoints');if(opportunity)add(id,'opportunities');}
  let previousPass=null;
  const pull=p.events.find(e=>e.type==='possession_start');
  if(pull?.pullerId&&pull.side==='them'){const metrics=pullMetrics(pull,p,game.field);add(pull.pullerId,'pulls');if(metrics.outOfBounds)add(pull.pullerId,'pullsOutOfBounds');else{add(pull.pullerId,'pullsInBounds');add(pull.pullerId,'pullVerticalTotal',metrics.vertical);add(pull.pullerId,'pullHorizontalTotal',metrics.horizontal);}}
  for(const e of p.events){
   if(e.type==='possession_start'){if(e.side==='us')add(e.playerId,'initiated');previousPass=null;}
   if(e.type==='turnover'){if(e.side==='them')add(e.blockerId,'blocks',e.reason==='block'?1:0);if(e.side==='us'&&e.reason==='stall')add(e.playerId,'throwaways');if(e.side==='them'&&e.callahan)add(e.blockerId,'goals');previousPass=null;}
   if(e.type!=='pass')continue;
   const complete=['complete','goal'].includes(e.outcome), {distance,gain}=passMetrics(e,p);
   if(e.side==='us'){
    add(e.throwerId,'passes');
    if(distance>huckYards){add(e.throwerId,'huckAttempts');if(complete)add(e.throwerId,'huckCompletions');}
    if(complete){add(e.throwerId,'completions');add(e.receiverId,'catches');add(e.throwerId,'throwDistance',distance);add(e.throwerId,'throwGain',gain);add(e.receiverId,'catchDistance',distance);add(e.receiverId,'catchGain',gain);}
    if(e.outcome==='drop')add(e.receiverId,'drops');
    if(['throwaway','block','stall'].includes(e.outcome))add(e.throwerId,'throwaways');
    if(e.break)add(e.throwerId,'breaks');
    if(e.outcome==='goal'){add(e.receiverId,'goals');add(e.throwerId,'assists');if(previousPass?.side==='us'&&previousPass.outcome==='complete')add(previousPass.throwerId,'secondaryAssists');}
   }else{
    add(e.receiverDefenderId,'targets');
    if(e.break)add(e.markerId,'breaksAllowed');
    if(complete){add(e.markerId,'throwAllowed',distance);add(e.receiverDefenderId,'receiveAllowed',distance);}
    if(e.outcome==='goal'){add(e.markerId,'assistsAllowed');add(e.receiverDefenderId,'goalsAllowed');}
    if(e.outcome==='throwaway'||e.outcome==='stall')add(e.markerId,'forcedThrowaways');
    if(e.outcome==='block')add(e.blockerId,'blocks');
   }
   previousPass=complete?e:null;
  }
 }
 for(const row of rows.values()){row.huckCompletionRate=row.huckAttempts?row.huckCompletions/row.huckAttempts:0;row.pullVertical=row.pullsInBounds?row.pullVerticalTotal/row.pullsInBounds:0;row.pullHorizontal=row.pullsInBounds?row.pullHorizontalTotal/row.pullsInBounds:0;}
 return [...rows.values()];
}

// Advanced per-game value metrics. These are derived from the event log so an
// imported or future data source can produce the same numbers.
export function offensiveScoringEfficiency(games,teamId){
 let goals=0,possessions=0;
 for(const game of games.filter(g=>g.teamId===teamId))for(const point of pointsOf(game)){
  if(point.starting==='O')possessions++;
  if(point.winner==='them')goals++;
  for(const e of point.events)if(e.side==='us'&&((e.type==='turnover')||(e.type==='pass'&&!['complete','goal'].includes(e.outcome))))possessions++;
 }
 return possessions?goals/possessions:0;
}
// Season/game-library summary rates. Keeping this event-derived makes the
// dashboard usable with imported games and future data sources alike.
export function teamRates(games,huckYards=35){
 let offense=0,holds=0,cleanHolds=0,defense=0,turns=0,breaks=0,huckAttempts=0,huckCompletions=0;
 const isTurnover=e=>e.type==='turnover'||(e.type==='pass'&&!['complete','goal'].includes(e.outcome));
 for(const game of games)for(const point of pointsOf(game)){
  if(point.starting==='O'){
   offense++;if(point.winner==='us')holds++;
   if(!point.events.some(e=>e.side==='us'&&isTurnover(e)))cleanHolds++;
  }else if(point.starting==='D'){
   defense++;if(point.winner==='us')breaks++;
   if(point.events.some(e=>e.side==='them'&&isTurnover(e)))turns++;
  }
  for(const e of point.events)if(e.type==='pass'&&e.side==='us'&&passMetrics(e,point).distance>huckYards){
   huckAttempts++;if(['complete','goal'].includes(e.outcome))huckCompletions++;
  }
 }
 return {offense,holds,cleanHolds,defense,turns,breaks,huckAttempts,huckCompletions};
}
export function advancedStatsFor(game,team,ose=.56,previousShare=.3,previousPreviousShare=.1,includeSecondaryInTotal=false,huckYards=35){
 const base=statsFor([team],[game],huckYards),rows=new Map(base.map(row=>[row.id,{...row,plusMinus:row.goals+row.assists+row.blocks-row.throwaways-row.drops,throwingEdge:0,receivingEdge:0,secondaryThrowingEdge:0,totalEdge:0,totalEdgePerPoint:0,totalEdgePerTouch:0}]));
 const pointList=pointsOf(game),oppGoals=pointList.filter(p=>p.winner==='them').length;
 let oppPoss=pointList.filter(p=>p.starting==='O').length;
 for(const p of pointList)for(const e of p.events)if(e.side==='us'&&((e.type==='turnover')||(e.type==='pass'&&!['complete','goal'].includes(e.outcome))))oppPoss++;
 const turnoverCost=oppPoss?oppGoals/oppPoss:0;
 const add=(id,key,value)=>{if(id&&rows.has(id))rows.get(id)[key]+=value;};
 for(const p of pointList){let previous=[],possessionGoal=false;
  for(const e of p.events){
   if(e.type==='possession_start'){if(e.side==='us'){previous=[];possessionGoal=false;}continue;}
   if(e.type!=='pass')continue;
   if(e.side!=='us'){if(e.outcome==='goal')possessionGoal=true;continue;}
   const complete=['complete','goal'].includes(e.outcome),m=passMetrics(e,p),gain=m.gain;
   const throwValue=gain*.007+(e.outcome==='goal'?.18:0)-(['throwaway','block','stall'].includes(e.outcome)?turnoverCost:0);
   const receiveValue=complete?gain*.007+(e.outcome==='goal'?.18:0)-(e.outcome==='drop'?ose:0):0;
   add(e.throwerId,'throwingEdge',throwValue);add(e.receiverId,'receivingEdge',receiveValue);
   const value=throwValue+receiveValue;
   add(previous.at(-1),'secondaryThrowingEdge',value*previousShare);add(previous.at(-2),'secondaryThrowingEdge',value*previousPreviousShare);
   if(complete&&e.throwerId)previous.push(e.throwerId); else previous=[];
  }
 }
 for(const row of rows.values()){row.totalEdge=row.throwingEdge+row.receivingEdge+(includeSecondaryInTotal?row.secondaryThrowingEdge:0);row.totalEdgePerPoint=row.opportunities?row.totalEdge/row.opportunities:0;const touches=row.catches+row.initiated;row.totalEdgePerTouch=touches?row.totalEdge/touches:0;}
 return {rows:[...rows.values()],oppGoals,oppPoss,turnoverCost};
}
export function validateData(data){
 const fail=m=>{throw new Error(`Invalid game file: ${m}`);};
 if(data?.format!=='righttrousers'||data.version!==1)fail('expected Right Trousers JSON version 1.');
 if(!Array.isArray(data.teams)||!Array.isArray(data.games))fail('teams and games must be arrays.');
 const ids=new Set(), teamIds=new Set();
 const id=(s,scope)=>{if(typeof s!=='string'||!s||s.length>200)fail('invalid ID');const k=scope+':'+s;if(ids.has(k))fail('duplicate '+scope+' ID');ids.add(k);};
 const str=s=>{if(typeof s!=='string'||s.length>500)fail('invalid text');};
 const coordinate=c=>{if(!c||!Number.isFinite(c.x)||!Number.isFinite(c.y)||Math.abs(c.x)>1000||Math.abs(c.y)>1000)fail('invalid coordinates');};
 for(const t of data.teams){id(t.id,'team');teamIds.add(t.id);str(t.name);if(!Array.isArray(t.players))fail('missing roster');for(const p of t.players){id(p.id,'player');str(p.name);}if(t.groups!==undefined&&!Array.isArray(t.groups))fail('invalid groups');for(const group of t.groups||[]){id(group.id,'group');str(group.name);if(!Array.isArray(group.playerIds)||group.playerIds.some(playerId=>!t.players.some(player=>player.id===playerId)))fail('group references a missing player');}}
  for(const g of data.games){id(g.id,'game');str(g.opponent);if(!teamIds.has(g.teamId))fail('game references a missing team');if(!Array.isArray(g.events)||!Array.isArray(g.opponents))fail('missing events/opponents');let hasPoint=false;for(const e of g.events){id(e.id,'event');if(!['point_start','possession_start','pass','turnover','substitution','point_end','force'].includes(e.type))fail('unknown event type');if(e.type==='point_start'){hasPoint=true;if(!Array.isArray(e.line)||e.line.length>7||(e.opponentLine!==undefined&&(!Array.isArray(e.opponentLine)||e.opponentLine.length>7))||!['O','D'].includes(e.starting)||![1,-1].includes(e.direction))fail('invalid point setup');}else if(!hasPoint)fail('event before first point');if(e.type==='pass'){if(!['us','them'].includes(e.side)||!['complete','goal','drop','throwaway','block','stall'].includes(e.outcome))fail('invalid pass');coordinate(e.from);coordinate(e.to);}if(e.type==='possession_start'){coordinate(e.location);if(!['us','them'].includes(e.side))fail('invalid possession');}if(e.type==='substitution'&&(!['us','them'].includes(e.side)||(e.outId!==null&&typeof e.outId!=='string')||typeof e.inId!=='string'))fail('invalid substitution');if(e.type==='point_end'&&!['us','them'].includes(e.winner))fail('invalid point result');if(e.type==='force'&&(!['us','them'].includes(e.side)||!FORCES.includes(e.force)))fail('invalid force');if(e.type==='pass'&&e.force!=null&&!FORCES.includes(e.force))fail('invalid pass force');}}
 return data;
}
// Imports are additive. Existing game IDs are never silently overwritten.
export function mergeData(current,incoming){
 validateData(incoming);const next=structuredClone(current);let added=0,skipped=0;
 for(const t of incoming.teams){const existing=next.teams.find(x=>x.id===t.id);if(!existing)next.teams.push(t);else{for(const p of t.players)if(!existing.players.some(x=>x.id===p.id))existing.players.push(p);existing.groups??=[];for(const group of t.groups||[])if(!existing.groups.some(x=>x.id===group.id))existing.groups.push(group);}}
 for(const g of incoming.games){if(next.games.some(x=>x.id===g.id))skipped++;else{next.games.push(g);added++;}}
 for(const source of incoming.sources||[])if(!next.sources.some(s=>s.id===source.id))next.sources.push(source);
 return {data:next,added,skipped};
}
