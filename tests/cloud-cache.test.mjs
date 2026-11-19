import test from 'node:test';
import assert from 'node:assert/strict';
import {CloudStore} from '../web/cloud.js';
import {emptyData} from '../web/core.js';

const config={enabled:true,url:'https://cache-test.example',functionName:'trt-api'},account=()=>({user:{id:'user'},admin:true,memberships:[],libraries:[{id:'library',revision:4}]}),library=()=>({data:{...emptyData(),teams:[{id:'team',name:'Saved team',players:[]}]},context:{admin:true,memberships:[]},versions:{'team:team':2},revision:4});
function setup(){let value=null;const cache={read:async()=>structuredClone(value),write:async(key,next)=>{value=structuredClone(next);}},calls=[],store=new CloudStore(config,cache);store.request=async action=>{calls.push(action);return action==='context'?account():library();};return {store,cache,calls,get value(){return value;}};}
async function storageTest(run){const previous=Object.fromEntries(['localStorage','sessionStorage'].map(key=>[key,globalThis[key]]));globalThis.localStorage=globalThis.sessionStorage={getItem:()=>null,setItem(){},removeItem(){}};try{await run();}finally{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}}

test('refresh uses an IndexedDB snapshot only after checking current server access and revision',()=>storageTest(async()=>{
 const state=setup(),first=await state.store.load();await state.store.cacheQueue;
 assert.deepEqual(state.calls,['context','library']);first.teams[0].name='Unsaved edit';assert.equal(state.value.data.teams[0].name,'Saved team');
 const next=new CloudStore(config,state.cache);next.request=state.store.request;state.calls.length=0;
 const cached=await next.load();assert.deepEqual(state.calls,['context']);assert.deepEqual(cached,library().data);assert.deepEqual(next.versions,library().versions);cached.teams[0].name='Edited';assert.equal(next.baseline.teams[0].name,'Saved team');
}));

test('cache misses on changes to user, library, revision or access, including role removal',()=>storageTest(async()=>{
 for(const change of [a=>a.user.id='other',a=>a.libraries[0].id='other',a=>a.libraries[0].revision++,a=>a.admin=false,a=>a.memberships.push({library_id:'library',team_id:'team',role:'stats'})]){
  const state=setup();await state.store.load();await state.store.cacheQueue;state.calls.length=0;const updated=account();change(updated);state.store.request=async action=>{state.calls.push(action);return action==='context'?updated:library();};
  await state.store.load();assert.deepEqual(state.calls,['context','library']);
 }
}));

test('unavailable storage falls back to cloud and cache failures never fail a successful load',()=>storageTest(async()=>{
 const state=setup();state.cache.read=async()=>{throw new Error('Storage blocked');};state.cache.write=async()=>{throw new Error('Quota exceeded');};assert.deepEqual(await state.store.load(),library().data);await state.store.cacheQueue;assert.deepEqual(state.calls,['context','library']);
}));

test('failed authentication and removed access never fall back to cached data',()=>storageTest(async()=>{
 const state=setup();await state.store.load();await state.store.cacheQueue;
 state.store.request=async()=>{throw new Error('Sign in required');};await assert.rejects(state.store.load(),/Sign in required/);
 state.store.request=async()=>({...account(),admin:false,libraries:[]});await assert.rejects(state.store.load(),/not been assigned/);await state.store.cacheQueue;assert.equal(state.value,null);
}));

test('sign out clears cached data after pending writes',()=>storageTest(async()=>{
 const state=setup();await state.store.load();let notified=false;state.store.listeners.add(()=>{assert.equal(state.value,null);notified=true;});await state.store.signOut();assert.equal(state.value,null);assert.equal(state.store.baseline,null);assert.equal(notified,true);
}));

test('successful saves are followed by a fresh download when the server revision advances',()=>storageTest(async()=>{
 const state=setup();const data=await state.store.load();await state.store.cacheQueue;data.teams[0].name='Saved edit';state.store.request=async action=>{state.calls.push(action);if(action==='save')return {versions:[{kind:'team',id:'team',revision:3}]};if(action==='context')return {...account(),libraries:[{id:'library',revision:5}]};return {...library(),data,revision:5,versions:{'team:team':3}};};
 await state.store.save(data);state.calls.length=0;assert.equal((await state.store.load()).teams[0].name,'Saved edit');assert.deepEqual(state.calls,['context','library']);await state.store.cacheQueue;assert.equal(state.value.revision,5);
}));

test('polling reuses its account check when it downloads a changed library',()=>storageTest(async()=>{
 const state=setup();await state.store.load();await state.store.cacheQueue;state.calls.length=0;
 state.store.request=async action=>{state.calls.push(action);return action==='context'?{...account(),libraries:[{id:'library',revision:5}]}:{...library(),revision:5};};
 assert.ok(await state.store.refresh());assert.deepEqual(state.calls,['context','library']);
 state.calls.length=0;assert.equal(await state.store.refresh(),null);assert.deepEqual(state.calls,['context']);
}));


test('cache keys isolate projects and API deployments',()=>{
 const first=new CloudStore(config),otherProject=new CloudStore({...config,url:'https://other.example'}),otherApi=new CloudStore({...config,functionName:'other-api'});
 assert.notEqual(first.cacheKey,otherProject.cacheKey);assert.notEqual(first.cacheKey,otherApi.cacheKey);
});

test('a failed save cannot put unacknowledged changes in the refresh cache',()=>storageTest(async()=>{
 const state=setup(),data=await state.store.load();await state.store.cacheQueue;data.teams[0].name='Failed edit';state.store.request=async action=>{if(action==='save')throw new Error('Conflict');return account();};
 await assert.rejects(state.store.save(data),/Conflict/);assert.equal(state.value.data.teams[0].name,'Saved team');assert.equal((await state.store.load()).teams[0].name,'Saved team');assert.equal(state.store.failed,false);
}));
