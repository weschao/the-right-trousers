import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as core from '../web/core.js';
import {playerProjection} from '../web/player-projection.js';

const key='edgeAllowedPerPointPlusMinusNoMarkedThrowaways'; // Keep saved column selections compatible.
const source=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
const extract=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const functions=[['function defenseEdgeComparisons','// rows past the first screenful'],['function pointAdvancedRows','function gameOse'],['function seasonMatchupTables','// inserts an empty point']].map(([a,b])=>extract(a,b)).join('\n');
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-12,`${actual} != ${expected}`);
function fixture(includeSecondary=false){
 const teams=[{id:'a',name:'Us',players:[{id:'a',name:'Defender'},{id:'b',name:'Other defender'}]},{id:'o',name:'Opponents',players:[{id:'x',name:'Opponent'},{id:'y',name:'Other opponent'}]}];
 const point=(id,gain,guarded,outcome)=>[
  {id,type:'point_start',line:['a','b'],opponentLine:['x','y'],starting:'D',direction:1,matchups:[['x',guarded?'a':'b']]},
  {type:'possession_start',side:'them',playerId:'x',location:{x:80,y:20}},
  {type:'pass',side:'them',throwerId:'x',receiverId:'y',markerId:guarded?'a':'b',receiverDefenderId:'b',outcome:'complete',from:{x:80,y:20},to:{x:80-gain,y:20}},
  {type:'pass',side:'them',throwerId:'y',receiverId:'x',markerId:'b',receiverDefenderId:'b',outcome:'complete',from:{x:80-gain,y:20},to:{x:80-2*gain,y:20}},
  {type:'pass',side:'them',throwerId:'x',receiverId:'y',markerId:'b',receiverDefenderId:'b',outcome,from:{x:80-2*gain,y:20},to:{x:20,y:20}},
  {type:'possession_start',side:'us',playerId:'b',location:{x:20,y:20}},
  {type:'possession_start',side:'them',playerId:'y',location:{x:80,y:20}},
  {type:'pass',side:'them',throwerId:'y',receiverId:'x',markerId:'b',receiverDefenderId:'b',outcome:'drop',from:{x:80,y:20},to:{x:60,y:20}},
  {type:'point_end',winner:'us'}];
 const game=(id,events)=>({id,teamId:'a',opponentTeamId:'o',opponent:'Opponents',field:core.FIELD,opponents:teams[1].players,events:events.map((event,index)=>({id:`${id}-${index}`,...event}))});
 return {...core.emptyData(),teams,settings:{secondaryPreviousShare:.3,secondaryPreviousPreviousShare:.1,includeSecondaryInTotal:includeSecondary},games:[game('g1',[...point('p1',10,true,'throwaway'),...point('p2',20,false,'block')]),game('g2',[...point('p3',30,true,'stall'),...point('p4',40,false,'throwaway')])]};
}
function app(library){
 const settings=library.settings,captured=[],context=vm.createContext({...core,data:library,matchupBreakdownCache:new Map(),pointAdvancedCache:new Map(),minEappmOpportunities:null,secondaryEdgeSettings:()=>({previousShare:.3,previousPreviousShare:.1,includeInTotal:settings.includeSecondaryInTotal}),gameOse:()=>.56,relevantGames:()=>library.games.filter(g=>g.teamId==='a'),seasonAdvancedStats:()=>[{id:'a',totalEdgePerPoint:0}],OFFENSE_BREAKDOWN_HELP:'',DEFENSE_BREAKDOWN_HELP:'',SEASON_OFFENSE_BREAKDOWN_COLUMNS:[],DEFENSE_BREAKDOWN_COLUMNS:[],renderBreakdown:rows=>{captured.push(rows);return '';}});
 vm.runInContext(functions,context);return {context,captured,run:code=>vm.runInContext(code,context)};
}
for(const secondary of [false,true])test(`EAPpm xTA uses the same guarded matchup attribution as standard EAPpm (secondary ${secondary})`,()=>{
 const library=fixture(secondary),before=structuredClone(library),{run,captured}=app(library),factor=.014*(secondary?1.3:1);
 // Each point: throwing + receiving gain, optional secondary completion credit, and a retained drop cost.
 const comparison=run("defenseEdgeComparisons(data.games[0],'a',.56)").find(row=>row.opponentId==='x');
 near(comparison.baselineEdgeNoThrowaways,factor*(20+30+40)-3*.56);
 near(comparison.edgeAllowedNoThrowaways,.007*10);
 assert.ok(comparison.baselineEdgeNoThrowaways>=comparison.baselineEdge);
 assert.ok(comparison[key]>=comparison.edgeAllowedPerPointPlusMinus);
 assert.equal(comparison.baselineOpportunities,3);assert.equal(comparison.points,1);
 near(comparison[key],factor*30-.56-.007*10);
 // Both guarded games must be excluded from the season baseline, and the baseline must not be added twice.
 run("seasonMatchupTables('a')");const season=captured[1].find(row=>row.opponentId==='x');
 near(season.baselineEdgeNoThrowaways,factor*(20+40)-2*.56);assert.equal(season.baselineOpportunities,2);assert.equal(season.points,2);
 near(season.edgeAllowedNoThrowaways,.007*(10+30));
 near(season[key],factor*30-.56-.007*20);
 near(run("totalDefenseEdgeComparison(data.games,'a',data.teams[0]).noMarkedThrowaways"),(factor*30-.56-.007*20)*2);
 const projected=playerProjection(library,'a','a').matchups.defense.find(row=>row.opponentId==='x');near(projected[key],factor*30-.56-.007*20);
 const selected=playerProjection(library,'a','a',{gameIds:['g1']}).matchups.defense.find(row=>row.opponentId==='x');near(selected[key],factor*30-.56-.007*10);
 run('minEappmOpportunities=3');assert.equal(run("totalDefenseEdgeComparison(data.games,'a',data.teams[0]).noMarkedThrowaways"),0);
 assert.deepEqual(library,before);
});
test('xTA baseline includes games recorded from the opponent’s own side',()=>{
 const library=fixture(),own=core.mirrorGame(library.games[1]);own.id='opponent-own';own.teamId='o';own.opponentTeamId='a';own.opponents=library.teams[0].players;own.opponent='Us';library.games=[library.games[0],own];
 const {run}=app(library),row=run("defenseEdgeComparisons(data.games[0],'a',.56)").find(row=>row.opponentId==='x');
 near(row[key],.014*30-.56-.007*10);near(playerProjection(library,'a','a',{gameIds:['g1']}).matchups.defense.find(row=>row.opponentId==='x')[key],row[key]);
});
test('xTA has no comparison without unguarded offensive opportunities',()=>{
 const library=fixture();library.games=[{...library.games[0],events:library.games[0].events.slice(0,9)}];
 const {run}=app(library),row=run("defenseEdgeComparisons(data.games[0],'a',.56)").find(row=>row.opponentId==='x');
 assert.equal(row[key],null);assert.equal(playerProjection(library,'a','a').matchups.defense.find(row=>row.opponentId==='x')[key],null);
});

