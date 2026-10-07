import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {pointsOf,groupOnOffStats} from '../web/core.js';import {FIELD,emptyData,event,mirrorGame,isBreak,pullMetrics,advancedStatsFor,UNGUARDED,UNGUARDED_VERSION,UNKNOWN_MATCHUP,applyUnguarded,recomputeBreaks,matchupBreakdown,matchupCoverage,pointMatchups,statsFor,gameState,mergeData,validateData,playersForGroup,lineSlots,teamRates,gamesForTeam,gamesFromEverySide,throwsPerPossession} from '../web/core.js';import {readStattoZip,convertStatto} from '../web/statto.js';
const team={id:'t',name:'Team',players:Array.from({length:7},(_,i)=>({id:'p'+i,name:'Player '+i,number:String(i)}))};
const make=()=>({id:'g',teamId:'t',opponent:'Other',opponents:[],field:FIELD,events:[]});
const start=(g,starting='O',direction=1)=>g.events.push(event('point_start',{line:team.players.map(p=>p.id),starting,direction}));
const pickup=(g,side,playerId,location={x:25,y:20})=>g.events.push(event('possession_start',{side,playerId,location}));
const pass=(g,props)=>g.events.push(event('pass',{side:'us',throwerId:'p0',receiverId:'p1',from:{x:25,y:20},to:{x:28,y:24},outcome:'complete',...props}));
const stats=g=>Object.fromEntries(statsFor([team],[g]).map(p=>[p.id,p]));
test('completed yardage, backward gain, goal and secondary assist are derived',()=>{const g=make();start(g);pickup(g,'us','p0');pass(g,{});pass(g,{throwerId:'p1',receiverId:'p2',from:{x:28,y:24},to:{x:24,y:24}});pass(g,{throwerId:'p2',receiverId:'p3',from:{x:24,y:24},to:{x:92,y:24},outcome:'goal'});const s=stats(g);assert.equal(s.p0.throwDistance,5);assert.equal(s.p0.throwGain,3);assert.equal(s.p1.catchDistance,5);assert.equal(s.p1.throwGain,-4);assert.equal(s.p1.secondaryAssists,1);assert.equal(s.p0.secondaryAssists,0);assert.equal(s.p2.assists,1);assert.equal(s.p3.goals,1);assert.equal(s.p0.initiated,1);assert.deepEqual(gameState(g).score,[1,0]);assert.equal(gameState(g).nextStarting,'D');assert.equal(s.p6.opportunities,1);});
test('opponent receiver defender becomes next marker; defense metrics',()=>{const g=make();start(g,'D');pickup(g,'them',null);pass(g,{side:'them',throwerId:null,receiverId:'opp1',markerId:'p0',receiverDefenderId:'p1'});let state=gameState(g);assert.equal(state.marker,'p1');assert.equal(state.holder,'opp1');pass(g,{side:'them',throwerId:'opp1',receiverId:null,from:{x:28,y:24},to:{x:18,y:24},markerId:state.marker,receiverDefenderId:'p2',outcome:'goal'});const s=stats(g);assert.equal(s.p0.throwAllowed,5);assert.equal(s.p1.receiveAllowed,5);assert.equal(s.p1.throwAllowed,10);assert.equal(s.p1.assistsAllowed,1);assert.equal(s.p2.goalsAllowed,1);assert.equal(s.p2.targets,1);assert.equal(s.p6.opportunities,0);assert.equal(gameState(g).nextStarting,'O');});
test('turnovers award defensive opportunity once and exclude incomplete yardage',()=>{const g=make();start(g,'D');pickup(g,'them',null);pass(g,{side:'them',markerId:'p4',receiverDefenderId:'p3',outcome:'throwaway'});assert.equal(gameState(g).needsPickup,true);assert.equal(gameState(g).side,'us');pickup(g,'us','p2');pass(g,{throwerId:'p2',receiverId:'p1',outcome:'drop'});pickup(g,'them',null);pass(g,{side:'them',markerId:'p0',receiverDefenderId:'p1',blockerId:'p5',outcome:'block'});const s=stats(g);assert.equal(s.p4.forcedThrowaways,1);assert.equal(s.p3.targets,1);assert.equal(s.p4.throwAllowed,0);assert.equal(s.p2.throwDistance,0);assert.equal(s.p1.drops,1);assert.equal(s.p2.throwaways,0);assert.equal(s.p5.blocks,1);assert.equal(s.p6.opportunities,1);});
test('reverse direction produces positive forward gain and undo recalculates score',()=>{const g=make();start(g,'O',-1);pickup(g,'us','p0');pass(g,{from:{x:35,y:20},to:{x:15,y:20},outcome:'goal'});assert.equal(stats(g).p0.throwGain,20);g.events.pop();assert.equal(stats(g).p1.goals,0);assert.deepEqual(gameState(g).score,[0,0]);assert.equal(gameState(g).active,true);});
test('a turnover breaks the secondary assist chain',()=>{const g=make();start(g);pickup(g,'us','p0');pass(g,{});pass(g,{throwerId:'p1',outcome:'throwaway'});pickup(g,'us','p2');pass(g,{throwerId:'p2',receiverId:'p3',outcome:'goal'});assert.equal(stats(g).p0.secondaryAssists,0);});
test('rate summary derives holds, breaks, turnovers, and hucks from play-by-play',()=>{const g=make();start(g,'O');pickup(g,'us','p0',{x:20,y:20});pass(g,{from:{x:20,y:20},to:{x:60,y:20},outcome:'complete'});g.events.push(event('point_end',{winner:'us'}));start(g,'O');pickup(g,'us','p0');pass(g,{outcome:'throwaway'});g.events.push(event('point_end',{winner:'them'}));start(g,'D');pickup(g,'them',null);pass(g,{side:'them',outcome:'throwaway'});pickup(g,'us','p0');pass(g,{outcome:'goal'});g.events.push(event('point_end',{winner:'us'}));const r=teamRates([g],35);assert.deepEqual(r,{offense:2,holds:1,cleanHolds:1,defense:1,turns:1,breaks:1,huckAttempts:1,huckCompletions:1});});
test('player huck completion rate follows the configured distance threshold',()=>{const g=make();start(g);pickup(g,'us','p0',{x:10,y:20});pass(g,{from:{x:10,y:20},to:{x:50,y:20},outcome:'complete'});pass(g,{throwerId:'p1',from:{x:50,y:20},to:{x:90,y:20},outcome:'throwaway'});let s=stats(g);assert.equal(s.p0.huckCompletionRate,1);assert.equal(s.p1.huckCompletionRate,0);s=Object.fromEntries(statsFor([team],[g],45).map(player=>[player.id,player]));assert.equal(s.p0.huckAttempts,0);assert.equal(s.p1.huckAttempts,0);});
test('JSON round trip and idempotent game merge',()=>{const g=make();start(g);const d={...emptyData(),teams:[team],games:[g]};validateData(d);const round=JSON.parse(JSON.stringify(d));assert.deepEqual(statsFor(d.teams,d.games),statsFor(round.teams,round.games));const a=mergeData(emptyData(),round);const b=mergeData(a.data,round);assert.equal(a.added,1);assert.equal(b.added,0);assert.equal(b.skipped,1);assert.equal(b.data.teams[0].players.length,7);});
test('invalid imports are rejected',()=>{assert.throws(()=>validateData({format:'righttrousers',version:4}));const g=make();start(g);pass(g,{to:{x:NaN,y:1}});assert.throws(()=>validateData({...emptyData(),teams:[team],games:[g]}),/coordinates/);});
test('player groups filter the roster without changing roster order',()=>{const grouped={...team,groups:[{id:'o-line',name:'O-line',playerIds:['p4','p1','p6']}]};assert.deepEqual(playersForGroup(grouped,'o-line').map(player=>player.id),['p1','p4','p6']);assert.equal(playersForGroup(grouped,'all').length,7);assert.deepEqual(playersForGroup(grouped,'missing'),[]);validateData({...emptyData(),teams:[grouped]});});
test('short lines are padded with Unknown slots and capped at seven',()=>{const slots=lineSlots(team.players,['p0','p2']);assert.equal(slots.length,7);assert.deepEqual(slots.slice(0,2).map(player=>player.id),['p0','p2']);assert.equal(slots.filter(player=>player===null).length,5);assert.equal(lineSlots(team.players,team.players.map(player=>player.id).concat('extra')).length,7);const g=make();g.events.push(event('point_start',{line:['p0'],opponentLine:['opp'],starting:'O',direction:1}));validateData({...emptyData(),teams:[team],games:[g]});});
test('substitutions update the active line and credit everyone who appeared',()=>{const expanded={...team,players:[...team.players,{id:'p7',name:'Player 7',number:'7'}]},g=make();start(g);g.events.push(event('substitution',{side:'us',outId:'p6',inId:'p7'}));const s=Object.fromEntries(statsFor([expanded],[g]).map(player=>[player.id,player]));assert.equal(gameState(g).point.line.includes('p6'),false);assert.equal(gameState(g).point.line.includes('p7'),true);assert.equal(s.p6.points,1);assert.equal(s.p7.points,1);validateData({...emptyData(),teams:[expanded],games:[g]});});
test('a substitution can fill an open line slot',()=>{const expanded={...team,players:[...team.players,{id:'p7',name:'Player 7',number:'7'}]},g=make();g.events.push(event('point_start',{line:['p0'],starting:'O',direction:1}));g.events.push(event('substitution',{side:'us',outId:null,inId:'p7'}));assert.deepEqual(gameState(g).point.line,['p0','p7']);validateData({...emptyData(),teams:[expanded],games:[g]});});
test('group imports merge once and reject missing player references',()=>{const grouped={...team,groups:[{id:'o-line',name:'O-line',playerIds:['p0']}]},incoming={...emptyData(),teams:[grouped]};const first=mergeData({...emptyData(),teams:[{...team,groups:[]}]},incoming),second=mergeData(first.data,incoming);assert.equal(first.data.teams[0].groups.length,1);assert.equal(second.data.teams[0].groups.length,1);assert.throws(()=>validateData({...emptyData(),teams:[{...grouped,groups:[{id:'bad',name:'Bad',playerIds:['absent']}]}]}),/missing player/);});
test('Statto converter rotates coordinates, preserves raw source, and derives score',()=>{const raw={filename:'sample',teams:[{data:{team:{uuid:'t',name:'Team'},relations:{players:team.players.map(p=>({uuid:p.id,name:p.name,number:Number(p.number)})),games:[{uuid:'g',opponent:'Other',isFinished:true,pitchKind:0}],points:[{uuid:'pt',gameUUID:'g',isOffense:true,result:1,playerUUIDs:team.players.map(p=>p.id)}],possessions:[{uuid:'pos',pointUUID:'pt',initiatorUUID:'p0',startX:.5,startY:.8,createdAt:'2025-01-01T00:00:01Z'}],passes:[{uuid:'pass',possessionUUID:'pos',throwerUUID:'p0',receiverUUID:'p1',startX:.5,startY:.8,endX:.5,endY:.1,isAssist:true,createdAt:'2025-01-01T00:00:02Z'}]}}}]};const d=convertStatto(raw);const p=d.games[0].events.find(e=>e.type==='pass');assert.equal(p.to.x,99);assert.equal(p.to.y,20);assert.deepEqual(gameState(d.games[0]).score,[1,0]);assert.equal(statsFor(d.teams,d.games).find(p=>p.id==='p1').goals,1);assert.equal(d.sources[0].original,raw);});
const sample=process.env.STATTO_SAMPLE;
test('real Statto archive: all passes and points survive, raw metadata retained',{skip:!sample},async()=>{const b=await readFile(sample);const raw=await readStattoZip(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));const d=convertStatto(raw);assert.equal(d.teams.length,6);assert.equal(d.games.length,29);assert.equal(d.games.reduce((n,g)=>n+g.events.filter(e=>e.type==='pass').length,0),4113);assert.equal(d.games.reduce((n,g)=>n+g.events.filter(e=>e.type==='point_start').length,0),641);for(const t of raw.teams)for(const g of t.data.relations.games){const converted=d.games.find(x=>x.id===g.uuid),points=t.data.relations.points.filter(p=>p.gameUUID===g.uuid);assert.deepEqual(gameState(converted).score,[points.filter(p=>p.result===1).length,points.filter(p=>p.result===-1).length]);}assert.equal(d.sources[0].original.metadata.appVersion,'1.7.0');assert.deepEqual(statsFor(d.teams,d.games),statsFor(d.teams,JSON.parse(JSON.stringify(d.games))));});
test('our offense tracks the opponent defender chain after a turnover',()=>{const g=make();start(g,'D');g.events.push(event('possession_start',{side:'us',playerId:'p0',location:{x:25,y:20},opponentMarkerId:'opp0'}));assert.equal(gameState(g).marker,'opp0');pass(g,{opponentReceiverDefenderId:'opp1'});assert.equal(gameState(g).marker,'opp1');});
test('mirrored game gives the opponent a first-person view',()=>{const g=make();g.opponents=[{id:'opp0',name:'Opp 0',number:'0'}];g.events.push(event('point_start',{line:['p0'],opponentLine:['opp0'],starting:'D',direction:1}));g.events.push(event('possession_start',{side:'them',playerId:'opp0',location:{x:25,y:20}}));g.events.push(event('pass',{side:'them',throwerId:'opp0',receiverId:null,from:{x:25,y:20},to:{x:25,y:20},outcome:'throwaway',markerId:'p0',receiverDefenderId:null}));const opponentTeam={id:'o',name:'Other',players:g.opponents},rows=Object.fromEntries(statsFor([opponentTeam],[mirrorGame(g)]).map(r=>[r.id,r]));assert.equal(rows.opp0.oPoints,1);assert.equal(rows.opp0.initiated,1);assert.equal(rows.opp0.throwaways,1);assert.equal(statsFor([team],[mirrorGame(g)]).find(r=>r.id==='p0').dPoints,0);});
test('break detection follows the force from the thrower facing their attacking end zone',()=>{const point={direction:1},throwTo=(side,force,dx,dy,fromY=20)=>isBreak({side,force,from:{x:50,y:fromY},to:{x:50+dx,y:fromY+dy}},point,FIELD);
 // attacking +x on screen, the thrower's right (forehand side) is +y
 assert.equal(throwTo('us','forehand',5,-6),true);assert.equal(throwTo('us','forehand',5,6),false);assert.equal(throwTo('us','forehand',5,-0.5),false);assert.equal(throwTo('us','forehand',-1,-10),false);assert.equal(throwTo('us','forehand',0,-10),true);
 assert.equal(throwTo('us','backhand',5,6),true);assert.equal(throwTo('us','backhand',5,-6),false);
 // opponent attacks -x, so their right is -y
 assert.equal(throwTo('them','forehand',-5,6),true);assert.equal(throwTo('them','forehand',-5,-6),false);
 // middle: thrower near y=5 is forced toward +y, so breaking goes toward the near sideline
 assert.equal(throwTo('us','middle',5,-0.5,5),false);assert.equal(throwTo('us','middle',5,-1.5,10),true);assert.equal(throwTo('us','middle',5,10,10),false);assert.equal(throwTo('us','middle',5,-6,30),false);assert.equal(throwTo('us','middle',5,6,30),true);
 assert.equal(isBreak({side:'us',force:null,from:{x:50,y:20},to:{x:60,y:5}},point,FIELD),false);});
