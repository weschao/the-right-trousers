import {pointsOf,passMetrics,passEdge,pointExcluded,isHuckPass} from './core.js';

const lostOutcomes=['throwaway','block','stall'];

// one list of occurrences per stat on the player page; every row keeps its game, point and event so the page can link to video
export function playerOccurrences(games,playerId,huckYards=35){
 const result={games:[],oPoints:[],dPoints:[],goals:[],assists:[],throwaways:[],drops:[],blocks:[],hucks:[]};
 for(const game of games){
  const points=pointsOf(game),score=[0,0];
  let played=false;
  points.forEach((point,pointIndex)=>{
   const scoreBefore=`${score[0]}-${score[1]}`,row=(event,detail={})=>({game,point,pointIndex,event,scoreBefore,detail});
   const onPoint=new Set([...point.line,...point.events.filter(e=>e.type==='substitution'&&e.side==='us').flatMap(e=>[e.outId,e.inId])]);
   if(onPoint.has(playerId)){played=true;result[point.starting==='O'?'oPoints':'dPoints'].push(row(null));}
   for(const event of point.events){
    if(event.type==='turnover'){
     if(event.side==='them'&&event.blockerId===playerId){
      if(event.reason==='block')result.blocks.push(row(event));
      if(event.callahan)result.goals.push(row(event,{note:'Callahan'}));
     }
     if(event.side==='us'&&event.playerId===playerId&&['stall','block'].includes(event.reason))result.throwaways.push(row(event,{note:event.reason==='stall'?'Stalled':'Blocked'}));
     continue;
    }
    if(event.type!=='pass')continue;
    if(event.side==='them'){if(event.outcome==='block'&&event.blockerId===playerId)result.blocks.push(row(event));continue;}
    const complete=['complete','goal'].includes(event.outcome);
    if(event.throwerId===playerId){
     if(event.outcome==='goal')result.assists.push(row(event,{preposition:'to',otherId:event.receiverId}));
     if(lostOutcomes.includes(event.outcome))result.throwaways.push(row(event,{preposition:'to',otherId:event.receiverId,note:event.outcome==='throwaway'?'':event.outcome==='stall'?'Stalled':'Blocked'}));
     if(isHuckPass(event,point,huckYards))result.hucks.push(row(event,{preposition:'to',otherId:event.receiverId,note:complete?'Completed':'Incomplete'}));
    }
    if(event.receiverId===playerId){
     if(event.outcome==='goal')result.goals.push(row(event,{preposition:'from',otherId:event.throwerId}));
     if(event.outcome==='drop')result.drops.push(row(event,{preposition:'from',otherId:event.throwerId}));
    }
   }
   if(point.winner==='us')score[0]++;
   if(point.winner==='them')score[1]++;
  });
  if(played)result.games.push({game,pointIndex:null,event:null,scoreBefore:`${score[0]}-${score[1]}`,detail:{}});
 }
 return result;
}

// edge is the selected player's own share of each pass (receiveValue when receiving, throwValue when throwing), never both sides summed
// teammates on the other end of this player's passes: 'received' groups passes thrown to the player by thrower, 'thrown' groups the player's passes by receiver
export function connectionStats(games,playerId,direction,oseFor){
 const rows=new Map(),totalThrows=new Map(),throwsToPlayer=new Map(),bump=(map,id)=>map.set(id,(map.get(id)||0)+1);
 for(const game of games){
  const ose=oseFor(game);
  for(const point of pointsOf(game)){
   if(pointExcluded(point))continue;
   for(const event of point.events){
    if(event.type!=='pass'||event.side!=='us')continue;
    // throw share: 'received' is each thrower's throws aimed at the selected player; 'thrown' is the selected player's throws aimed at each target
    if(event.throwerId){bump(totalThrows,event.throwerId);if(event.receiverId===playerId)bump(throwsToPlayer,event.throwerId);}
    const [self,partner]=direction==='received'?[event.receiverId,event.throwerId]:[event.throwerId,event.receiverId];
    if(self!==playerId||!partner||partner===playerId)continue;
    if(!rows.has(partner))rows.set(partner,{id:partner,throws:0,completions:0,goals:0,throwaways:0,drops:0,throwDistance:0,throwGain:0,edge:0});
    const row=rows.get(partner),complete=['complete','goal'].includes(event.outcome),{distance,gain}=passMetrics(event,point),{throwValue,receiveValue}=passEdge(event,point,ose,game.field);
    row.throws++;
    if(complete){row.completions++;row.throwDistance+=distance;row.throwGain+=gain;}
    if(event.outcome==='goal')row.goals++;
    if(lostOutcomes.includes(event.outcome))row.throwaways++;
    if(event.outcome==='drop')row.drops++;
    row.edge+=direction==='received'?receiveValue:throwValue;
   }
  }
 }
 return [...rows.values()].map(row=>({...row,completionRate:row.completions/row.throws,throwShare:direction==='received'?(throwsToPlayer.get(row.id)||0)/totalThrows.get(row.id):row.throws/totalThrows.get(playerId),edgePerThrow:row.edge/row.throws}));
}
