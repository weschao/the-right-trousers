// incremental sync against a real Postgres (PGlite) and the real API: each client's copy must always equal
// a full download, while warm API workers read only the rows that changed
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createApi} from '../supabase/functions/trt-api/index.js';
import {CloudStore} from '../web/cloud.js';
import {editorLibrary} from '../web/access.js';
import {emptyData,FIELD} from '../web/core.js';
import {playerProjection} from '../web/player-projection.js';

const ids={admin:'00000000-0000-4000-8000-000000000001',statsM:'00000000-0000-4000-8000-000000000002',leaderO:'00000000-0000-4000-8000-000000000003',playerM:'00000000-0000-4000-8000-000000000004'};

// a recorded game between two teams in the library, so team O's users see it from their own side
async function seedLibrary(){
 const recorded=JSON.parse(await readFile(new URL('./fixtures/polar-bears-2026-10-06.json',import.meta.url),'utf8')),real=recorded.games[0],mischief=recorded.teams[0];
 const opponent={id:real.opponentTeamId,name:'Opponents',players:real.opponents.map(player=>({...player}))};
 const small=(id,teamId,opponentTeamId)=>({id,teamId,opponent:'Someone',opponentTeamId,date:'2026-11-16',finished:true,field:FIELD,opponents:[],events:[{id:id+'-p',type:'point_start',line:[],starting:'O',direction:1},{id:id+'-e',type:'point_end',winner:'us'}]});
 return {...emptyData(),teams:[mischief,opponent],games:[real,small('m1',mischief.id,opponent.id),small('m2',mischief.id,null),small('o1',opponent.id,mischief.id)],sources:[{id:'source',note:'imported'}],settings:{secondaryPreviousShare:.3}};
}

async function startDatabase(){
 const pg=new PGlite();
 await pg.exec('create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);');
 for(const name of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(name=>name.endsWith('.sql')).sort())await pg.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 for(const [role,id] of Object.entries(ids))await pg.query('insert into auth.users values($1,$2,now())',[id,role==='admin'?'weschao@gmail.com':role+'@example.com']);
 const libraryId=(await pg.query('select id from trt_libraries')).rows[0].id,library=await seedLibrary();
 await pg.query('select trt_apply_changes($1,$2,$3::jsonb)',[ids.admin,libraryId,JSON.stringify([...library.teams.map(payload=>({kind:'team',id:payload.id,payload,revision:0})),...library.games.map(payload=>({kind:'game',id:payload.id,payload,revision:0})),{kind:'source',id:'source',payload:library.sources[0],revision:0},{kind:'settings',id:'settings',payload:library.settings,revision:0}])]);
 const membership=(user,team,role)=>pg.query('select trt_set_membership($1,$2,$3,$4,$5)',[ids.admin,libraryId,ids[user],team,role]);
 await membership('statsM',library.teams[0].id,'stats');await membership('leaderO',library.teams[1].id,'leadership');await membership('playerM',library.teams[0].id,'player');
 return {pg,libraryId,library,membership};
}

