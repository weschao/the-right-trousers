import {gamesForTeam,advancedStatsFor,offensiveScoringEfficiency,matchupBreakdown,gameState,UNGUARDED,pointEdgeRows,mirrorGame,pointsOf} from './core.js';
import {playerOccurrences,connectionStats} from './player-detail.js';
import {eventVideoLink,pointVideos,importedPointTimestamps,timestampSeconds,videoSource} from './video.js';

// This is a read model, not a game export: never return events, revisions, source records,
// or an entire game object to a player. All calculations use the existing stat functions.
export function playerProjection(library,teamId,playerId,{gameIds=[],huckYards=35}={}){
 const team=library.teams.find(t=>t.id===teamId),player=team?.players.find(p=>p.id===playerId);
 if(!player)throw new Error('Player unavailable');
 const all=gamesForTeam(library,teamId),chosen=new Set(gameIds),games=chosen.size?all.filter(g=>chosen.has(g.id)):all,settings=library.settings||{};
 const ose=g=>g.settings?.ose??(team.name==='Mischief 2026'?offensiveScoringEfficiency(all,teamId):.56);
 const summary=gs=>{const found=playerOccurrences(gs,playerId,huckYards),result={};for(const [key,rows] of Object.entries(found))result[key]=rows.length;
  result.huckCompletions=found.hucks.filter(r=>r.detail.note==='Completed').length;
  let edge=0,opportunities=0;for(const g of gs){const row=advancedStatsFor(g,team,ose(g),settings.secondaryPreviousShare??.3,settings.secondaryPreviousPreviousShare??.1,settings.includeSecondaryInTotal??false,huckYards).rows.find(r=>r.id===playerId);if(row){edge+=row.totalEdge;opportunities+=row.opportunities;}}
  return {...result,totalEdge:edge,totalEdgePerPoint:opportunities?edge/opportunities:0};};
 const playerNames=new Map(library.teams.flatMap(t=>t.players.map(p=>[p.id,{id:p.id,name:p.name,teamId:t.id}]))),name=(id,g)=>playerNames.get(id)?.name||g?.opponents.find(p=>p.id===id)?.name||(id===UNGUARDED?'Unguarded':'Unknown');
 const links=rows=>rows.map(({passes,...row})=>({...row,name:name(row.id),teamId:playerNames.get(row.id)?.teamId===teamId?teamId:null}));
 const matchup={offense:new Map(),defense:new Map()},breakdowns=new Map(games.map(g=>[g,matchupBreakdown(g,playerId,'us',ose(g))])),excluded=new Map(),pointCache=new Map();
 for(const g of games)for(const row of breakdowns.get(g).defense){if(!row.opponentId||row.opponentId===UNGUARDED)continue;if(!excluded.has(row.opponentId))excluded.set(row.opponentId,new Map());excluded.get(row.opponentId).set(g.id,row.pointNumbers);}
 const defensiveRows=g=>breakdowns.get(g).defense.map(row=>{
  if(!row.opponentId||row.opponentId===UNGUARDED)return {...row,baselineEdge:0,baselineOpportunities:0,markedThrowawayEdge:0};
  const opponentTeam=library.teams.find(t=>t.players.some(p=>p.id===row.opponentId)),others=library.games.filter(game=>game.id!==g.id&&(game.teamId===opponentTeam?.id||game.opponents?.some(p=>p.id===row.opponentId)));
  let baselineEdge=0,baselineOpportunities=0;
  for(const game of [g,...others]){const mirrored=game===g||game.teamId!==opponentTeam?.id,roster=game===g?g.opponents:mirrored?game.opponents:opponentTeam.players,gameOse=game===g?ose(g):game.settings?.ose??(opponentTeam?.name==='Mischief 2026'?offensiveScoringEfficiency(gamesForTeam(library,opponentTeam.id),opponentTeam.id):.56),key=JSON.stringify([game.id,mirrored,gameOse]);
   if(!pointCache.has(key))pointCache.set(key,pointEdgeRows(mirrored?mirrorGame(game):game,(roster||[]).map(p=>p.id),gameOse,settings.secondaryPreviousShare??.3,settings.secondaryPreviousPreviousShare??.1));
   const guarded=new Set(excluded.get(row.opponentId)?.get(game.id)||(game===g?row.pointNumbers:[]));
   pointCache.get(key).forEach((byPlayer,index)=>{const r=byPlayer.get(row.opponentId);if(guarded.has(index+1)||!r)return;baselineEdge+=r.throwingEdge+r.receivingEdge+(settings.includeSecondaryInTotal?r.secondaryThrowingEdge:0);baselineOpportunities+=r.opportunities;});
  }
  const markedThrowawayEdge=pointsOf(g).filter(p=>!p.events.some(e=>e.type==='unattributed_goal')).flatMap(p=>p.events).filter(e=>e.type==='pass'&&e.side==='them'&&['throwaway','block','stall'].includes(e.outcome)&&e.throwerId===row.opponentId&&e.markerId===playerId).reduce(total=>total-ose(g),0);
  return {...row,baselineEdge,baselineOpportunities,markedThrowawayEdge};
 });
 for(const g of games){const breakdown={...breakdowns.get(g),defense:defensiveRows(g)};for(const side of ['offense','defense'])for(const row of breakdown[side]){
  const key=JSON.stringify([row.opponentId,g.opponent]),prior=matchup[side].get(key);
  if(!prior)matchup[side].set(key,{...row,name:name(row.opponentId,g),teamName:g.opponent,pointNumbers:[]});
  else for(const [field,value] of Object.entries(row))if(typeof value==='number'&&!field.endsWith('PerPoint'))prior[field]=field==='baselineEdge'||field==='baselineOpportunities'?value:prior[field]+value;
 }}
 const received=connectionStats(games,playerId,'received',ose),thrown=connectionStats(games,playerId,'thrown',ose),occurrences=playerOccurrences(games,playerId,huckYards),clips={};
 occurrences.unknownReceived=received.find(r=>r.id===null)?.passes||[];occurrences.unknownThrown=thrown.find(r=>r.id===null)?.passes||[];
 for(const [key,rows] of Object.entries(occurrences))clips[key]=rows.map(row=>{const g=row.game,pv=pointVideos(g),index=row.event?.id?g.events.findIndex(e=>e.id===row.event.id):-1,previous=index>0?g.events[index-1]:null,timestamp=row.event?.videoTimestamp||previous?.videoTimestamp||row.point?.videoTimestamp||importedPointTimestamps(g)[row.pointIndex]||'',detail=row.detail||{};
  return {gameId:g.id,opponent:g.opponent,date:g.date,pointIndex:row.pointIndex,scoreBefore:row.scoreBefore,detail,otherName:name(detail.otherId,g),notes:row.event?.notes||'',timestamp,
   videoUrl:row.event?eventVideoLink(g,row.event,pv.links?.[row.pointIndex]):pv.links?.[row.pointIndex]||g.videoLink||'',
   seconds:timestampSeconds(timestamp)};
 });
 const selectedSummary=summary(games);
 return {team:{id:team.id,name:team.name},player:{id:player.id,name:player.name,number:player.number,gender:player.gender},summary:selectedSummary,allSummary:summary(all),
  games:all.map(g=>({id:g.id,date:g.date,opponent:g.opponent,tournament:g.tournament,score:gameState(g).score})),
  received:links(received),thrown:links(thrown),
  // Only the video setup of games represented on this authorized PD page is shared.
  // No events, revisions or imported source records accompany it.
  viewers:Object.fromEntries(games.filter(g=>g.enhancedTracker&&videoSource(g.videoLink)?.kind==='veo').map(g=>[g.id,{id:g.id,videoLink:g.videoLink,field:g.field,veoSession:g.veoSession,enhancedTracker:true,finished:true}])),
  matchups:Object.fromEntries(Object.entries(matchup).map(([side,rows])=>[side,[...rows.values()].map(row=>({...row,edgePerPoint:row.points?row.edge/row.points:0,edgePerPointPlusMinus:row.points?selectedSummary.totalEdgePerPoint-row.edge/row.points:null,edgeAllowedPerPoint:row.points?row.edgeAllowed/row.points:0,edgeAllowedPerPointPlusMinus:row.baselineOpportunities&&row.points?row.baselineEdge/row.baselineOpportunities-row.edgeAllowed/row.points:null,edgeAllowedPerPointPlusMinusNoMarkedThrowaways:row.baselineOpportunities&&row.points?row.baselineEdge/row.baselineOpportunities-(row.edgeAllowed-row.markedThrowawayEdge)/row.points:null}))])),clips};
}
