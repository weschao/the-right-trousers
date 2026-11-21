import test from 'node:test';
import assert from 'node:assert/strict';
import {CloudStore} from '../web/cloud.js';
import {emptyData} from '../web/core.js';

const library=name=>({...emptyData(),teams:[{id:'team',name,players:[]}]});
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate){for(let attempt=0;attempt<100&&!predicate();attempt++)await settle();assert.ok(predicate());}

test('saves queued behind a slow request collapse into one request carrying the newest copy',async()=>{
 const store=new CloudStore({enabled:true}),requests=[];
 store.baseline=library('zero');store.versions={'team:team':1};store.revision=1;
 store.request=async(action,values)=>{assert.equal(action,'save');let release;const done=new Promise(resolve=>release=resolve);requests.push({changes:values.changes,release});await done;const revision=store.versions['team:team']+1;return {versions:[{kind:'team',id:'team',revision}],stamps:{}};};
 const settled=new Set(),track=(name,promise)=>promise.then(()=>settled.add(name));
 const first=track('first',store.save(library('one')));await until(()=>requests.length===1);
 const second=track('second',store.save(library('two'))),third=track('third',store.save(library('three')));
 assert.equal(requests[0].changes[0].payload.name,'one');
 requests[0].release();await until(()=>requests.length===2);
 // the second request skips 'two' and sends the newest copy, at the revision the first save returned
 assert.equal(requests[1].changes[0].payload.name,'three');assert.equal(requests[1].changes[0].revision,2);
 assert.ok(settled.has('first'));assert.ok(!settled.has('second')&&!settled.has('third'),'queued saves resolve only after their copy lands');
 // a save made after the newest copy was sent still gets a request of its own
 const fourth=track('fourth',store.save(library('four')));
 requests[1].release();await until(()=>requests.length===3);
 assert.equal(requests[2].changes[0].payload.name,'four');assert.ok(settled.has('second')&&!settled.has('fourth'));
 requests[2].release();await Promise.all([first,second,third,fourth]);
 assert.equal(requests.length,3);assert.equal(store.baseline.teams[0].name,'four');assert.equal(store.versions['team:team'],4);assert.equal(store.saving,0);
});

test('a failed request fails every save queued behind it, and retry sends the newest copy',async()=>{
 const store=new CloudStore({enabled:true}),sent=[];let failNext=true;
 store.baseline=library('zero');store.versions={'team:team':1};
 store.request=async(action,values)=>{if(action!=='save')throw new Error('offline');sent.push(values.changes[0].payload.name);if(failNext){failNext=false;throw Object.assign(new Error('Server error'),{status:500});}return {versions:[{kind:'team',id:'team',revision:2}],stamps:{}};};
 await Promise.all([assert.rejects(store.save(library('one')),/Server error/),assert.rejects(store.save(library('two')),/Unsaved changes/)]);
 assert.deepEqual(sent,['two']);assert.equal(store.failed,true);assert.equal(store.baseline.teams[0].name,'zero');
 await store.retry(library('three'));
 assert.deepEqual(sent,['two','three']);assert.equal(store.failed,false);assert.equal(store.baseline.teams[0].name,'three');
});