test('recomputeBreaks rewrites saved flags from the current definition',()=>{const g=make();g.field=FIELD;start(g);pickup(g,'us','p0');pass(g,{force:'forehand',break:false,from:{x:50,y:20},to:{x:55,y:18},opponentMarkerId:'o1'});pass(g,{force:'forehand',break:true,from:{x:55,y:18},to:{x:60,y:18.5},opponentMarkerId:'o1'});assert.equal(recomputeBreaks(g),true);const flags=g.events.filter(e=>e.type==='pass').map(e=>e.break);assert.deepEqual(flags,[true,false]);assert.equal(recomputeBreaks(g),false);});
test('breaks credit the thrower and charge the marker',()=>{const g=make();start(g);pickup(g,'us','p0');pass(g,{force:'forehand',break:true});pickup(g,'them',null);pass(g,{side:'them',throwerId:null,receiverId:null,markerId:'p3',force:'backhand',break:true});const s=stats(g);assert.equal(s.p0.breaks,1);assert.equal(s.p3.breaksAllowed,1);assert.equal(s.p1.breaks,0);});
test('pull distances run from the pulling goal line and the brick marks an out-of-bounds pull',()=>{const g=make();g.events.push(event('point_start',{line:team.players.map(p=>p.id),starting:'D',direction:1}));g.events.push(event('possession_start',{side:'them',playerId:null,pullerId:'p0',location:{x:70,y:30}}));
 // we pull attacking +x from x=20, so a pickup at x=70 is 50 yd deep and 10 yd off centre
 let s=stats(g);assert.equal(s.p0.pulls,1);assert.equal(s.p0.pullVertical,50);assert.equal(s.p0.pullHorizontal,10);assert.equal(s.p0.pullsOutOfBounds,0);
 const brick=pullMetrics({side:'them',location:{x:FIELD.length-FIELD.endzone-20,y:FIELD.width/2}},{direction:1},FIELD);assert.equal(brick.outOfBounds,true);
 g.events.push(event('point_end',{winner:'us'}));g.events.push(event('point_start',{line:team.players.map(p=>p.id),starting:'D',direction:-1}));g.events.push(event('possession_start',{side:'them',playerId:null,pullerId:'p0',location:{x:FIELD.endzone+20,y:FIELD.width/2}}));
 s=stats(g);assert.equal(s.p0.pulls,2);assert.equal(s.p0.pullsOutOfBounds,1);assert.equal(s.p0.pullVertical,50);});
