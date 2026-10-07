import test from 'node:test';
import assert from 'node:assert/strict';
import {adjustedDataset,adjustedRatings} from '../web/adjusted.js';
import {createAdjustedStore} from '../web/adjusted-store.js';
const team={id:'t',players:Array.from({length:10},(_,i)=>({id:`p${i}`}))},core=['p2','p3','p4','p5','p6','p7'],on=['p0',...core],off=['p1',...core];
function game(points,extra={}){return {id:'repeated-id',teamId:'t',events:points.flatMap(([line,winner,starting='O',opponentLine=[]])=>[{type:'point_start',line,starting,opponentLine},{type:'point_end',winner}]),...extra};}
const analyze=games=>adjustedRatings(adjustedDataset(games,team));
const pair=(count=10)=>game(Array.from({length:count},()=>[[on,'us'],[off,'them']]).flat());

test('joint logistic fit matches an independently solved balanced two-player contrast',()=>{
 const result=analyze([pair(20)]),side=result.hold,a=side.ratings.p0,b=side.ratings.p1;
 let low=0,high=10;for(let i=0;i<100;i++){const x=(low+high)/2;if(x/.35**2>20/(1+Math.exp(x)))high=x;else low=x;}
 const expected=100*(2/(1+Math.exp(-(low+high)/2))-1);
 assert.ok(Math.abs(a.value-expected)<1e-5);assert.ok(Math.abs(a.value+b.value)<1e-9);
 assert.ok(a.interval[0]<a.value&&a.interval[1]>a.value);assert.ok(a.uncertaintyReduction>0&&a.uncertaintyReduction<1);
 const probability=1/(1+Math.exp(-(low+high)/2)),expectedReduction=1-1/(1+20*probability*(1-probability)*.35**2);
 assert.ok(Math.abs(a.uncertaintyReduction-expectedReduction)<1e-7);
 assert.equal(side.ratings.p2.value,null);assert.equal(side.ratings.p2.status,'no-within-game-variation');
 assert.equal(side.validation.status,'unavailable');assert.equal(result.opponentHold.coverage.used,0);
});

test('small samples shrink smoothly without a ten-point gate, with separate O/D signs',()=>{
 const g=game([[on,'us'],[off,'them'],[on,'us','D'],[off,'them','D']]),result=analyze([g]);
 assert.ok(result.hold.ratings.p0.value>0&&result.hold.ratings.p0.value<10);
 assert.ok(result.opponentHold.ratings.p0.value<0);assert.ok(result.hold.ratings.p0.interval[0]<0);
 const larger=analyze([pair(12)]).hold.ratings.p0;assert.ok(larger.value>result.hold.ratings.p0.value);assert.ok(larger.uncertaintyReduction>result.hold.ratings.p0.uncertaintyReduction);
});

test('game difficulty alone cannot identify an always-on or always-off player',()=>{
 const result=analyze([game(Array.from({length:10},()=>[on,'us'])),game(Array.from({length:10},()=>[off,'them']))]);
 assert.equal(result.hold.games,2);assert.equal(result.hold.ratings.p0.value,null);assert.equal(result.hold.ratings.p1.value,null);
 assert.deepEqual(result.hold.comparisonPlayers,[]);
});

test('within-game centering removes a Simpson reversal despite imbalanced attendance',()=>{
 const g1=game([...Array.from({length:8},()=>[on,'us']),[off,'us']]),g2=game([[on,'them'],...Array.from({length:8},()=>[off,'them'])]);
 const result=analyze([g1,g2]);assert.ok(Math.abs(result.hold.ratings.p0.value)<1e-6);
});

test('coverage excludes unknown, duplicated and substituted own lines without double-counting points',()=>{
 const g=game([[on,'us'],[off,'them'],[[...on.slice(0,6),null],'us'],[[...on.slice(0,6),'unknown'],'us'],[[...on.slice(0,6),'p0'],'us'],[on,'us']]);
 g.events.splice(g.events.length-1,0,{type:'substitution',side:'us',outId:'p0',inId:'p1'});
 g.events.push({type:'point_start',line:on,starting:'O'});
 const before=structuredClone(g),dataset=adjustedDataset([g,g],team),result=adjustedRatings(dataset);
 assert.deepEqual(g,before);assert.equal(dataset.rows.length,2);assert.deepEqual(result.hold.coverage,{completed:6,incompleteLine:3,substitution:1,used:2,opponentAdjusted:0});
});