test('Kyle–Crawford keeps the 0.090866 matchup EDGE instead of Crawford’s 0.378251 full-point EDGE',async()=>{
 const library=JSON.parse(await readFile(new URL('./fixtures/polar-bears-2026-10-06.json',import.meta.url),'utf8'));
 const team=library.teams.find(t=>t.name==='Mischief 2026'),kyle=team.players.find(p=>p.name==='Kyle'),crawford=library.games[0].opponents.find(p=>p.name==='Crawford'),{run}=app(library);
 const row=run(`defenseEdgeComparisons(data.games[0],${JSON.stringify(kyle.id)},.56)`).find(row=>row.opponentId===crawford.id);
 assert.equal(row.points,1);near(row.edgeAllowed,.09086589813232422);near(row.edgeAllowedNoThrowaways,row.edgeAllowed);
 const pointRows=core.pointEdgeRows(core.mirrorGame(library.games[0]),[crawford.id],.56),point=pointRows[row.pointNumbers[0]-1].get(crawford.id);
 near(point.throwingEdge+point.receivingEdge,.3782510204315186);
 assert.ok(row.baselineEdgeNoThrowaways>=row.baselineEdge);
 near(row[key]-row.edgeAllowedPerPointPlusMinus,(row.baselineEdgeNoThrowaways-row.baselineEdge)/row.baselineOpportunities);
 const projected=playerProjection(library,team.id,kyle.id).matchups.defense.find(row=>row.opponentId===crawford.id);
 near(projected.edgeAllowedNoThrowaways,projected.edgeAllowed);
 assert.ok(projected[key]>=projected.edgeAllowedPerPointPlusMinus);
});

test('xTA removes marked throwaways, stalls and blocks, retaining receiver drops and excluding unattributed points',()=>{
 for(const outcome of ['throwaway','stall','block']){
  const library=fixture(),game=library.games[0];
  game.events.find(e=>e.type==='pass'&&e.outcome==='throwaway').markerId='a';
  game.events.find(e=>e.type==='pass'&&e.outcome==='throwaway').outcome=outcome;
  game.events.find(e=>e.type==='pass'&&e.outcome==='drop').receiverDefenderId='a';
  const row=core.matchupBreakdown(game,'a','us',.56).defense.find(r=>r.opponentId==='x');
  near(row.edgeAllowed,.007*10-2*.56);near(row.edgeAllowedNoThrowaways,.007*10-.56);
  const mirrored=core.matchupBreakdown(core.mirrorGame(game),'a','them',.56).defense.find(r=>r.opponentId==='x');
  near(mirrored.edgeAllowedNoThrowaways,row.edgeAllowedNoThrowaways);
  game.events.splice(8,0,{id:'unattributed',type:'unattributed_goal',side:'us'});
  const excluded=core.matchupBreakdown(game,'a','us',.56).defense.find(r=>r.opponentId==='x');
  assert.equal(excluded.edgeAllowedNoThrowaways,0);
 }
});