test('substitutions do not rewrite the stored starting line',()=>{const g=make();start(g);g.events.push(event('substitution',{side:'us',outId:'p0',inId:'p9'}));const state=gameState(g);assert.ok(state.point.line.includes('p9'));assert.ok(g.events[0].line.includes('p0'));assert.ok(!g.events[0].line.includes('p9'));});
test('EDGE allowed charges the marker with the throw value and the receiver defender with the catch value',()=>{const g=make();start(g,'D');pickup(g,'them',null);
 // opponent attacks -x, so moving from x=60 to x=40 gains 20 yd for them
 pass(g,{side:'them',throwerId:null,receiverId:null,from:{x:60,y:20},to:{x:40,y:20},markerId:'p0',receiverDefenderId:'p1'});
 const rows=Object.fromEntries(advancedStatsFor(g,team).rows.map(r=>[r.id,r]));assert.ok(Math.abs(rows.p0.throwEdgeAllowed-.14)<1e-9);assert.ok(Math.abs(rows.p1.receiveEdgeAllowed-.14)<1e-9);assert.ok(Math.abs(rows.p1.edgeAllowed-.14)<1e-9);assert.equal(rows.p2.edgeAllowed,0);});
test('turnovers cost oSE and incomplete throws earn no yards',()=>{const g=make();start(g);pickup(g,'us','p0');pass(g,{throwerId:'p0',receiverId:'p1',from:{x:30,y:20},to:{x:60,y:20},outcome:'drop'});pickup(g,'us','p2');pass(g,{throwerId:'p2',receiverId:null,from:{x:30,y:20},to:{x:60,y:20},outcome:'throwaway'});pickup(g,'them',null);pass(g,{side:'them',throwerId:null,receiverId:null,from:{x:60,y:20},to:{x:40,y:20},outcome:'drop',markerId:'p3',receiverDefenderId:'p4'});
 const rows=Object.fromEntries(advancedStatsFor(g,team,.5).rows.map(r=>[r.id,r]));assert.equal(rows.p0.throwingEdge,0);assert.equal(rows.p1.receivingEdge,-.5);assert.equal(rows.p2.throwingEdge,-.5);assert.equal(rows.p3.throwEdgeAllowed,0);assert.equal(rows.p4.receiveEdgeAllowed,-.5);});