// PostgREST as the API uses it, honouring select and order, so a payload the API did not ask for is never returned
function postgrest(pg,log){
 return async(url,options={})=>{
  const address=new URL(url),body=options.body?JSON.parse(options.body):null,ok=(value,status=200)=>new Response(JSON.stringify(value),{status});
  if(address.pathname==='/auth/v1/user'){const role=options.headers.Authorization.replace('Bearer ','');return ids[role]?ok((await pg.query('select * from auth.users where id=$1',[ids[role]])).rows[0]):ok({error:'Unauthorized'},401);}
  const route=address.pathname.replace('/rest/v1/','');
  try{
   if(route.startsWith('rpc/')){const name=route.slice(4),args=Object.values(body);log.push({route,payloadBytes:0});const value=(await pg.query(`select ${name}(${args.map((_,index)=>'$'+(index+1)).join(',')}) as value`,args.map(value=>Array.isArray(value)?JSON.stringify(value):value))).rows[0].value;return value===null||value===''?new Response(null,{status:204}):ok(value);}
   const clauses=[],values=[];let columns='*',order='';
   for(const [key,value] of address.searchParams){
    if(key==='select'){assert.match(value,/^[a-z_]+(,[a-z_]+)*$/);columns=value;continue;}
    if(key==='order'){order=' order by '+value.split(',').map(part=>{const [column,direction]=part.split('.');assert.match(column,/^[a-z_]+$/);assert.ok(['asc','desc'].includes(direction));return column+' '+direction;}).join(',');continue;}
    assert.match(key,/^[a-z_]+$/);
    if(value.startsWith('eq.')){values.push(value.slice(3));clauses.push(`${key}=$${values.length}`);}
    else if(value.startsWith('in.')){const inner=value.slice(4,-1),list=inner.startsWith('"')?[...inner.matchAll(/"((?:\\.|[^"\\])*)"/g)].map(match=>match[1].replace(/\\(.)/g,'$1')):inner.split(',');clauses.push(`${key} in (${list.map(item=>{values.push(item);return '$'+values.length;}).join(',')})`);}
    else assert.fail('unsupported filter '+key);
   }
   const rows=(await pg.query(`select ${columns} from ${route}${clauses.length?' where '+clauses.join(' and '):''}${order}`,values)).rows;
   log.push({route,query:address.search,payloadBytes:rows.reduce((sum,row)=>sum+(row.payload===undefined?0:JSON.stringify(row.payload).length),0),rows:rows.length});
   return ok(rows);
  }catch(error){return ok({message:error.message,code:error.code},400);}
 };
}

function worker(pg,log){const api=createApi({url:'https://sync.example',serviceKey:'test-only',fetcher:postgrest(pg,log)});return async(role,input)=>{const response=await api(new Request('https://sync.example/functions/v1/trt-api',{method:'POST',headers:{Authorization:'Bearer '+role},body:JSON.stringify(input)}));const value=await response.json();if(response.status!==200)throw Object.assign(new Error(value.error),{status:response.status});return value;};}

async function storageTest(run){const previous=Object.fromEntries(['localStorage','sessionStorage'].map(key=>[key,globalThis[key]]));globalThis.localStorage=globalThis.sessionStorage={getItem:()=>null,setItem(){},removeItem(){}};try{await run();}finally{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}}
const byId=data=>({...data,teams:[...data.teams].sort((a,b)=>a.id.localeCompare(b.id)),games:[...data.games].sort((a,b)=>a.id.localeCompare(b.id)),sources:[...data.sources].sort((a,b)=>a.id.localeCompare(b.id))});
const payloadBytes=log=>log.filter(entry=>entry.route==='trt_entities').reduce((sum,entry)=>sum+entry.payloadBytes,0);

test('the PostgREST stand-in returns only the selected columns, so payload counts are real',()=>storageTest(async()=>{
 const {pg,libraryId}=await startDatabase(),log=[],fetcher=postgrest(pg,log);
 try{
  const index=await (await fetcher(`https://sync.example/rest/v1/trt_entities?library_id=eq.${libraryId}&select=kind,id,revision,deleted&order=kind.asc,id.asc`)).json();
  assert.ok(index.length>0);assert.ok(index.every(row=>!('payload' in row)));assert.equal(log.at(-1).payloadBytes,0);
  assert.deepEqual(index.map(row=>row.kind+':'+row.id),[...index.map(row=>row.kind+':'+row.id)].sort((a,b)=>a<b?-1:1),'ordered by kind then id');
  const full=await (await fetcher(`https://sync.example/rest/v1/trt_entities?library_id=eq.${libraryId}`)).json();assert.ok(full.every(row=>'payload' in row));assert.ok(log.at(-1).payloadBytes>100000);
 }finally{await pg.close();}
}));

