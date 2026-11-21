import test from 'node:test';
import assert from 'node:assert/strict';
import {CloudStore} from '../web/cloud.js';
import {emptyData} from '../web/core.js';

const config={enabled:true,url:'https://cache-test.example',functionName:'trt-api'},account=()=>({user:{id:'user'},admin:true,memberships:[],libraries:[{id:'library',revision:4}]}),library=()=>({data:{...emptyData(),teams:[{id:'team',name:'Saved team',players:[]}]},context:{admin:true,memberships:[]},versions:{'team:team':2},stamps:{'team:team':'2'},revision:4});
const delta=(context={admin:true,memberships:[]})=>({context,revision:5,records:[{kind:'team',id:'team',payload:{id:'team',name:'Changed team',players:[]}}],removed:[],versions:{'team:team':3},stamps:{'team:team':'3'}});
function setup(){let value=null;const cache={read:async()=>structuredClone(value),write:async(key,next)=>{value=structuredClone(next);}},calls=[],sent=[],store=new CloudStore(config,cache);store.request=async(action,values)=>{calls.push(action);sent.push(values);return action==='context'?account():action==='changes'?delta():library();};return {store,cache,calls,sent,get value(){return value;}};}
async function storageTest(run){const previous=Object.fromEntries(['localStorage','sessionStorage'].map(key=>[key,globalThis[key]]));globalThis.localStorage=globalThis.sessionStorage={getItem:()=>null,setItem(){},removeItem(){}};try{await run();}finally{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}}

test('refresh uses an IndexedDB snapshot only after checking current server access and revision',()=>storageTest(async()=>{
 const state=setup(),first=await state.store.load();await state.store.cacheQueue;
 assert.deepEqual(state.calls,['context','library']);first.teams[0].name='Unsaved edit';assert.equal(state.value.data.teams[0].name,'Saved team');
 const next=new CloudStore(config,state.cache);next.request=state.store.request;state.calls.length=0;
 const cached=await next.load();assert.deepEqual(state.calls,['context']);assert.deepEqual(cached,library().data);assert.deepEqual(next.versions,library().versions);cached.teams[0].name='Edited';assert.equal(next.baseline.teams[0].name,'Saved team');
}));

test('an older copy is brought up to date with a delta only for the same user, library and access; anything else reloads in full',()=>storageTest(async()=>{
 for(const reopen of [false,true])for(const [change,expected] of [[a=>a.user.id='other','library'],[a=>a.libraries[0].id='other','library'],[a=>a.libraries[0].revision++,'changes'],[a=>a.admin=false,'library'],[a=>a.memberships.push({library_id:'library',team_id:'team',role:'stats'}),'library']]){
  // reopening leaves only the IndexedDB copy; otherwise the in-memory baseline is the base
  const state=setup();await state.store.load();await state.store.cacheQueue;const store=reopen?new CloudStore(config,state.cache):state.store;state.calls.length=0;const updated=account();change(updated);store.request=async action=>{state.calls.push(action);return action==='context'?updated:action==='changes'?delta():library();};
  const data=await store.load();assert.deepEqual(state.calls,['context',expected]);
  if(expected==='changes'){assert.equal(data.teams[0].name,'Changed team');assert.deepEqual([store.revision,store.versions,store.stamps],[5,{'team:team':3},{'team:team':'3'}]);await store.cacheQueue;assert.equal(state.value.revision,5);assert.equal(state.value.data.teams[0].name,'Changed team');data.teams[0].name='Unsaved';assert.equal(store.baseline.teams[0].name,'Changed team');}
 }
}));

test('a delta filtered for access that changed mid-refresh, a copy without stamps, and a manual refresh all reload in full',()=>storageTest(async()=>{
 let state=setup();await state.store.load();state.calls.length=0;state.store.request=async action=>{state.calls.push(action);return action==='context'?{...account(),libraries:[{id:'library',revision:5}]}:action==='changes'?delta({admin:false,memberships:[]}):library();};
 await state.store.refresh();assert.deepEqual(state.calls,['context','changes','library']);
 state=setup();await state.store.load();await state.store.cacheQueue;const older=state.value;delete older.stamps;await state.cache.write(null,older);const reopened=new CloudStore(config,state.cache);reopened.request=async action=>{state.calls.push(action);return action==='context'?{...account(),libraries:[{id:'library',revision:5}]}:library();};state.calls.length=0;
 await reopened.load();assert.deepEqual(state.calls,['context','library']);
 state=setup();await state.store.load();state.calls.length=0;await state.store.load(null,{full:true});assert.deepEqual(state.calls,['context','library']);
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

test('a save nobody else interleaved advances the revision, so the next poll downloads nothing',()=>storageTest(async()=>{
 const state=setup(),data=await state.store.load();await state.store.cacheQueue;data.teams[0].name='Saved edit';
 state.store.request=async action=>{state.calls.push(action);if(action==='save')return {versions:[{kind:'team',id:'team',revision:3}],revision:5,stamps:{'team:team':'3'}};if(action==='context')return {...account(),libraries:[{id:'library',revision:5}]};assert.fail('downloaded with '+action);};
 await state.store.save(data);assert.equal(state.store.revision,5);assert.deepEqual(state.store.stamps,{'team:team':'3'});state.calls.length=0;assert.equal(await state.store.refresh(),null);assert.deepEqual(state.calls,['context']);
}));

test('a save after another write, or one the server converted back from the opponent side, keeps the revision so the next poll fetches the changes',()=>storageTest(async()=>{
 for(const [reply,stamps] of [[{revision:6,stamps:{'team:team':'3'}},{'team:team':'3'}],[{revision:5,stamps:{}},{}]]){
  const state=setup(),data=await state.store.load();await state.store.cacheQueue;data.teams[0].name='Saved edit';
  state.store.request=async(action,values)=>{state.calls.push(action);state.sent.push(values);if(action==='save')return {versions:[{kind:'team',id:'team',revision:3}],...reply};if(action==='context')return {...account(),libraries:[{id:'library',revision:reply.revision}]};return delta();};
  await state.store.save(data);assert.equal(state.store.revision,4);state.calls.length=state.sent.length=0;assert.ok(await state.store.refresh());assert.deepEqual(state.calls,['context','changes']);assert.deepEqual(state.sent[1].stamps,stamps);
 }
}));

test('polling reuses its account check and downloads only the changed records',()=>storageTest(async()=>{
 const state=setup();await state.store.load();await state.store.cacheQueue;state.calls.length=0;state.sent.length=0;
 state.store.request=async(action,values)=>{state.calls.push(action);state.sent.push(values);return action==='context'?{...account(),libraries:[{id:'library',revision:5}]}:delta();};
 assert.equal((await state.store.refresh()).teams[0].name,'Changed team');assert.deepEqual(state.calls,['context','changes']);assert.deepEqual(state.sent[1].stamps,{'team:team':'2'});
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