test('matchup breakdown groups offense by defender and defense by the guarded player',()=>{const g=make();start(g);pickup(g,'us','p0');
 pass(g,{throwerId:'p0',receiverId:'p1',to:{x:35,y:20},opponentMarkerId:'o1',opponentReceiverDefenderId:'o2'});
 pass(g,{throwerId:'p1',receiverId:'p0',from:{x:35,y:20},to:{x:35,y:30},outcome:'drop',opponentMarkerId:'o2',opponentReceiverDefenderId:'o1'});
 pickup(g,'them',null);pass(g,{side:'them',throwerId:'o3',receiverId:'o4',from:{x:35,y:30},to:{x:25,y:30},markerId:'p0',receiverDefenderId:'p1'});
 pass(g,{side:'them',throwerId:'o4',receiverId:'o3',from:{x:25,y:30},to:{x:20,y:30},outcome:'block',markerId:'p2',receiverDefenderId:'p0',blockerId:'p0'});
 const {offense,defense}=matchupBreakdown(g,'p0','us',.5),byOpponent=rows=>Object.fromEntries(rows.map(row=>[row.opponentId,row]));
 assert.equal(byOpponent(offense).o1.throws,1);assert.equal(byOpponent(offense).o1.throwGain,10);assert.equal(byOpponent(offense).o1.drops,1);assert.ok(Math.abs(byOpponent(offense).o1.edge-(.07-.5))<1e-9);
 assert.equal(byOpponent(defense).o3.throwsMarked,1);assert.equal(byOpponent(defense).o3.throwGainAllowed,10);assert.equal(byOpponent(defense).o3.targets,1);assert.equal(byOpponent(defense).o3.blocks,1);assert.equal(byOpponent(offense).o1.points,1);assert.ok(Math.abs(byOpponent(offense).o1.edgePerPoint-(.07-.5))<1e-9);assert.equal(byOpponent(defense).o3.throwaways,0);});

