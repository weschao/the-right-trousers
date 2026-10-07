import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {matchedOnOffStats,STAT_COLUMNS} from '../web/core.js';
import {adjustedDataset,adjustedRatings} from '../web/adjusted.js';
import {adjustedCell,adjustedSummary} from '../web/adjusted-view.js';

const source=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
const helper=source.slice(source.indexOf('function matchedRateHelp('),source.indexOf('function statsTable('));
const detail=source.slice(source.indexOf('function seasonPlayerDetail('),source.indexOf('// inserts an empty point'));
const table=source.slice(source.indexOf('function statsTable('),source.indexOf('function statsPage('));
const team={id:'t',players:Array.from({length:8},(_,i)=>({id:`p${i}`,name:`Player ${i}`})),groups:[]};
const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const model=games=>({status:'ready',result:adjustedRatings(adjustedDataset(games,team))});
function renderDetail(games){
 let html;
 const context={$:()=>({querySelectorAll:()=>[]}),adjustedPlayerPanel:(games,t,id)=>adjustedSummary(model(games),id,()=>"Player"),data:{teams:[team]},relevantGames:()=>games,matchupBreakdown:()=>({offense:[],defense:[]}),gameOse:()=>.5,matchedOnOffStats,esc,playerName:()=>team.players[0].name,renderBreakdown:()=>'',OFFENSE_BREAKDOWN_HELP:'',DEFENSE_BREAKDOWN_HELP:'',OFFENSE_BREAKDOWN_COLUMNS:[],DEFENSE_BREAKDOWN_COLUMNS:[],modal:(_title,body)=>{html=body;}};
 vm.runInNewContext(helper+detail+"\nseasonPlayerDetail('p0');",context);
 return html;
}
function renderSeason(games){
 const row={id:'p0',name:'Player 0',number:'0',points:12},context={huckYards:35,secondaryEdgeSettings:()=>({}),STAT_COLUMNS,statsFor:()=>[row],advancedStatsFor:()=>({rows:[row]}),seasonAdvancedForTeams:()=>[row],gameOse:()=>.5,matchedOnOffStats,statsSort:'name',statsDesc:false,outlierHighlight:false,teamAdjusted:games=>model(games),adjustedCell,fmt:v=>String(v??0),fixedFmt:(v,d)=>Number(v??0).toFixed(d),esc,genderClass:()=>'',games,team};
 return vm.runInNewContext(helper+table+"\nstatsTable(games,[team],{advanced:true,breakdownTable:'season'});",context);
}
function oneMatchedGame(){
 const game={teamId:'t',events:[]},on=team.players.slice(0,7).map(p=>p.id),off=['p7',...on.slice(1)];
 for(const [line,winner] of [[on,'us'],[off,'them']])game.events.push({type:'point_start',line,starting:'O'},{type:'point_end',winner});
 return game;
}

test('player detail retains collapsed matching support alongside adjusted intervals',()=>{
 const html=renderDetail([oneMatchedGame()]);
 assert.equal((html.match(/O coverage/g)||[]).length,3);
 assert.match(html,/100\.0% \(1\/1\)/);assert.match(html,/1\.0 \/ 1<br><small>1 game · 1 matched on-points/);
 assert.match(html,/\+100\.0/);assert.match(html,/same game/);assert.match(html,/effective \/ distinct/);
 assert.match(html,/— \(0\/0\)/);assert.match(html,/not a confidence interval/);
 assert.equal((html.match(/data-matched-coverage hidden/g)||[]).length,3);
 assert.match(html,/Approx. 95% credible interval/);assert.match(html,/Prior sensitivity/);assert.match(html,/Prediction check unavailable/);
 assert.match(html,/data-matched-tooltip/);assert.doesNotMatch(html,/season values require more than 10/);
});

test('player detail reports zero coverage when matches exist only across games',()=>{
 const game=oneMatchedGame(),games=[{teamId:'t',events:game.events.slice(0,2)},{teamId:'t',events:game.events.slice(2)}];
 const html=renderDetail(games);
 assert.equal((html.match(/No matched points in the same game/g)||[]).length,3);
 assert.match(html,/0\.0% \(0\/1\)/);assert.match(html,/0\.0 \/ 0<br><small>0 games · 0 matched on-points/);
});

test('season cells show adjusted ratings for small samples and no custom tooltip',()=>{
 const games=[oneMatchedGame()],html=renderSeason(games),expected=adjustedCell(model(games),'hold','p0');
 assert.ok(html.includes(`>${expected}</td>`));assert.match(html,/data-adjusted-side="hold"/);
 assert.doesNotMatch(html,/data-matched-tooltip|title="Coverage:/);
 assert.match(html,/Adjusted hold/);assert.match(html,/95% intervals/);
 assert.doesNotMatch(html,/too small an effective sample/);
});

test('unidentifiable season effects remain unavailable rather than reporting a prior-only zero',()=>{
 const g=oneMatchedGame();g.events=g.events.slice(0,2);const html=renderSeason([g]);
 assert.match(html,/data-breakdown-table="season"[^>]*>—<\/td>/);
 const detail=renderDetail([g]);assert.match(detail,/cannot be estimated separately/);
});

test('pending calculations and model failures have explicit detail messages',()=>{
 assert.match(adjustedCell({status:'pending'},'hold','p0'),/Calculating adjusted rating/);
 assert.match(adjustedSummary({status:'pending'},'p0',()=>''),/role="status"/);
 assert.match(adjustedSummary({status:'error',error:'Fit <failed>'},'p0',()=>''),/Fit &lt;failed&gt;/);
});