test('a warm API worker reads only the payloads that changed, and never the whole-library snapshot',()=>storageTest(async()=>{
 const {pg,libraryId,library}=await startDatabase(),logA=[],logB=[],workerA=worker(pg,logA),workerB=worker(pg,logB);
 try{
  const real=library.games[0],teamM=library.teams[0].id,firstPlayer=library.teams[0].players[0].id;
  const cold=await workerA('admin',{action:'library',libraryId}),all=payloadBytes(logA);assert.ok(all>JSON.stringify(real).length,'a cold worker reads every payload once');
  logA.length=0;const warm=await workerA('admin',{action:'library',libraryId});assert.equal(payloadBytes(logA),0,'a warm worker reads no payload when nothing changed');assert.deepEqual(warm,cold);
  logA.length=0;await workerA('playerM',{action:'player',libraryId,teamId:teamM,playerId:firstPlayer});assert.equal(payloadBytes(logA),0,'player details reuse the cached rows');
  logA.length=0;assert.deepEqual((await workerA('admin',{action:'changes',libraryId,stamps:cold.stamps})).records,[]);assert.equal(payloadBytes(logA),0);
  // a save through this worker updates its cache, so nothing is read back
  const edited={...cold.data.games.find(g=>g.id==='m1'),opponent:'Saved through A'};
  const saved=await workerA('statsM',{action:'save',libraryId,changes:[{kind:'game',id:'m1',payload:edited,revision:cold.versions['game:m1']}]});
  logA.length=0;let delta=await workerA('admin',{action:'changes',libraryId,stamps:cold.stamps});assert.equal(payloadBytes(logA),0,'the saving worker already holds what it saved');assert.deepEqual(delta.records.map(r=>r.id),['m1']);assert.equal(delta.records[0].payload.opponent,'Saved through A');assert.equal(delta.stamps['game:m1'],saved.stamps['game:m1']);
  // a save through another worker costs this one exactly that row
  await workerB('admin',{action:'library',libraryId});
  await workerB('statsM',{action:'save',libraryId,changes:[{kind:'game',id:'m2',payload:{...cold.data.games.find(g=>g.id==='m2'),opponent:'Saved through B'},revision:cold.versions['game:m2']}]});
  logA.length=0;delta=await workerA('admin',{action:'changes',libraryId,stamps:cold.stamps});
  const m2=(await pg.query("select payload from trt_entities where kind='game' and id='m2'")).rows[0].payload;
  assert.equal(payloadBytes(logA),JSON.stringify(m2).length,'only the row another worker changed is fetched');assert.deepEqual(delta.records.map(r=>r.id).sort(),['m1','m2']);
  assert.ok(![...logA,...logB].some(entry=>entry.route==='rpc/trt_snapshot'),'nothing reads the whole-library snapshot');
 }finally{await pg.close();}
}));

test('cached rows are frozen, and player details compute from them without changing anything',async()=>{
 const library=await seedLibrary(),freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);Object.values(value).forEach(freeze);}return value;},frozen=freeze(structuredClone(library));
 for(const team of frozen.teams)for(const player of team.players)for(const gameIds of [[],[frozen.games[0].id]])playerProjection(frozen,team.id,player.id,{gameIds,huckYards:35});
 assert.throws(()=>{frozen.games[0].opponent='changed';},TypeError);
});