test('EAPpm per-point denominators count distinct eligible game points, including zero-valued contributions',()=>{
 const library=fixture(),first=library.games[0];
 // Guard a second opponent on p1: this adds to the total, but p1 remains one denominator point.
 first.events.find(e=>e.throwerId==='y'&&e.outcome==='complete').markerId='a';
 // The z matchup occurs only on p2, so it has no baseline and cannot contribute a denominator point.
 first.opponents.push({id:'z',name:'No baseline'});
 const p2=first.events.find(e=>e.id==='p2');p2.opponentLine.push('z');p2.matchups.push(['z','a']);
 // An unknown opponent on p4 likewise contributes neither numerator nor denominator.
 library.games[1].events.splice(-1,0,{id:'unknown-pass',type:'pass',side:'them',throwerId:null,receiverId:null,markerId:'a',outcome:'complete',from:{x:80,y:20},to:{x:70,y:20}});
 const {run}=app(library),comparison=()=>run("totalDefenseEdgeComparison(data.games,'a',data.teams[0])"),total=comparison();
 assert.equal(total.points,2);near(total.standardPerPoint,total.standard/2);near(total.noMarkedThrowawaysPerPoint,total.noMarkedThrowaways/2);
 run('minEappmOpportunities=3');const filtered=comparison();
 assert.equal(filtered.points,1);near(filtered.standardPerPoint,filtered.standard);near(filtered.noMarkedThrowawaysPerPoint,filtered.noMarkedThrowaways);
 run('minEappmOpportunities=4');const empty=comparison();
 assert.equal(empty.points,0);assert.equal(empty.standardPerPoint,null);assert.equal(empty.noMarkedThrowawaysPerPoint,null);
 const {run:zero}=app(fixture());zero("data.games.forEach(g=>g.events.forEach(e=>{if(e.type==='pass'){e.outcome='complete';e.to={...e.from};}}));pointAdvancedCache.clear();matchupBreakdownCache.clear();");
 const zeroTotal=zero("totalDefenseEdgeComparison(data.games,'a',data.teams[0])");
 assert.equal(zeroTotal.points,2);assert.equal(zeroTotal.standardPerPoint,0);assert.equal(zeroTotal.noMarkedThrowawaysPerPoint,0);
});

test('Player Stats renders both EAPpm per-point columns and recomputes selected/all-game comparisons',()=>{
 const library=fixture(),{context,run}=app(library),standardKey='edgeAllowedPerPointPlusMinusPerPoint',xtaKey=key+'PerPoint';
 Object.assign(context,{throwawayTables:[],huckYards:35,statsSort:'name',statsDesc:false,minTouches:null,minThrowsPerPoint:null,minHucks:null,comparedStatColumns:[standardKey,xtaKey],DRILLDOWN_STATS:[],esc:String,fmt:String,fixedFmt:(value,digits)=>(Number(value)||0).toFixed(digits),genderClass:()=>'',seasonAdvancedForTeams:(games,teams)=>core.statsFor(teams,games)});
 run(extract('const FIRST_PAINT_ROWS=','function statsPage()'));
 const selected=run("totalDefenseEdgeComparison([data.games[0]],'a',data.teams[0])"),all=run("totalDefenseEdgeComparison(data.games,'a',data.teams[0])");
 const html=run("statsTable([data.games[0]],[data.teams[0]],{advanced:true,allGames:data.games})"),row=html.match(/<tbody><tr>(.*?)<\/tr>/s)[1],cells=[...row.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map(m=>m[1]);
 assert.ok(html.includes(`data-sort="${standardKey}"`));assert.ok(html.includes(`data-sort="${xtaKey}"`));assert.ok(html.includes('EAPpm/pt'));assert.ok(html.includes('EAPpm<br>xTA/pt'));
 for(const property of ['standardPerPoint','noMarkedThrowawaysPerPoint']){const values=[selected[property].toFixed(3),all[property].toFixed(3),(selected[property]-all[property]).toFixed(3)];if(selected[property]-all[property]>0)values[2]='+'+values[2];assert.ok(cells.join('|').includes(values.join('|')),values.join('|'));}
 run('minEappmOpportunities=999');const empty=run("statsTable([data.games[0]],[data.teams[0]],{advanced:true})");
 const emptyCells=[...empty.match(/<tbody><tr>(.*?)<\/tr>/s)[1].matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map(m=>m[1]);
 assert.equal(emptyCells.filter(value=>value==='—').length>=2,true);
});