test('matchups: coverage counts O and D points against assigned ones, and an assignment with no passes still shows in the breakdown',()=>{
 const g=make();g.opponents=[{id:'opp0',name:'Opp 0',number:'0'},{id:'opp1',name:'Opp 1',number:'1'}];
 // point 1: start O, we hold, p0 matched with opp0 but no passes recorded
 g.events.push(event('point_start',{line:['p0','p1'],opponentLine:['opp0','opp1'],starting:'O',direction:1,matchups:[['p0','opp0']]}));pickup(g,'us','p0');pass(g,{outcome:'goal'});
 // point 2: start D, they turn it over to us (O for us), p1 marked by opp1 only through a recorded marker
 g.events.push(event('point_start',{line:['p0','p1'],opponentLine:['opp0','opp1'],starting:'D',direction:-1}));pickup(g,'them','opp0');pass(g,{side:'them',throwerId:'opp0',receiverId:'opp1',outcome:'throwaway',markerId:'p1'});
 const coverage=new Map([...matchupCoverage(g)].map(([id,{offenseMissing,defenseMissing,...counts}])=>[id,counts]));
 assert.deepEqual(coverage.get('p0'),{offensePoints:2,offenseAssigned:1,defensePoints:1,defenseAssigned:0});
 assert.deepEqual(coverage.get('p1'),{offensePoints:2,offenseAssigned:1,defensePoints:1,defenseAssigned:1});
 assert.deepEqual(coverage.get('opp0'),{offensePoints:1,offenseAssigned:1,defensePoints:2,defenseAssigned:2});assert.deepEqual(coverage.get('opp1'),{offensePoints:1,offenseAssigned:0,defensePoints:2,defenseAssigned:0});
 assert.deepEqual(matchupCoverage(g).get('p0').offenseMissing,[2]);assert.deepEqual(matchupCoverage(g).get('p0').defenseMissing,[2]);
 const {offense,defense}=matchupBreakdown(g,'p0','us',.56);
 assert.equal(offense.find(row=>row.opponentId==='opp0').points,1);assert.equal(offense.find(row=>row.opponentId==='opp0').throws,0);
 assert.equal(defense.find(row=>row.opponentId==='opp0'),undefined);assert.equal(matchupBreakdown(g,'p1','us',.56).defense.find(row=>row.opponentId==='opp0').points,1);
 const mirrored=matchupBreakdown(mirrorGame(g),'opp0','us',.56);assert.equal(mirrored.defense.find(row=>row.opponentId==='p0').points,1);
});
test('matchups: explicit list wins, [id,null] suppresses a recorded marker',()=>{
 const g=make();g.opponents=[{id:'opp0',name:'Opp 0',number:'0'},{id:'opp1',name:'Opp 1',number:'1'}];
 g.events.push(event('point_start',{line:['p0','p1'],opponentLine:['opp0','opp1'],starting:'O',direction:1,matchups:[['p0','opp1'],['p1',null]]}));pickup(g,'us','p0');g.events.at(-1).opponentMarkerId='opp0';pass(g,{receiverId:'p1',opponentReceiverDefenderId:'opp1'});
 assert.deepEqual(pointMatchups(pointsOf(g)[0]),[['p0','opp1']]);
});

