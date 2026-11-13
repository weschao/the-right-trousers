export const FIELD = Object.freeze({length:110,width:40,endzone:20,brick:20,unit:'yd'});
export const uid = () => globalThis.crypto.randomUUID();
export const emptyData = () => ({format:'righttrousers',version:1,teams:[],games:[],sources:[],settings:{secondaryPreviousShare:.3,secondaryPreviousPreviousShare:.1,includeSecondaryInTotal:false}});
export const event = (type,fields={}) => ({id:uid(),type,at:new Date().toISOString(),...fields});
export const other = side => side === 'us' ? 'them' : 'us';
// the pull is the pickup that opens the point; a pickup after a turnover or throw is not the pull
export const pullEvent = point => { const first = point.events.find(e => ['possession_start','pass','turnover','unattributed_goal'].includes(e.type)); return first?.type === 'possession_start' ? first : undefined; };
export function playersForGroup(team,groupId){
 if(!groupId||groupId==='all')return team.players;
 const group=(team.groups||[]).find(group=>group.id===groupId),ids=new Set(group?.playerIds||[]);
 return team.players.filter(player=>ids.has(player.id));
}
export function lineSlots(roster,playerIds=[],limit=7){
 const unique=[...new Set(playerIds)].slice(0,limit),players=unique.map(id=>roster.find(player=>player.id===id)).filter(Boolean);
 return [...players,...Array(Math.max(0,limit-players.length)).fill(null)];
}
// a point with an unattributed goal is left out of throws per possession and EDGE
export const pointExcluded=point=>point.events.some(e=>e.type==='unattributed_goal');
export function pointsOf(game) {
 const points=[]; let point;
 for(const e of game.events){
  if(e.type==='point_start') {point={...e,line:[...e.line],opponentLine:[...(e.opponentLine||[])],events:[],winner:null};points.push(point);}
  else if(point){point.events.push(e);if(e.type==='substitution'){const key=e.side==='us'?'line':'opponentLine',index=point[key].indexOf(e.outId);if(e.inId&&!point[key].includes(e.inId)){if(index>=0)point[key][index]=e.inId;else if(point[key].length<7)point[key].push(e.inId);}}if(e.type==='pass' && e.outcome==='goal')point.winner=e.side; if(e.type==='unattributed_goal')point.winner=e.side; if(e.type==='point_end')point.winner=e.winner; if(e.type==='turnover'&&e.callahan)point.winner=other(e.side);}
 }
 return points;
}
// Match the throwaway stat: blocked throws and stalls are charged to the thrower too.
export function playerThrowaways(games,playerId){return games.flatMap(game=>pointsOf(game).flatMap((point,pointIndex)=>point.events.filter(e=>e.side==='us'&&(e.type==='pass'&&e.throwerId===playerId&&['throwaway','block','stall'].includes(e.outcome)||e.type==='turnover'&&e.playerId===playerId&&['stall','block'].includes(e.reason))).map(event=>({game,point,pointIndex,event}))));}
export function mirrorGame(game){
 const flip=side=>side==='us'?'them':side==='them'?'us':side,swap=(event,first,second)=>{const firstValue=event[first];event[first]=event[second];event[second]=firstValue;};
 return {...game,events:game.events.map(source=>{const e={...source};if(e.side)e.side=flip(e.side);
  if(e.type==='point_start'){const line=e.line;e.line=e.opponentLine||[];e.opponentLine=line;e.starting=e.starting==='O'?'D':'O';e.direction=-e.direction;}
  if(e.type==='possession_start'||e.type==='pass'){swap(e,'markerId','opponentMarkerId');}
  if(e.type==='pass')swap(e,'receiverDefenderId','opponentReceiverDefenderId');
  if(e.type==='point_end')e.winner=flip(e.winner);
  return e;})};
}
// a game against a team in the library also belongs to that team: seen from its side, mirrored so 'us' is that team
export function opponentPerspective(game,teams){const team=teams.find(t=>t.id===game.teamId);return {...mirrorGame(game),teamId:game.opponentTeamId,opponentTeamId:game.teamId,opponent:team.name,opponentRating:team.rating??null,opponents:team.players.map(player=>({...player})),opponentPerspective:true};}
const hasLinkedOpponent=(game,teams)=>!!game.opponentTeamId&&teams.some(t=>t.id===game.opponentTeamId);
export function gamesForTeam(data,teamId){return [...data.games.filter(g=>g.teamId===teamId),...data.games.filter(g=>g.opponentTeamId===teamId&&hasLinkedOpponent(g,data.teams)).map(g=>opponentPerspective(g,data.teams))];}
// every game from every library team's side; a game between two library teams appears twice, once per side
export function gamesFromEverySide(data){return [...data.games,...data.games.filter(g=>hasLinkedOpponent(g,data.teams)).map(g=>opponentPerspective(g,data.teams))];}
// stands in for the marker/defender id when the offensive player had nobody guarding them; never a real player
export const UNGUARDED='unguarded';
// a matchup deliberately recorded as "I don't know who"; counts as assigned, shows as Unknown, and is stored on passes as null
export const UNKNOWN_MATCHUP='unknown';
export const isPlaceholderMatchup=id=>id===UNGUARDED||id===UNKNOWN_MATCHUP;
export const FORCES=['forehand','backhand','middle'];
// lateral is measured from the thrower facing the end zone they attack: positive is their right (forehand side)
// nobody marking the thrower means there was no force to break
export function isBreak(pass,point,field){
 if(pass[pass.side==='us'?'opponentMarkerId':'markerId']===UNGUARDED)return false;
 if(!pass.force||!pass.from||!pass.to||passMetrics(pass,point).gain<0)return false;
 const sideways=pass.to.y-pass.from.y,attack=(point.direction||1)*(pass.side==='them'?-1:1),toThrowerRight=sideways*attack;
 if(pass.force==='forehand')return toThrowerRight<-1;
 if(pass.force==='backhand')return toThrowerRight>1;
 const towardMiddle=Math.sign(field.width/2-pass.from.y);
 return towardMiddle!==0&&sideways*towardMiddle<-1;
}
// rewrites every pass's break flag from the current isBreak definition; returns whether anything changed
export function recomputeBreaks(game){
 let changed=false;
 for(const point of pointsOf(game))for(const e of point.events)if(e.type==='pass'){const value=isBreak(e,point,game.field);if(!!e.break!==value){e.break=value;changed=true;}}
 return changed;
}
// Changes only this point's attack direction; field coordinates stay fixed.
export function setPointDirection(game,pointId,direction){
 const start=game.events.find(e=>e.type==='point_start'&&e.id===pointId);
 if(!start||![1,-1].includes(direction)||start.direction===direction)return false;
 start.direction=direction;
 const point=pointsOf(game).find(point=>point.id===pointId);
 for(const e of point.events)if(e.type==='pass')e.break=isBreak(e,point,game.field);
 return true;
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
  // a substituted holder is replaced by the incoming player, who keeps the same marker
  if(e.type==='substitution'&&e.side===side&&holder&&e.outId===holder&&e.inId)holder=e.inId;
 }
 const forces={us:null,them:null};for(const e of game.events)if(e.type==='force')forces[e.side]=e.force;
 return {points,point,side,holder,location,marker,needsPickup,forces,score:[points.filter(p=>p.winner==='us').length,points.filter(p=>p.winner==='them').length],active:!!point&&!point.winner,nextStarting:point?.winner==='us'?'D':'O',nextDirection:point?-(point.direction||1):1};
}
// a huck is a positioned pass of ours whose downfield gain exceeds the threshold; gain is negative for backward throws
export function isHuckPass(e,point,huckYards){return e.type==='pass'&&e.side==='us'&&!!e.from&&!!e.to&&passMetrics(e,point).gain>huckYards;}
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
 ['points','Pts'],['oPoints','O pts'],['dPoints','D pts'],['opportunities','O opp'],['defenseOpportunities','D opp'],['passes','Throws'],['completions','Comp'],['completionRate','Completion rate'],['catches','Catch'],['initiated','Poss init'],['goals','Goals'],['assists','Ast'],['secondaryAssists','2nd ast'],['throwaways','Throwaways'],['drops','Drops'],['assistThrowawayRatio','Ast/TA'],['throwawaysPerTouch','TA/100 touches'],['blocks','Blocks'],['throwDistance','Throw yd'],['throwGain','Throw gain'],['throwGainPerThrow','Throw gain/throw'],['catchDistance','Catch yd'],['catchGain','Catch gain'],['receiveGainPerCatch','Receive gain/catch'],['throwAllowed','Throw yd allowed'],['receiveAllowed','Catch yd allowed'],['goalsAllowed','Goals allowed'],['assistsAllowed','Ast allowed'],['targets','Targets'],['forcedThrowaways','Forced TA'],['breaks','Breaks'],['breaksAllowed','Breaks allowed'],['pulls','Pulls'],['pullsOutOfBounds','Pulls OB'],['pullVertical','Pull depth'],['pullHorizontal','Pull side offset']
];
// our players who were on the field for a point: its starting line plus everyone subbed in or out
export function pointPlayers(point){return new Set([...point.line,...point.events.filter(e=>e.type==='substitution'&&e.side==='us').flatMap(e=>[e.outId,e.inId])]);}
// ids of our players who played at least one point of the game (statsFor gives them points > 0)
export function playersWhoPlayed(game){const played=new Set();for(const point of pointsOf(game))for(const id of pointPlayers(point))if(id&&id!==UNGUARDED)played.add(id);return played;}
export function statsFor(teams,games,huckYards=35){
 const rows=new Map();
 const row=id=>{if(!id||id===UNGUARDED)return null;if(!rows.has(id))rows.set(id,{id,name:'Unknown player',number:'',maleTargetAttempts:0,maleTargetCompletions:0,femaleTargetAttempts:0,femaleTargetCompletions:0,maleTargetCompletionRate:null,femaleTargetCompletionRate:null,huckAttempts:0,huckCompletions:0,huckCompletionRate:0,guardedDefenseOpportunities:0,defenseOpportunitiesFromD:0,defenseOpportunitiesFromO:0,opponentScoredFromD:0,opponentScoredFromO:0,pullsInBounds:0,pullVerticalTotal:0,pullHorizontalTotal:0,...Object.fromEntries(STAT_COLUMNS.map(([k])=>[k,0]))});return rows.get(id);};
 for(const t of teams)for(const p of t.players)Object.assign(row(p.id),{name:p.name,number:p.number,gender:p.gender||''});
 const add=(id,key,value=1)=>{const r=row(id);if(r)r[key]+=value;};
 for(const game of games)for(const p of pointsOf(game)){
  const opportunity=pointHasOpportunity(p);
  const anyDefenseOpportunity=p.starting==='D'||p.events.some(e=>e.side==='us'&&(e.type==='turnover'||(e.type==='pass'&&!['complete','goal'].includes(e.outcome)))),defenseOpportunity=anyDefenseOpportunity&&p.events.some(e=>e.type==='pass'&&e.side==='them'&&[e.markerId,e.receiverDefenderId].some(id=>id&&id!==UNGUARDED));
  for(const id of pointPlayers(p)){add(id,'points');add(id,p.starting==='O'?'oPoints':'dPoints');if(opportunity)add(id,'opportunities');if(defenseOpportunity)add(id,'guardedDefenseOpportunities');if(anyDefenseOpportunity){add(id,'defenseOpportunities');const origin=p.starting==='D'?'D':'O';add(id,`defenseOpportunitiesFrom${origin}`);if(p.winner==='them')add(id,`opponentScoredFrom${origin}`);}}
  let previousPass=null;
  const pull=pullEvent(p);
  if(pull?.pullerId&&pull.side==='them'){const metrics=pullMetrics(pull,p,game.field);add(pull.pullerId,'pulls');if(metrics.outOfBounds)add(pull.pullerId,'pullsOutOfBounds');else add(pull.pullerId,'pullsInBounds');add(pull.pullerId,'pullVerticalTotal',metrics.outOfBounds?50:metrics.vertical);add(pull.pullerId,'pullHorizontalTotal',metrics.outOfBounds?0:metrics.horizontal);}
  for(const e of p.events){
   if(e.type==='possession_start'){if(e.side==='us')add(e.playerId,'initiated');previousPass=null;}
   if(e.type==='turnover'){if(e.side==='them')add(e.blockerId,'blocks',e.reason==='block'?1:0);if(e.side==='us'&&['stall','block'].includes(e.reason))add(e.playerId,'throwaways');if(e.side==='them'&&e.callahan)add(e.blockerId,'goals');previousPass=null;}
   if(e.type!=='pass')continue;
   const complete=['complete','goal'].includes(e.outcome), {distance,gain}=passMetrics(e,p);
   if(e.side==='us'){
    add(e.throwerId,'passes');
    const targetGender=rows.get(e.receiverId)?.gender,targetPrefix=targetGender==='M'?'male':targetGender==='F'?'female':null;
    if(targetPrefix){add(e.throwerId,targetPrefix+'TargetAttempts');if(complete)add(e.throwerId,targetPrefix+'TargetCompletions');}
    if(isHuckPass(e,p,huckYards)){add(e.throwerId,'huckAttempts');if(complete)add(e.throwerId,'huckCompletions');}
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
 for(const row of rows.values()){row.throwGainPerThrow=row.passes?row.throwGain/row.passes:null;row.receiveGainPerCatch=row.catches?row.catchGain/row.catches:null;row.assistThrowawayRatio=row.throwaways?row.assists/row.throwaways:null;row.throwawaysPerTouch=row.catches+row.initiated?100*row.throwaways/(row.catches+row.initiated):null;row.completionRate=row.passes?row.completions/row.passes:null;for(const prefix of ['male','female'])row[prefix+'TargetCompletionRate']=row[prefix+'TargetAttempts']?row[prefix+'TargetCompletions']/row[prefix+'TargetAttempts']:null;row.huckCompletionRate=row.huckAttempts?row.huckCompletions/row.huckAttempts:0;row.pullVertical=row.pulls?row.pullVerticalTotal/row.pulls:0;row.pullHorizontal=row.pulls?row.pullHorizontalTotal/row.pulls:0;}
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
// finished possessions of the given side; a stall ends a possession but is not a throw. unfinished possessions are ignored.
export function possessionsOf(games,side='us'){
 const possessions=[];
 for(const game of games)for(const point of pointsOf(game)){
  if(pointExcluded(point))continue;
  const field=game.field||FIELD,attack=(point.direction||1)*(side==='us'?1:-1),
   distanceToEndZone=location=>attack===1?field.length-field.endzone-location.x:location.x-field.endzone;
  let current=null;
  const begin=location=>({throws:0,completions:0,start:location||null,verticalYards:0,lateralYards:0,missingLocation:false}),
   finish=outcome=>{if(current)possessions.push({...current,outcome,distanceToEndZone:current.start?distanceToEndZone(current.start):null,distanceFromMidfield:current.start?Math.abs(current.start.y-field.width/2):null});current=null;};
  for(const e of point.events){
   if(e.type==='possession_start')current=e.side===side?begin(e.location):null;
   else if(e.type==='pass'&&e.side===side){
    if(!current)current=begin(e.from);
    if(!current.start&&e.from)current.start=e.from;
    if(e.outcome!=='stall')current.throws++;
    if(['complete','goal'].includes(e.outcome)){
     current.completions++;
     if(e.from&&e.to){current.verticalYards+=(e.to.x-e.from.x)*attack;current.lateralYards+=Math.abs(e.to.y-e.from.y);}else current.missingLocation=true;
    }
    if(e.outcome==='goal')finish('goal');else if(e.outcome!=='complete')finish('turnover');
   }else if(e.type==='turnover'&&e.side===side)finish('turnover');
  }
 }
 return possessions;
}
export function throwsPerPossession(games,side='us'){
 const result={goal:{possessions:0,throws:0},turnover:{possessions:0,throws:0}};
 for(const possession of possessionsOf(games,side)){result[possession.outcome].possessions++;result[possession.outcome].throws+=possession.throws;}
 const total={possessions:result.goal.possessions+result.turnover.possessions,throws:result.goal.throws+result.turnover.throws};
 return {...result,total};
}
// index n holds possessions with n completed throws (the scoring throw counts as completed)
export function scoringByCompletions(games,side='us'){
 const rows=[];
 for(const possession of possessionsOf(games,side)){
  for(let count=rows.length;count<=possession.completions;count++)rows.push({completions:count,possessions:0,goals:0});
  rows[possession.completions].possessions++;if(possession.outcome==='goal')rows[possession.completions].goals++;
 }
 return rows;
}
export const GOAL_REGRESSION_VARIABLES=[
 {key:'distanceFromMidfield',label:'Distance from midfield line (yd)'},
 {key:'verticalYards',label:'Vertical yards gained'},
 {key:'lateralYards',label:'Lateral yards (absolute)'},
 {key:'throws',label:'Throws'}
];
// ordinary least squares with intercept; solves by Gauss-Jordan inversion of the normal equations and throws if they are singular
export function linearRegression(rows,targets){
 const size=rows[0].length+1,design=rows.map(row=>[1,...row]),
  matrix=Array.from({length:size},(_,i)=>Array.from({length:size},(_,j)=>design.reduce((sum,row)=>sum+row[i]*row[j],0))),
  inverse=matrix.map((row,i)=>row.map((_,j)=>i===j?1:0));
 for(let column=0;column<size;column++){
  let pivot=column;for(let row=column+1;row<size;row++)if(Math.abs(matrix[row][column])>Math.abs(matrix[pivot][column]))pivot=row;
  if(Math.abs(matrix[pivot][column])<1e-9)throw new Error('regression variables are collinear or constant');
  [matrix[column],matrix[pivot]]=[matrix[pivot],matrix[column]];[inverse[column],inverse[pivot]]=[inverse[pivot],inverse[column]];
  const divisor=matrix[column][column];
  for(let k=0;k<size;k++){matrix[column][k]/=divisor;inverse[column][k]/=divisor;}
  for(let row=0;row<size;row++)if(row!==column){const factor=matrix[row][column];for(let k=0;k<size;k++){matrix[row][k]-=factor*matrix[column][k];inverse[row][k]-=factor*inverse[column][k];}}
 }
 const coefficients=inverse.map(row=>design.reduce((sum,designRow,r)=>sum+row.reduce((inner,value,j)=>inner+value*designRow[j],0)*targets[r],0)),
  residualSum=design.reduce((sum,row,i)=>sum+(targets[i]-row.reduce((inner,value,j)=>inner+value*coefficients[j],0))**2,0),
  mean=targets.reduce((sum,value)=>sum+value,0)/targets.length,totalSum=targets.reduce((sum,value)=>sum+(value-mean)**2,0),
  degrees=targets.length-size,variance=degrees>0?residualSum/degrees:NaN;
 return {coefficients,standardErrors:inverse.map((row,i)=>Math.sqrt(variance*row[i])),rSquared:totalSum?1-residualSum/totalSum:NaN,count:targets.length};
}
// linear probability model: did a finished possession with at least one completed throw end in a goal. possessions missing a location are left out and counted; possessions without a completion are left out because every yard variable is zero for them.
export function goalRegression(games,side='us'){
 const all=possessionsOf(games,side),usable=all.filter(p=>p.start&&!p.missingLocation&&p.completions>0);
 if(usable.length<=GOAL_REGRESSION_VARIABLES.length+1)throw new Error(`only ${usable.length} possessions with locations`);
 return {...linearRegression(usable.map(p=>GOAL_REGRESSION_VARIABLES.map(v=>p[v.key])),usable.map(p=>p.outcome==='goal'?1:0)),
  skipped:all.length-usable.length,goals:usable.filter(p=>p.outcome==='goal').length,variables:GOAL_REGRESSION_VARIABLES};
}
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
  for(const e of point.events)if(isHuckPass(e,point,huckYards)){
   huckAttempts++;if(['complete','goal'].includes(e.outcome))huckCompletions++;
  }
 }
 return {offense,holds,cleanHolds,defense,turns,breaks,huckAttempts,huckCompletions};
}
// yards only count on a completion; a throwaway, block or stall costs the thrower oSE and a drop costs the receiver oSE
// LEDGE adds this much per absolute lateral yard of a completed throw, credited to both thrower and receiver
export const LATERAL_EDGE_PER_YARD=.002;
// EDGE values goal catches at the front goal line; recorded locations and ordinary yardage stay unchanged.
export function passEdge(e,point,ose,field=FIELD){const attack=(point.direction||1)*(e.side==='them'?-1:1),edgePass=e.outcome==='goal'&&e.to?{...e,to:{...e.to,x:attack===1?field.length-field.endzone:field.endzone}}:e,complete=['complete','goal'].includes(e.outcome),gainValue=complete?passMetrics(edgePass,point).gain*.007+(e.outcome==='goal'?.18:0):0;return {complete,throwValue:gainValue-(['throwaway','block','stall'].includes(e.outcome)?ose:0),receiveValue:gainValue-(e.outcome==='drop'?ose:0)};}
// a side is on offense in a point if it started on O or got the disc back, and on defense if it started on D or lost the disc
export function sideRoles(point,side){
 const startsOnOffense=(point.starting==='O')===(side==='us'),lostDisc=(e,lostSide)=>e.side===lostSide&&(e.type==='turnover'||(e.type==='pass'&&!['complete','goal'].includes(e.outcome)));
 return {offense:startsOnOffense||point.events.some(e=>(e.type==='possession_start'&&e.side===side)||lostDisc(e,other(side))),defense:!startsOnOffense||point.events.some(e=>(e.type==='possession_start'&&e.side===other(side))||lostDisc(e,side))};
}
// one-to-one [player, opponent] matchups for a point. point_start.matchups is explicit (set by dragging or Edit matchups; [id,null] means deliberately unassigned);
// markers recorded on possessions and passes fill in anyone the explicit list does not mention
export function pointMatchups(point){
 const explicit=point.matchups||[],covered=new Set(explicit.flat().filter(id=>id&&!isPlaceholderMatchup(id))),derived=[];
 const link=(first,second)=>{if(!first||!second||covered.has(first)||covered.has(second))return;for(let index=derived.length-1;index>=0;index--)if(derived[index].includes(first)||(!isPlaceholderMatchup(second)&&derived[index].includes(second)))derived.splice(index,1);derived.push([first,second]);};
 for(const e of point.events){
  if(e.type==='possession_start')link(e.playerId,e.markerId||e.opponentMarkerId);
  if(e.type==='pass'){link(e.throwerId,e.markerId||e.opponentMarkerId);link(e.receiverId,e.receiverDefenderId||e.opponentReceiverDefenderId);}
 }
 return [...explicit.filter(pair=>pair[0]&&pair[1]),...derived];
}
// Game history is oldest first; a repeated pair moves to the end without removing either player's other matchups.
const rememberMatchup=(history,first,second)=>{if(!first||!second||first===second||isPlaceholderMatchup(first)||isPlaceholderMatchup(second))return;const index=history.findIndex(pair=>pair.includes(first)&&pair.includes(second));if(index>=0)history.splice(index,1);history.push([first,second]);};
export function defenderHistory(game){
 if(game.defenderMatchupHistory)return game.defenderMatchupHistory.map(pair=>[...pair]);
 const history=[];
 for(const e of game.events){
  if(e.type==='point_start')for(const pair of e.matchups||[])rememberMatchup(history,...pair);
  if(e.type==='possession_start')rememberMatchup(history,e.playerId,e.markerId||e.opponentMarkerId);
  if(e.type==='pass'){rememberMatchup(history,e.throwerId,e.markerId||e.opponentMarkerId);rememberMatchup(history,e.receiverId,e.receiverDefenderId||e.opponentReceiverDefenderId);}
 }
 for(const pair of game.defenderPairings||[])rememberMatchup(history,...pair);
 return history;
}
export function rememberDefender(game,receiverId,defenderId){const history=defenderHistory(game);rememberMatchup(history,receiverId,defenderId);game.defenderMatchupHistory=history;}
export function startingMatchups(game,offense,defenders){
 const history=defenderHistory(game).reverse(),available=new Set(defenders),pairs=[];
 for(const receiverId of offense){const pair=history.find(pair=>pair.includes(receiverId)&&pair.some(id=>id!==receiverId&&available.has(id))),defenderId=pair?.find(id=>id!==receiverId&&available.has(id));if(defenderId){pairs.push([receiverId,defenderId]);available.delete(defenderId);}}
 return pairs;
}
// Persist assignments on the point separately from the game's complete matchup history.
export function recordPointMatchup(game,pointId,{offenseId=null,defenderId,clear=false}){
 const start=game.events.find(e=>e.id===pointId);if(!start)return;
 if(offenseId&&defenderId)rememberDefender(game,offenseId,defenderId);
 const before=pointMatchups(pointsOf(game).find(point=>point.id===pointId)),removed=before.filter(pair=>pair.includes(offenseId)||(!isPlaceholderMatchup(defenderId)&&pair.includes(defenderId)));
 start.matchups=(start.matchups||[]).filter(pair=>!pair.includes(offenseId)&&!(!isPlaceholderMatchup(defenderId)&&pair.includes(defenderId)));
 for(const id of removed.flat())if(id&&id!==offenseId&&id!==defenderId&&!isPlaceholderMatchup(id))start.matchups.push([id,null]);
 start.matchups.push(clear?[offenseId,null]:offenseId?[offenseId,defenderId]:[defenderId,null]);
}
// per player: points on offense/defense against how many of those had an assigned matchup (and the 1-based numbers of the points that did not); players of both teams are keyed by their own id
export function matchupCoverage(game){
 const rows=new Map(),row=id=>{if(!rows.has(id))rows.set(id,{offensePoints:0,offenseAssigned:0,offenseMissing:[],defensePoints:0,defenseAssigned:0,defenseMissing:[]});return rows.get(id);};
 for(const [pointIndex,point] of pointsOf(game).entries()){
  const assigned=new Set(pointMatchups(point).flat());
  for(const [side,line] of [['us',point.line],['them',point.opponentLine]]){
   const roles=sideRoles(point,side),substitutionEvents=point.events.filter(e=>e.type==='substitution'&&e.side===side),substitutions=substitutionEvents.flatMap(e=>[e.outId,e.inId]);
   // a player and their substitute share one slot in the point's one-to-one matchups, so assigning either covers both
   for(const e of substitutionEvents)if(e.outId&&e.inId&&(assigned.has(e.outId)||assigned.has(e.inId))){assigned.add(e.outId);assigned.add(e.inId);}
   for(const id of new Set([...line,...substitutions].filter(Boolean))){
    const counts=row(id);
    if(roles.offense){counts.offensePoints++;if(assigned.has(id))counts.offenseAssigned++;else counts.offenseMissing.push(pointIndex+1);}
    if(roles.defense){counts.defensePoints++;if(assigned.has(id))counts.defenseAssigned++;else counts.defenseMissing.push(pointIndex+1);}
   }
  }
 }
 return rows;
}
// one player's passes split by who guarded them (offense) and by whom they guarded (defense); side is the player's team in this game
export function matchupBreakdown(game,playerId,side,ose){return matchupBreakdowns(game,side,ose,[playerId]).get(playerId)||{offense:[],defense:[]};}
// matchupBreakdown for many players in one pass over the game; playerIds limits the players tracked (null tracks everyone), keyed by player id
export function matchupBreakdowns(game,side,ose,playerIds=null){
 const fieldsFor=offenseSide=>offenseSide==='us'?{marker:'opponentMarkerId',receiverDefender:'opponentReceiverDefenderId'}:{marker:'markerId',receiverDefender:'receiverDefenderId'};
 const tracked=playerIds&&new Set(playerIds),wanted=id=>!!id&&(!tracked||tracked.has(id)),players=new Map();
 const tablesOf=id=>{if(!players.has(id))players.set(id,{offense:new Map(),defense:new Map()});return players.get(id);};
 const offenseRow=(playerId,id)=>{const offense=tablesOf(playerId).offense,key=id||null;if(!offense.has(key))offense.set(key,{opponentId:key,pointIds:new Set(),throws:0,completions:0,throwGain:0,turnovers:0,assists:0,breaks:0,targets:0,catches:0,drops:0,goals:0,catchGain:0,edge:0});return offense.get(key);};
 const defenseRow=(playerId,id)=>{const defense=tablesOf(playerId).defense,key=id||null;if(!defense.has(key))defense.set(key,{opponentId:key,pointIds:new Set(),throwsMarked:0,completionsAllowed:0,throwGainAllowed:0,throwaways:0,breaksAllowed:0,targets:0,catchesAllowed:0,goalsAllowed:0,assistsAllowed:0,catchGainAllowed:0,blocks:0,edgeAllowed:0});return defense.get(key);};
 const points=pointsOf(game);
 for(const point of points)for(const e of point.events){
  if(e.type!=='pass')continue;
  const fields=fieldsFor(e.side),marker=e[fields.marker],receiverDefender=e[fields.receiverDefender],ours=e.side===side;
  // pass values are the expensive part, so passes no tracked player took part in are skipped first
  if(ours?!wanted(e.throwerId)&&!wanted(e.receiverId):!wanted(marker)&&!wanted(receiverDefender)&&!(e.outcome==='block'&&wanted(e.blockerId)))continue;
  const skipEdge=pointExcluded(point),{complete,throwValue,receiveValue}=passEdge(e,point,ose,game.field),gain=complete?passMetrics(e,point).gain:0,turnover=['throwaway','block','stall'].includes(e.outcome);
  if(ours){
   if(wanted(e.throwerId)){const row=offenseRow(e.throwerId,marker);if(!skipEdge)row.pointIds.add(point.id);row.throws++;if(complete){row.completions++;row.throwGain+=gain;}if(turnover)row.turnovers++;if(e.outcome==='goal')row.assists++;if(e.break)row.breaks++;row.edge+=skipEdge?0:throwValue;}
   if(wanted(e.receiverId)){const row=offenseRow(e.receiverId,receiverDefender);if(!skipEdge)row.pointIds.add(point.id);row.targets++;if(complete){row.catches++;row.catchGain+=gain;}if(e.outcome==='drop')row.drops++;if(e.outcome==='goal')row.goals++;row.edge+=skipEdge?0:receiveValue;}
  }else{
   if(wanted(marker)){const row=defenseRow(marker,e.throwerId);if(!skipEdge)row.pointIds.add(point.id);row.throwsMarked++;if(complete){row.completionsAllowed++;row.throwGainAllowed+=gain;}if(turnover)row.throwaways++;if(e.break)row.breaksAllowed++;if(e.outcome==='goal')row.assistsAllowed++;row.edgeAllowed+=skipEdge?0:throwValue;}
   if(wanted(receiverDefender)){const row=defenseRow(receiverDefender,e.receiverId);if(!skipEdge)row.pointIds.add(point.id);row.targets++;if(complete){row.catchesAllowed++;row.catchGainAllowed+=gain;}if(e.outcome==='goal')row.goalsAllowed++;row.edgeAllowed+=skipEdge?0:receiveValue;}
   if(e.outcome==='block'&&wanted(e.blockerId)){const row=defenseRow(e.blockerId,e.handBlock?e.throwerId:e.receiverId);if(!skipEdge)row.pointIds.add(point.id);row.blocks++;}
  }
 }
 // a matchup counts as facing each other on a point even when no pass was recorded, in whichever role their team played that point
 for(const point of points){
  if(pointExcluded(point))continue;
  const roles=sideRoles(point,side);
  for(const pair of pointMatchups(point))for(const [playerId,partner] of pair[0]===pair[1]?[[pair[0],pair[1]]]:[[pair[0],pair[1]],[pair[1],pair[0]]]){
   if(!wanted(playerId)||!partner)continue;
   const opponentId=partner===UNKNOWN_MATCHUP?null:partner;
   if(roles.offense)offenseRow(playerId,opponentId).pointIds.add(point.id);
   if(roles.defense&&opponentId!==UNGUARDED)defenseRow(playerId,opponentId).pointIds.add(point.id);
  }
 }
 // points matched: the points in which the two players faced each other at least once
 const pointNumberOf=new Map(points.map((point,index)=>[point.id,index+1])),finish=(row,edgeKey,perPointKey)=>{const {pointIds,...rest}=row;return {...rest,points:pointIds.size,pointNumbers:[...pointIds].map(id=>pointNumberOf.get(id)).sort((a,b)=>a-b),[perPointKey]:pointIds.size?row[edgeKey]/pointIds.size:0};};
 return new Map([...players].map(([playerId,{offense,defense}])=>[playerId,{offense:[...offense.values()].map(row=>finish(row,'edge','edgePerPoint')),defense:[...defense.values()].map(row=>finish(row,'edgeAllowed','edgeAllowedPerPoint'))}]));
}
// EDGE credit for one point's passes through add(playerId,key,value); secondary credit follows completed passes within a possession
function creditPointEdges(p,ose,field,previousShare,previousPreviousShare,add){
 let previous=[];
  for(const e of p.events){
   if(e.type==='possession_start'){if(e.side==='us')previous=[];continue;}
   if(e.type!=='pass')continue;
   const {complete,throwValue,receiveValue}=passEdge(e,p,ose,field);
   if(e.side!=='us'){add(e.markerId,'throwEdgeAllowed',throwValue);add(e.receiverDefenderId,'receiveEdgeAllowed',receiveValue);continue;}
   add(e.throwerId,'throwingEdge',throwValue);add(e.receiverId,'receivingEdge',receiveValue);
   if(complete&&e.from&&e.to){const lateralCredit=LATERAL_EDGE_PER_YARD*Math.abs(e.to.y-e.from.y);add(e.throwerId,'lateralEdge',lateralCredit);add(e.receiverId,'lateralEdge',lateralCredit);}
   const value=throwValue+receiveValue;
   add(previous.at(-1),'secondaryThrowingEdge',value*previousShare);add(previous.at(-2),'secondaryThrowingEdge',value*previousPreviousShare);
   if(complete&&e.throwerId)previous.push(e.throwerId); else previous=[];
  }
}
// advancedStatsFor's throwing, receiving and secondary EDGE and opportunities for each point on its own (pointsOf order), for the given players; these add up point by point, so any set of points can be summed without rerunning the game
export function pointEdgeRows(game,playerIds,ose=.56,previousShare=.3,previousPreviousShare=.1){
 const tracked=new Set(playerIds);
 return pointsOf(game).map(p=>{
  const rows=new Map();if(pointExcluded(p))return rows;
  const rowOf=id=>{if(!rows.has(id))rows.set(id,{throwingEdge:0,receivingEdge:0,secondaryThrowingEdge:0,opportunities:0});return rows.get(id);};
  if(pointHasOpportunity(p))for(const id of pointPlayers(p))if(tracked.has(id))rowOf(id).opportunities++;
  creditPointEdges(p,ose,game.field,previousShare,previousPreviousShare,(id,key,value)=>{if(tracked.has(id)&&key in POINT_EDGE_KEYS)rowOf(id)[key]+=value;});
  return rows;
 });
}
const POINT_EDGE_KEYS={throwingEdge:1,receivingEdge:1,secondaryThrowingEdge:1};
// our team had the disc at some point in this point (started on O, picked it up, or the opponent gave it away)
function pointHasOpportunity(p){if(p.starting==='O')return true;for(const e of p.events)if((e.type==='possession_start'&&e.side==='us')||(e.side==='them'&&((e.type==='pass'&&!['complete','goal'].includes(e.outcome))||e.type==='turnover')))return true;return false;}
export function advancedStatsFor(game,team,ose=.56,previousShare=.3,previousPreviousShare=.1,includeSecondaryInTotal=false,huckYards=35){
 const base=statsFor([team],[game],huckYards),rows=new Map(base.map(row=>[row.id,{...row,plusMinus:row.goals+row.assists+row.blocks-row.throwaways-row.drops,throwingEdge:0,receivingEdge:0,secondaryThrowingEdge:0,totalEdge:0,totalEdgePerPoint:0,totalEdgePerTouch:0,lateralEdge:0,ledge:0,ledgePerPoint:0,throwEdgeAllowed:0,receiveEdgeAllowed:0,edgeAllowed:0,edgeAllowedPerPoint:0,opponentScoredRate:0,opponentScoredRateFromD:0,opponentScoredRateFromO:0}]));
 const pointList=pointsOf(game);
 const excludedIds=new Set(pointList.filter(pointExcluded).flatMap(p=>[p.id,...p.events.map(e=>e.id)]));
 if(excludedIds.size)for(const row of statsFor([team],[{...game,events:game.events.filter(e=>excludedIds.has(e.id))}],huckYards))if(rows.has(row.id)){rows.get(row.id).opportunities-=row.opportunities;rows.get(row.id).guardedDefenseOpportunities-=row.guardedDefenseOpportunities;}
 const add=(id,key,value)=>{if(id&&rows.has(id))rows.get(id)[key]+=value;};
 for(const p of pointList)if(!pointExcluded(p))creditPointEdges(p,ose,game.field,previousShare,previousPreviousShare,add);
 for(const row of rows.values()){row.edgeAllowed=row.throwEdgeAllowed+row.receiveEdgeAllowed;row.totalEdge=row.throwingEdge+row.receivingEdge+(includeSecondaryInTotal?row.secondaryThrowingEdge:0);row.totalEdgePerPoint=row.opportunities?row.totalEdge/row.opportunities:0;row.ledge=row.totalEdge+row.lateralEdge;row.ledgePerPoint=row.opportunities?row.ledge/row.opportunities:0;row.edgeAllowedPerPoint=row.guardedDefenseOpportunities?row.edgeAllowed/row.guardedDefenseOpportunities:0;row.opponentScoredRate=row.defenseOpportunities?(row.opponentScoredFromD+row.opponentScoredFromO)/row.defenseOpportunities:0;row.opponentScoredRateFromD=row.defenseOpportunitiesFromD?row.opponentScoredFromD/row.defenseOpportunitiesFromD:0;row.opponentScoredRateFromO=row.defenseOpportunitiesFromO?row.opponentScoredFromO/row.defenseOpportunitiesFromO:0;const touches=row.catches+row.initiated;row.totalEdgePerTouch=touches?row.totalEdge/touches:0;}
 return {rows:[...rows.values()]};
}
export function validateData(data){
 const fail=m=>{throw new Error(`Invalid game file: ${m}`);};
 if(data?.format!=='righttrousers'||data.version!==1)fail('expected Right Trousers JSON version 1.');
 if(!Array.isArray(data.teams)||!Array.isArray(data.games))fail('teams and games must be arrays.');
 const ids=new Set(), teamIds=new Set();
 const id=(s,scope)=>{if(typeof s!=='string'||!s||s.length>200)fail('invalid ID');const k=scope+':'+s;if(ids.has(k))fail('duplicate '+scope+' ID');ids.add(k);};
 const str=s=>{if(typeof s!=='string'||s.length>500)fail('invalid text');};
 const coordinate=c=>{if(!c||!Number.isFinite(c.x)||!Number.isFinite(c.y)||Math.abs(c.x)>1000||Math.abs(c.y)>1000)fail('invalid coordinates');};
 const rating=r=>{if(r!=null&&!Number.isFinite(r))fail('invalid rating');};
 for(const t of data.teams){id(t.id,'team');teamIds.add(t.id);str(t.name);rating(t.rating);if(!Array.isArray(t.players))fail('missing roster');for(const p of t.players){id(p.id,'player');str(p.name);if(p.number!=null)str(p.number);if(p.gender!=null&&!['','M','F','X'].includes(p.gender))fail('invalid gender');}if(t.groups!==undefined&&!Array.isArray(t.groups))fail('invalid groups');for(const group of t.groups||[]){id(group.id,'group');str(group.name);if(!Array.isArray(group.playerIds)||group.playerIds.some(playerId=>!t.players.some(player=>player.id===playerId)))fail('group references a missing player');}}
  for(const g of data.games){id(g.id,'game');str(g.opponent);rating(g.opponentRating);if(g.tournament!=null)str(g.tournament);if(!teamIds.has(g.teamId))fail('game references a missing team');if(!Array.isArray(g.events)||!Array.isArray(g.opponents))fail('missing events/opponents');let hasPoint=false;for(const e of g.events){id(e.id,'event');if(!['point_start','possession_start','pass','turnover','unattributed_goal','substitution','point_end','force'].includes(e.type))fail('unknown event type');if(e.type==='point_start'){hasPoint=true;if(!Array.isArray(e.line)||e.line.length>7||(e.opponentLine!==undefined&&(!Array.isArray(e.opponentLine)||e.opponentLine.length>7))||!['O','D'].includes(e.starting)||![1,-1].includes(e.direction))fail('invalid point setup');}else if(!hasPoint)fail('event before first point');if(e.type==='pass'){if(!['us','them'].includes(e.side)||!['complete','goal','drop','throwaway','block','stall'].includes(e.outcome))fail('invalid pass');coordinate(e.from);coordinate(e.to);}if(e.type==='possession_start'){coordinate(e.location);if(!['us','them'].includes(e.side))fail('invalid possession');}if(e.type==='substitution'&&(!['us','them'].includes(e.side)||(e.outId!==null&&typeof e.outId!=='string')||typeof e.inId!=='string'))fail('invalid substitution');if(e.type==='point_end'&&!['us','them'].includes(e.winner))fail('invalid point result');if(e.type==='force'&&(!['us','them'].includes(e.side)||!FORCES.includes(e.force)))fail('invalid force');if(e.type==='pass'&&e.force!=null&&!FORCES.includes(e.force))fail('invalid pass force');}}
 return data;
}
// Imports are additive. Existing game IDs are never silently overwritten; a missing team rating, player number or gender, game tournament or opponent rating is filled from the incoming copy.
// older games recorded no defender as unknown; where the defending roster is known:
// - a first throw of a possession with no marker becomes unguarded
// - a throw whose marker is unguarded and whose receiver's defender is unknown gets an unguarded receiver's defender
// - a throw following an unguarded receiver's defender, with no marker, gets an unguarded marker
// unguardedApplied is the version run (true = 1, before the receiver's-defender rules); a game is upgraded once, so a defender left blank later stays unknown
export const UNGUARDED_VERSION=2;
// Statto imports before 2026-11-12 stored a missing player as {}; any *Id field holding an object becomes null
export function clearBlankPlayerIds(game){
 let changed=false;
 for(const e of game.events)for(const [key,value] of Object.entries(e))if(key.endsWith('Id')&&value!==null&&typeof value==='object'&&!Array.isArray(value)){e[key]=null;changed=true;}
 return changed;
}
export function applyUnguarded(game){
 const appliedVersion=game.unguardedApplied===true?1:game.unguardedApplied||0;
 let changed=clearUnguardedBreaks(game);
 if(appliedVersion>=UNGUARDED_VERSION)return changed;
 game.unguardedApplied=UNGUARDED_VERSION;
 if(game.source?.defenseAvailable===false)return changed;
 for(const point of pointsOf(game)){
  let previous={us:null,them:null};
  for(const e of point.events){
   if(e.type==='possession_start'||e.type==='turnover'){previous={us:null,them:null};continue;}
   if(e.type!=='pass')continue;
   const markerKey=e.side==='us'?'opponentMarkerId':'markerId',defenderKey=e.side==='us'?'opponentReceiverDefenderId':'receiverDefenderId',defenderRosterKnown=e.side==='us'?game.opponents.length>0:true;
   if(defenderRosterKnown){
    const first=!previous[e.side];
    if(!e[markerKey]&&((first&&appliedVersion===0)||(!first&&previous[e.side][defenderKey]===UNGUARDED))){e[markerKey]=UNGUARDED;changed=true;}
    if(e.receiverId&&!e[defenderKey]&&e[markerKey]===UNGUARDED){e[defenderKey]=UNGUARDED;changed=true;}
    if(e.break&&e[markerKey]===UNGUARDED){e.break=false;changed=true;}
   }
   previous=['complete','goal'].includes(e.outcome)?{...previous,[e.side]:e}:{us:null,them:null};
  }
 }
 return changed;
}
// passes saved before unguarded markers ruled out breaks can still carry break:true
function clearUnguardedBreaks(game){
 let changed=false;
 for(const e of game.events)if(e.type==='pass'&&e.break&&e[e.side==='us'?'opponentMarkerId':'markerId']===UNGUARDED){e.break=false;changed=true;}
 return changed;
}
export function mergeData(current,incoming){
 validateData(incoming);const next=structuredClone(current);let added=0,skipped=0;
 for(const t of incoming.teams){const existing=next.teams.find(x=>x.id===t.id);if(!existing)next.teams.push(t);else{for(const p of t.players){const known=existing.players.find(x=>x.id===p.id);if(!known)existing.players.push(p);else for(const field of ['number','gender'])if(!known[field]&&p[field])known[field]=p[field];}existing.groups??=[];for(const group of t.groups||[])if(!existing.groups.some(x=>x.id===group.id))existing.groups.push(group);if(existing.rating==null&&t.rating!=null)existing.rating=t.rating;}}
 for(const g of incoming.games){const existing=next.games.find(x=>x.id===g.id);if(existing){skipped++;if(!existing.tournament&&g.tournament)existing.tournament=g.tournament;if(existing.opponentRating==null&&g.opponentRating!=null)existing.opponentRating=g.opponentRating;}else{clearBlankPlayerIds(g);applyUnguarded(g);next.games.push(g);added++;}}
 for(const source of incoming.sources||[])if(!next.sources.some(s=>s.id===source.id))next.sources.push(source);
 return {data:next,added,skipped};
}

// moves a catch or a possession start; later events in the point that sat on the old spot (the next throw's origin, a stall, a turnover) move with it
export function moveEventLocation(game,id,to){
 const index=game.events.findIndex(e=>e.id===id),moved=game.events[index],isCatch=moved?.type==='pass'&&['complete','goal'].includes(moved.outcome);
 if(!isCatch&&moved?.type!=='possession_start')throw new Error(`event ${id} is not a catch or possession start`);
 const key=isCatch?'to':'location',old=moved[key],spot=()=>({x:to.x,y:to.y}),atOld=place=>!!place&&!!old&&place.x===old.x&&place.y===old.y,changed=[moved];
 moved[key]=spot();
 for(const e of game.events.slice(index+1)){
  if(['point_start','point_end','possession_start'].includes(e.type))break;
  let touched=false;for(const field of ['from','to','location'])if(atOld(e[field])){e[field]=spot();touched=true;}
  if(touched)changed.push(e);
  if(e.type==='pass'&&!(e.to&&e.to.x===to.x&&e.to.y===to.y))break;
 }
 const point=pointsOf(game).find(p=>p.events.some(e=>e.id===id));
 for(const e of changed)if(e.type==='pass')e.break=isBreak(e,point,game.field);
 return changed;
}

// deletes a pass; if it was a catch, the disc never left the thrower: the following events on the catch spot move back to the throw's origin, and the next throw passes to the deleted pass's thrower and marker
export function deletePass(game,id){
 const removed=game.events.find(e=>e.id===id);
 if(removed?.type!=='pass')throw new Error(`event ${id} is not a pass`);
 const changed=new Set();
 if(['complete','goal'].includes(removed.outcome)){
  const index=game.events.indexOf(removed),next=game.events.slice(index+1).find(e=>e.type==='pass'||['point_start','point_end','possession_start'].includes(e.type));
  if(next?.type==='pass'&&next.side===removed.side&&next.throwerId===removed.receiverId){next.throwerId=removed.throwerId;next.markerId=removed.markerId;next.opponentMarkerId=removed.opponentMarkerId;changed.add(next);}
  if(removed.from&&removed.to)for(const e of moveEventLocation(game,id,removed.from))if(e!==removed)changed.add(e);
  const point=pointsOf(game).find(p=>p.events.some(e=>e.id===id));
  for(const e of changed)if(e.type==='pass')e.break=isBreak(e,point,game.field);
 }
 game.events.splice(game.events.indexOf(removed),1);
 return {removed,changed:[...changed]};
}
