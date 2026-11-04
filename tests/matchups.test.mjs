import test from 'node:test';
import assert from 'node:assert/strict';
import {defenderHistory,rememberDefender,startingMatchups,recordPointMatchup,pointMatchups,pointsOf,UNKNOWN_MATCHUP,UNGUARDED} from '../web/core.js';
const game=()=>({events:[{type:'point_start',id:'point',line:['a','b'],opponentLine:['x','y'],starting:'O'}]});
test('remembers all matchups, moves repeats to most recent, and survives save/reload',()=>{
 const g=game();
 for(const defender of ['x','y','z','x'])recordPointMatchup(g,'point',{offenseId:'a',defenderId:defender});
 const saved=JSON.parse(JSON.stringify(g));
 assert.deepEqual(defenderHistory(saved),[['a','y'],['a','z'],['a','x']]);
 assert.deepEqual(pointMatchups(pointsOf(saved)[0]),[['a','x']]);
 assert.deepEqual(startingMatchups(saved,['a'],['x','y','z']),[['a','x']]);
 assert.deepEqual(startingMatchups(saved,['a'],['y','z']),[['a','z']]);
 assert.deepEqual(startingMatchups(saved,['a'],['y']),[['a','y']]);
 assert.deepEqual(startingMatchups(saved,['a'],['unseen']),[]);
});
test('restores either offensive side and keeps assignments one-to-one',()=>{
 const g=game();rememberDefender(g,'a','x');rememberDefender(g,'a','y');rememberDefender(g,'b','y');
 assert.deepEqual(startingMatchups(g,['a','b'],['x','y']),[['a','y']]);
 assert.deepEqual(startingMatchups(g,['x','y'],['a','b']),[['x','a'],['y','b']]);
});
test('changing a point matchup prevents previous pass markers from refilling displaced assignments',()=>{
 const g=game();g.events.push({type:'pass',throwerId:'a',opponentMarkerId:'x',receiverId:'b',opponentReceiverDefenderId:'y'});
 recordPointMatchup(g,'point',{offenseId:'a',defenderId:'y'});
 assert.deepEqual(pointMatchups(pointsOf(g)[0]),[['a','y']]);
 assert.deepEqual(startingMatchups(g,['b'],['y']),[['b','y']]);
 recordPointMatchup(g,'point',{defenderId:'y'});
 assert.deepEqual(pointMatchups(pointsOf(g)[0]),[]);
});
test('Unknown, Unguarded and clearing are point-only and retain real history',()=>{
 const g=game();recordPointMatchup(g,'point',{offenseId:'a',defenderId:'x'});
 for(const defenderId of [UNKNOWN_MATCHUP,UNGUARDED])recordPointMatchup(g,'point',{offenseId:'a',defenderId});
 recordPointMatchup(g,'point',{offenseId:'a',clear:true});
 assert.deepEqual(pointMatchups(pointsOf(g)[0]),[]);
 assert.deepEqual(startingMatchups(g,['a'],['x']),[['a','x']]);
});
test('existing games recover history from saved plays and standing pairings',()=>{
 const g=game();g.events[0].matchups=[['a','x']];g.events.push({type:'possession_start',playerId:'a',opponentMarkerId:'y'},{type:'pass',throwerId:'a',opponentMarkerId:'y',receiverId:'b',opponentReceiverDefenderId:'z'},{type:'pass',throwerId:'x',markerId:'b'});g.defenderPairings=[['a','z']];
 assert.deepEqual(startingMatchups(g,['a'],['x','y','z']),[['a','z']]);
 assert.deepEqual(startingMatchups(g,['a'],['x','y']),[['a','y']]);
 assert.deepEqual(startingMatchups(g,['x'],['a','b']),[['x','b']]);
});