const fixture=async()=>JSON.parse(await readFile(new URL('./fixtures/polar-bears-2026-10-06.json',import.meta.url)));
test('unguarded: unmarked first throws and the throws that follow an unguarded marker are attributed to unguarded, once',async()=>{
 const g=make();g.opponents=[{id:'opp0',name:'Opp 0',number:'0'}];
 start(g);pickup(g,'us','p0');pass(g,{});pass(g,{throwerId:'p1',receiverId:'p2'});pass(g,{throwerId:'p2',receiverId:'p3',opponentMarkerId:'opp0'});pass(g,{throwerId:'p3',receiverId:'p4'});
 assert.equal(applyUnguarded(g),true);
 const markers=g.events.filter(e=>e.type==='pass').map(e=>e.opponentMarkerId);
 assert.deepEqual(markers,[UNGUARDED,UNGUARDED,'opp0',undefined]);
 assert.deepEqual(g.events.filter(e=>e.type==='pass').map(e=>e.opponentReceiverDefenderId),[UNGUARDED,UNGUARDED,undefined,undefined]);
 assert.equal(applyUnguarded(g),false);
 assert.equal(statsFor([team],[g]).some(row=>row.id===UNGUARDED),false);
 const {offense}=matchupBreakdown(g,'p0','us',.56);assert.equal(offense.find(row=>row.opponentId===UNGUARDED).throws,1);
});
test('unguarded: games without a known defending roster are left alone',()=>{
 const g=make();start(g);pickup(g,'us','p0');pass(g,{});
 applyUnguarded(g);assert.equal(g.events.at(-1).opponentMarkerId,undefined);
});
test('fixture game (Polar Bears) migrates and stays consistent',async()=>{
 const data=await fixture();validateData(data);const game=data.games[0];
 const unmarked=side=>game.events.filter(e=>e.type==='pass'&&e.side===side&&!(e.markerId||e.opponentMarkerId)).length;
 const before={us:unmarked('us'),them:unmarked('them')};
 assert.ok(before.us>0&&before.them>0);
 assert.equal(applyUnguarded(game),true);
 const after={us:unmarked('us'),them:unmarked('them')};
 assert.ok(after.us<before.us&&after.them<before.them);
 const unguarded=game.events.filter(e=>e.type==='pass'&&(e.markerId===UNGUARDED||e.opponentMarkerId===UNGUARDED));
 assert.equal(unguarded.length,before.us+before.them-after.us-after.them);
 assert.equal(statsFor(data.teams,[game]).some(row=>row.id===UNGUARDED),false);
 for(const row of matchupCoverage(game).values())assert.ok(row.offenseAssigned<=row.offensePoints&&row.defenseAssigned<=row.defensePoints);
});