test('always-together teammates are explicitly flagged as not separately identifiable',()=>{
 const a=['p0','p1','p4','p5','p6','p7','p8'],b=['p2','p3','p4','p5','p6','p7','p8'],result=analyze([game(Array.from({length:10},()=>[[a,'us'],[b,'them']]).flat())]);
 assert.equal(result.hold.ratings.p0.status,'partly-confounded');assert.deepEqual(result.hold.ratings.p0.confoundedWith,['p1']);assert.ok(result.hold.ratings.p0.unidentifiedFraction>.1);
 assert.ok(Math.abs(result.hold.ratings.p0.value-result.hold.ratings.p1.value)<1e-9);
});

test('opponent lineup adjustment requires a complete game/start and flags perfect matchup confounding',()=>{
 const opponents=Array.from({length:8},(_,i)=>({id:`q${i}`})),a=opponents.slice(0,7).map(p=>p.id),b=opponents.slice(1).map(p=>p.id),g=game([[on,'us','O',a],[off,'them','O',b]],{opponents});
 const result=analyze([g]);assert.equal(result.hold.coverage.opponentAdjusted,2);assert.equal(result.hold.ratings.p0.status,'partly-confounded');
 g.events[0].opponentLine=[];assert.equal(analyze([g]).hold.coverage.opponentAdjusted,0);
});

test('nested validation holds out entire games and never tunes on held-out outcomes',()=>{
 const games=Array.from({length:6},(_,i)=>game([[on,i%2?'them':'us'],[off,'them'],[on,'us'],[off,i%2?'us':'them']],{opponent:`opp-${i%2}`})),result=analyze(games),v=result.hold.validation;
 assert.equal(v.status,'available');assert.equal(v.games,6);assert.equal(v.points,24);
 const held=v.folds[0].heldOutGames,changed=structuredClone(games);for(const i of held)for(const e of changed[i].events)if(e.type==='point_end')e.winner=e.winner==='us'?'them':'us';
 const after=analyze(changed).hold.validation;assert.equal(after.folds[0].tau,v.folds[0].tau);
 const seen=[];for(const f of v.folds){assert.ok(f.trainingGames.every(id=>!f.heldOutGames.includes(id)));seen.push(...f.heldOutGames);}
 assert.deepEqual(seen.sort((a,b)=>a-b),[0,1,2,3,4,5]);assert.ok(Number.isFinite(v.adjustedLoss)&&Number.isFinite(v.baselineLoss));
});

test('predictive validation recognizes repeatable player signal',()=>{
 const games=Array.from({length:8},()=>pair(12)),v=analyze(games).hold.validation;
 assert.ok(v.improvement>.05);assert.ok(v.adjustedBrier<v.baselineBrier);
});

test('Laplace intervals are deterministic, finite with separation, and invariant in estimate to player renaming',()=>{
 const a=analyze([pair(40)]),b=analyze([pair(40)]);assert.deepEqual(a,b);
 const g=pair(40);for(const e of g.events)if(e.line)e.line=e.line.map(id=>id==='p0'?'p1':id==='p1'?'p0':id);
 assert.ok(Math.abs(analyze([g]).hold.ratings.p1.value-a.hold.ratings.p0.value)<1e-7);
 for(const r of Object.values(a.hold.ratings))if(r.interval)assert.ok(r.interval.every(Number.isFinite));
});

test('background cache reuses snapshots, invalidates edits and filters, and routes out-of-order results',()=>{
 const sent=[],changed=[],worker={postMessage:x=>sent.push(x),terminate(){}},store=createAdjustedStore(entry=>changed.push(entry.id),()=>worker),dataset=adjustedDataset([pair(1)],team),a=store.get(dataset);
 assert.equal(store.get(structuredClone(dataset)),a);assert.equal(sent.length,1);
 dataset.rows[0].y=0;const b=store.get(dataset);assert.notEqual(a.id,b.id);const empty=store.get(adjustedDataset([],team));assert.notEqual(empty.id,b.id);
 worker.onmessage({data:{id:b.id,result:{hold:{}}}});worker.onmessage({data:{id:a.id,error:'Fit failed'}});
 assert.equal(a.status,'error');assert.equal(b.status,'ready');assert.deepEqual(changed,[b.id,a.id]);
 worker.onerror();assert.equal(empty.status,'error');
});