test('after any sequence of edits by four users through two workers, every copy equals a full download for that user',()=>storageTest(async()=>{
 const {pg,libraryId,library,membership}=await startDatabase(),logs=[[],[]],workers=logs.map(log=>worker(pg,log)),actions=[];let accessChanges=0;const ran=new Set();
 let seed=20261120;const random=()=>{seed=(seed+0x6D2B79F5)|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;},pick=list=>list[Math.floor(random()*list.length)];
 const teamM=library.teams[0].id,teamO=library.teams[1].id,real=library.games[0].id;
 const connect=(role,cache)=>{const store=new CloudStore({enabled:true,url:'https://sync.example',functionName:'trt-api'},cache);store.libraryId=libraryId;store.request=async(action,values={})=>{actions.push(role+':'+action);return pick(workers)(role,{action,libraryId,...values});};return store;};
 const clients={};
 try{
  for(const role of Object.keys(ids)){let stored=null;const cache={read:async()=>structuredClone(stored),write:async(key,value)=>{stored=structuredClone(value);}},store=connect(role,cache);clients[role]={store,cache,data:await store.load()};await store.cacheQueue;}
  const truth=async role=>{const rows=(await pg.query('select trt_snapshot($1) as value',[libraryId])).rows[0].value.entities,admin=role==='admin',memberships=(await pg.query('select * from trt_memberships where user_id=$1 and library_id=$2',[ids[role],libraryId])).rows,data=emptyData();
   for(const row of rows){if(row.deleted)continue;if(row.kind==='settings')data.settings=row.payload;else data[{team:'teams',game:'games',source:'sources'}[row.kind]].push(row.payload);}
   const visible=editorLibrary({admin,memberships},data),keys=new Set([...visible.teams.map(t=>'team:'+t.id),...visible.games.map(g=>'game:'+g.id),...visible.sources.map(s=>'source:'+s.id),'settings:settings']);
   return {data:JSON.parse(JSON.stringify(visible)),versions:Object.fromEntries(rows.filter(row=>keys.has(row.kind+':'+row.id)).map(row=>[row.kind+':'+row.id,row.revision]))};};
  const check=async step=>{for(const [role,client] of Object.entries(clients)){const expected=await truth(role);assert.deepEqual(byId(client.data),byId(expected.data),`${step}: ${role}'s copy differs from a full download`);assert.deepEqual(byId(client.store.baseline),byId(expected.data),`${step}: ${role}'s baseline`);assert.deepEqual(Object.fromEntries(Object.keys(client.store.stamps).map(key=>[key,client.store.versions[key]])),expected.versions,`${step}: ${role}'s versions`);assert.deepEqual(client.store.stamps,(await workers[0](role,{action:'library',libraryId})).stamps,`${step}: ${role}'s stamps`);}};
  const save=async(role,change)=>{const client=clients[role];change(client.data);await client.store.save(client.data);};
  const operations=[
   ['admin edits a game',()=>save('admin',data=>{const game=pick(data.games);game.opponent='Edited '+random();})],
   ['statsM notes an event in the recorded game',()=>save('statsM',data=>{const game=data.games.find(g=>g.id===real);pick(game.events).notes='Noted '+random();})],
   ['leaderO edits the recorded game from its own side',()=>save('leaderO',data=>{const game=data.games.find(g=>g.id===real);pick(game.events).notes='Opponent note '+random();})],
   ['admin renames the team that recorded the game',()=>save('admin',data=>{data.teams.find(t=>t.id===teamM).name='Mischief '+Math.floor(random()*100);})],
   ['admin adds a game against team O',()=>save('admin',data=>{const id='new-'+Math.floor(random()*1e9);data.games.push({...structuredClone(data.games.find(g=>g.id==='o1')??data.games[0]),id,teamId:teamM,opponentTeamId:teamO,events:[{id:id+'-p',type:'point_start',line:[],starting:'D',direction:1}]});})],
   ['admin deletes a game other than the recorded one',()=>save('admin',data=>{const choices=data.games.filter(g=>g.id!==real);if(choices.length)data.games.splice(data.games.indexOf(pick(choices)),1);})],
   ['admin takes team O off a game',()=>save('admin',data=>{const game=data.games.find(g=>g.id!==real&&g.opponentTeamId===teamO);if(game)game.opponentTeamId=null;})],
   ['admin changes settings and the source',()=>save('admin',data=>{data.settings={...data.settings,secondaryPreviousShare:random()};data.sources[0]={...data.sources[0],note:'Re-imported '+random()};})],
   ['two users save back to back before either refreshes',async()=>{await save('admin',data=>{data.games.find(g=>g.id===real).opponent='Interleaved '+random();});await save('statsM',data=>{const game=pick(data.games.filter(g=>g.id!==real));if(game)game.opponent='Second '+random();});}],
   ['access changes for playerM',async()=>{accessChanges++;await membership('playerM',teamM,pick(['stats','player']));}],
   ['a client reopens from IndexedDB',async()=>{const role=pick(Object.keys(clients)),client=clients[role],store=connect(role,client.cache);client.store=store;client.data=await store.load();await store.cacheQueue;}]
  ];
  await check('start');
  for(let step=0;step<60;step++){
   const [name,run]=pick(operations);ran.add(name);await run();
   for(const client of Object.values(clients)){const next=await client.store.refresh();if(next)client.data=next;await client.store.cacheQueue;}
   await check(`step ${step} (${name})`);
  }
  assert.equal(ran.size,operations.length,'every operation ran at least once');
  // full downloads happen only on first load and after playerM's access changes; everything else is a delta
  const fulls=actions.filter(action=>action.endsWith(':library')).length,deltas=actions.filter(action=>action.endsWith(':changes')).length;
  assert.ok(fulls<=Object.keys(ids).length+accessChanges,`full downloads ${fulls}, access changes ${accessChanges}`);assert.ok(deltas>20,`deltas ${deltas}`);
  assert.ok(!logs.flat().some(entry=>entry.route==='rpc/trt_snapshot'));
 }finally{await pg.close();}
}));