test('unknown matchup: counts as assigned, lands in the Unknown row with its point numbers, and beats a recorded marker',()=>{
 const g=make();g.opponents=[{id:'opp0',name:'Opp 0',number:'0'}];
 start(g);pickup(g,'us','p0');g.events.at(-1).opponentMarkerId='opp0';pass(g,{outcome:'goal',opponentMarkerId:'opp0'});
 g.events.push(event('point_start',{line:['p0'],opponentLine:['opp0'],starting:'O',direction:1,matchups:[['p0',UNKNOWN_MATCHUP]]}));pickup(g,'us','p0');pass(g,{outcome:'goal'});
 assert.deepEqual(pointMatchups(pointsOf(g)[1]),[['p0',UNKNOWN_MATCHUP]]);
 assert.deepEqual(matchupCoverage(g).get('p0').offenseMissing,[]);
 const unknown=matchupBreakdown(g,'p0','us',.56).offense.find(row=>row.opponentId===null);
 assert.deepEqual(unknown.pointNumbers,[2]);
});

test('unguarded: a game converted under the first version only gains the receiver-defender propagation',()=>{
 const g=make();g.opponents=[{id:'opp0',name:'Opp 0',number:'0'}];g.unguardedApplied=true;
 start(g);pickup(g,'us','p0');pass(g,{opponentMarkerId:UNGUARDED});pass(g,{throwerId:'p1',receiverId:'p2'});pass(g,{throwerId:'p2',receiverId:'p3',opponentMarkerId:'opp0'});
 assert.equal(applyUnguarded(g),true);
 const passes=g.events.filter(e=>e.type==='pass');
 assert.deepEqual(passes.map(e=>e.opponentMarkerId),[UNGUARDED,UNGUARDED,'opp0']);
 assert.deepEqual(passes.map(e=>e.opponentReceiverDefenderId),[UNGUARDED,UNGUARDED,undefined]);
 assert.equal(g.unguardedApplied,UNGUARDED_VERSION);
 const fresh=make();fresh.opponents=g.opponents;start(fresh);pickup(fresh,'us','p0');pass(fresh,{});fresh.unguardedApplied=UNGUARDED_VERSION;
 assert.equal(applyUnguarded(fresh),false);assert.equal(fresh.events.at(-1).opponentMarkerId,undefined);
});
test('a game against a library team belongs to both teams and counts once in the all-games list',()=>{const opponentTeam={id:'o',name:'Opp',players:Array.from({length:7},(_,i)=>({id:'q'+i,name:'Opp '+i,number:String(i)}))};const g={...make(),opponentTeamId:'o',opponent:'Opp',opponents:opponentTeam.players};g.events.push(event('point_start',{line:team.players.map(p=>p.id),opponentLine:opponentTeam.players.map(p=>p.id),starting:'D',direction:1}));pickup(g,'them','q0');pass(g,{side:'them',throwerId:'q0',receiverId:'q1',from:{x:80,y:20},to:{x:10,y:20},outcome:'goal'});
 const data={teams:[team,opponentTeam],games:[g]};
 assert.equal(gamesForTeam(data,'t').length,1);const [mirrored]=gamesForTeam(data,'o');assert.equal(mirrored.teamId,'o');assert.equal(mirrored.opponentTeamId,'t');assert.equal(mirrored.opponent,'Team');assert.deepEqual(gameState(mirrored).score,[1,0]);
 const opponentStats=Object.fromEntries(statsFor([opponentTeam],[mirrored]).map(p=>[p.id,p]));assert.equal(opponentStats.q1.goals,1);assert.equal(opponentStats.q0.assists,1);assert.equal(opponentStats.q0.points,1);
 assert.equal(gamesFromEverySide(data).length,2);assert.equal(gamesForTeam({teams:[team],games:[g]},'o').length,0);});

test('an unattributed goal ends the point and removes it from throws per possession and EDGE',()=>{
 const build=withExcluded=>{const g=make();start(g);pickup(g,'us','p0');pass(g,{});pass(g,{throwerId:'p1',receiverId:'p2',outcome:'goal'});
  if(withExcluded){start(g);pickup(g,'us','p0');pass(g,{});pass(g,{throwerId:'p1',receiverId:'p2',outcome:'throwaway'});g.events.push(event('unattributed_goal',{side:'them',location:null}));}return g;};
 const base=build(false),extra=build(true),points=pointsOf(extra);
 assert.equal(points.at(-1).winner,'them');assert.equal(gameState(extra).active,false);
 assert.deepEqual(throwsPerPossession([extra]),throwsPerPossession([base]));
 const rowsOf=g=>Object.fromEntries(advancedStatsFor(g,team).rows.map(r=>[r.id,r]));
 for(const id of ['p0','p1','p2']){assert.equal(rowsOf(extra)[id].totalEdge,rowsOf(base)[id].totalEdge);assert.equal(rowsOf(extra)[id].opportunities,rowsOf(base)[id].opportunities);}
 const edgeOf=g=>matchupBreakdown(g,'p1','us',.56).offense.reduce((total,row)=>total+row.edge,0);
 assert.equal(edgeOf(extra),edgeOf(base));
 validateData({...emptyData(),teams:[team],games:[extra]});
});

