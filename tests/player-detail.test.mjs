import test from 'node:test';
import assert from 'node:assert/strict';
import {statsFor,FIELD,opponentPerspective} from '../web/core.js';
import {playerOccurrences,connectionStats} from '../web/player-detail.js';
import {timestampLink,linkTimestamp,pointVideos} from '../web/video.js';
const teams=[{id:'a',name:'Us',players:[{id:'ann',name:'Ann'},{id:'bo',name:'Bo'}]},{id:'b',name:'Them',players:[{id:'opp',name:'Opp'}]}];
const pass=(id,outcome,throwerId,receiverId,to={x:30,y:20},side='us')=>({id,type:'pass',side,throwerId,receiverId,outcome,from:{x:20,y:20},to});
const make=()=>({id:'g',teamId:'a',opponentTeamId:'b',opponent:'Them',field:FIELD,opponents:teams[1].players,finished:true,videoLink:'https://app.veo.co/matches/x/',videoTimestamps:'1:00\n2:00',events:[
 {id:'p1',type:'point_start',line:['ann','bo'],opponentLine:['opp'],starting:'O',direction:1},
 pass('huck-complete','complete','ann','bo',{x:70,y:20}),pass('huck-lost','throwaway','ann','bo',{x:70,y:20}),pass('drop','drop','bo','ann'),pass('goal','goal','ann','bo',{x:105,y:20}),{type:'point_end',winner:'us'},
 {id:'p2',type:'point_start',line:['ann'],opponentLine:['opp'],starting:'D',direction:-1},
 {id:'block',type:'turnover',side:'them',reason:'block',blockerId:'ann'},{id:'stall',type:'turnover',side:'us',reason:'stall',playerId:'ann'},{type:'point_end',winner:'them'}]});
test('occurrence counts equal statsFor and rows carry point score',()=>{const game=make(),o=playerOccurrences([game],'ann'),row=statsFor(teams,[game]).find(r=>r.id==='ann');
 assert.equal(o.oPoints.length,row.oPoints);assert.equal(o.dPoints.length,row.dPoints);assert.equal(o.goals.length,row.goals);assert.equal(o.assists.length,row.assists);assert.equal(o.throwaways.length,row.throwaways);assert.equal(o.drops.length,row.drops);assert.equal(o.blocks.length,row.blocks);
 assert.equal(o.hucks.length,row.huckAttempts);assert.equal(o.hucks.filter(r=>r.detail.note==='Completed').length,row.huckCompletions);
 assert.deepEqual(o.dPoints.map(r=>r.scoreBefore),['1-0']);assert.equal(o.games.length,1);assert.equal(o.games[0].scoreBefore,'1-1');});
test('mirrored opponent game gives the opponent’s own events',()=>{const o=playerOccurrences([opponentPerspective(make(),teams)],'opp');assert.equal(o.games.length,1);assert.equal(o.dPoints.length,1);assert.equal(o.oPoints.length,1);});
test('connections group by teammate and match player totals',()=>{const game=make(),received=connectionStats([game],'bo','received',()=>.56),thrown=connectionStats([game],'ann','thrown',()=>.56),ann=received.find(r=>r.id==='ann');
 assert.equal(ann.throws,3);assert.equal(ann.completions,2);assert.equal(ann.goals,1);assert.equal(ann.throwaways,1);assert.equal(ann.throwDistance,50+85);assert.equal(thrown.length,1);assert.equal(thrown[0].id,'bo');assert.equal(thrown[0].throws,3);
 assert.equal(connectionStats([game],'bo','thrown',()=>.56)[0].drops,1);assert.equal(connectionStats([game],'ann','received',()=>.56)[0].drops,1);assert.ok(Math.abs(ann.edgePerThrow*3-ann.edge)<1e-9);assert.deepEqual(connectionStats([game],'opp','thrown',()=>.56),[]);});
test('connection edge is the selected player’s own share, not thrower plus receiver',()=>{const game=make();game.events.splice(1,4,pass('only','complete','ann','bo',{x:45.7,y:20}));
 const gain=(45.7-20)*.007,thrown=connectionStats([game],'ann','thrown',()=>.56)[0],received=connectionStats([game],'bo','received',()=>.56)[0];
 assert.ok(Math.abs(thrown.edge-gain)<1e-9);assert.ok(Math.abs(received.edge-gain)<1e-9);});
test('event timestamp links are independent of the point timestamp',()=>{const game=make();assert.equal(timestampLink(game,'3.15'),'https://app.veo.co/matches/x/#t=3:15');assert.equal(timestampLink(game,'bad'),null);assert.equal(linkTimestamp(pointVideos(game).links[1]),'2:00');assert.equal(linkTimestamp(timestampLink({videoLink:'https://youtu.be/abcdefghijk'},'1:02:03')),'1:02:03');assert.equal(linkTimestamp('https://app.veo.co/matches/x/'),'');});
test('throw share is the partner’s throws aimed at the selected player over all of the partner’s throws',()=>{const game=make(),received=connectionStats([game],'bo','received',()=>.56),thrown=connectionStats([game],'bo','thrown',()=>.56);
 assert.equal(received.find(r=>r.id==='ann').throwShare,3/3);assert.equal(thrown.find(r=>r.id==='ann').throwShare,1);
 const extra=make();extra.events.splice(2,0,pass('elsewhere','complete','ann','ann'));assert.equal(connectionStats([extra],'bo','received',()=>.56).find(r=>r.id==='ann').throwShare,3/4);});
test('target share is the share of the selected player’s throws that go to that target',()=>{const game=make();game.events.splice(2,0,pass('to-opp-side','complete','ann','bo'));const thrown=connectionStats([game],'ann','thrown',()=>.56);assert.equal(thrown.find(r=>r.id==='bo').throwShare,1);const withDrop=make();withDrop.events.splice(2,0,{...pass('nobody','throwaway','ann',null)});assert.equal(connectionStats([withDrop],'ann','thrown',()=>.56).find(r=>r.id==='bo').throwShare,3/4);});
test('passes with no known partner share one null row listing each pass with the score at the start of its point',()=>{const game=make();game.events.splice(5,0,{type:'point_end',winner:'us'},{id:'p1b',type:'point_start',line:['ann','bo'],opponentLine:['opp'],starting:'O',direction:1},pass('to-blank','throwaway','ann',{}),pass('to-null','complete','ann',null),pass('from-blank','complete',{},'ann'));
 const thrown=connectionStats([game],'ann','thrown',()=>.56),unknownTarget=thrown.find(r=>r.id===null),unknownThrower=connectionStats([game],'ann','received',()=>.56).find(r=>r.id===null);
 assert.equal(thrown.filter(r=>r.id===null).length,1);assert.equal(unknownTarget.throws,2);assert.deepEqual(unknownTarget.passes.map(p=>[p.event.id,p.scoreBefore,p.game.id]),[['to-blank','1-0','g'],['to-null','1-0','g']]);assert.equal(unknownTarget.throwShare,2/5);
 assert.equal(unknownThrower.throws,1);assert.equal(unknownThrower.passes[0].event.id,'from-blank');assert.equal(unknownThrower.throwShare,null);
 assert.deepEqual(thrown.find(r=>r.id==='bo').passes.map(p=>p.scoreBefore),['0-0','0-0','0-0']);});