test('a throw with an unguarded marker is never a break, and saved break flags on such throws are cleared',()=>{const point={direction:1},throwPass=(side,marker)=>({side,force:'forehand',from:{x:50,y:20},to:{x:60,y:5},[side==='us'?'opponentMarkerId':'markerId']:marker});
 assert.equal(isBreak(throwPass('us','o1'),point,FIELD),true);assert.equal(isBreak(throwPass('us',UNGUARDED),point,FIELD),false);assert.equal(isBreak(throwPass('them',UNGUARDED),{direction:-1},FIELD),false);
 const g=make();g.unguardedApplied=UNGUARDED_VERSION;start(g);pickup(g,'us','p0');pass(g,{force:'forehand',break:true,opponentMarkerId:UNGUARDED});pass(g,{throwerId:'p1',receiverId:'p2',force:'forehand',break:true,opponentMarkerId:'o1'});
 assert.equal(applyUnguarded(g),true);const passes=g.events.filter(e=>e.type==='pass');assert.equal(passes[0].break,false);assert.equal(passes[1].break,true);assert.equal(applyUnguarded(g),false);
 assert.equal(stats(g).p0.breaks,0);assert.equal(stats(g).p1.breaks,1);});
test('group on/off hold rates need at least five group members on the field',()=>{
 const g=make(),line=ids=>g.events.push(event('point_start',{line:ids,starting:'O',direction:1})),end=winner=>g.events.push(event('point_end',{winner})),startD=ids=>g.events.push(event('point_start',{line:ids,starting:'D',direction:1}));
 const group={id:'grp',name:'Core',playerIds:['p0','p1','p2','p3','p4','p5']};
 line(['p0','p1','p2','p3','p4','p5','p6']);end('us');
 startD(['p0','p1','p2','p3','p4','p5','p6']);end('them');
 line(['p1','p2','p3','p4','p5','p6','x']);end('us');
 startD(['p1','p2','p3','p4','p5','p6','x']);end('us');
 line(['p0','p1','p2','p6','x','y','z']);end('us');
 const [result]=groupOnOffStats([g],{...team,groups:[group]},'p0').groups;
 assert.deepEqual(result.on,{points:2,oPoints:1,holds:1,dPoints:1,opponentHolds:1});
 assert.deepEqual(result.off,{points:2,oPoints:1,holds:1,dPoints:1,opponentHolds:0});
 assert.deepEqual(groupOnOffStats([g],{...team,groups:[group]},'p6').groups,[]);
});
test('a point ended by an unattributed goal still counts toward opp scored % and group hold rates',()=>{
 const g=make();start(g,'D');g.events.push(event('unattributed_goal',{side:'them',location:null}));
 const row=advancedStatsFor(g,team).rows.find(r=>r.id==='p0');
 assert.equal(row.defenseOpportunities,1);assert.equal(row.opponentScoredRateFromD,1);
 const [result]=groupOnOffStats([g],{...team,groups:[{id:'x',name:'All',playerIds:team.players.map(p=>p.id)}]},'p0').groups;
 assert.deepEqual(result.on,{points:1,oPoints:0,holds:0,dPoints:1,opponentHolds:1});
});
test('group total counts a point once even when it qualifies for several groups',()=>{
 const g=make();start(g,'O');g.events.push(event('point_end',{winner:'us'}));
 const ids=team.players.map(p=>p.id),groups=[{id:'a',name:'A',playerIds:ids.slice(0,6)},{id:'b',name:'B',playerIds:ids.slice(1,7).concat('p0')}];
 const {groups:rows,total}=groupOnOffStats([g],{...team,groups},'p0');
 assert.equal(rows.length,2);assert.equal(rows[0].on.points,1);assert.equal(rows[1].on.points,1);
 assert.deepEqual(total.on,{points:1,oPoints:1,holds:1,dPoints:0,opponentHolds:0});
});
test('other row: points outside every group where a 5-player set played with and without the player',()=>{
 const g=make(),ids=team.players.map(p=>p.id),line=(list,winner)=>{g.events.push(event('point_start',{line:list,starting:'O',direction:1}));g.events.push(event('point_end',{winner}));};
 line(['p0','p1','p2','p3','p4','p5','p6'],'us');
 line(['p1','p2','p3','p4','p5','x','y'],'us');
 line(['p0','p1','a','b','c','d','e'],'us');
 const {other,groups,total}=groupOnOffStats([g],{...team,groups:[]},'p0');
 assert.equal(groups.length,0);
 assert.equal(other.on.points,1);assert.equal(other.off.points,1);assert.deepEqual(total.on,other.on);assert.deepEqual(total.off,other.off);
});
