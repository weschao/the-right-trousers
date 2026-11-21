import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createApi} from '../supabase/functions/trt-api/index.js';
import {permits,hasPermission} from '../web/access.js';
import {changedRecords,CloudStore} from '../web/cloud.js';
import {emptyData,FIELD,advancedStatsFor,statsFor} from '../web/core.js';
import {playerProjection} from '../web/player-projection.js';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import * as core from '../web/core.js';

const ids={admin:'00000000-0000-4000-8000-000000000001',player:'00000000-0000-4000-8000-000000000002',stats:'00000000-0000-4000-8000-000000000003',leader:'00000000-0000-4000-8000-000000000004',unverified:'00000000-0000-4000-8000-000000000005'};
const teamA={id:'a',name:'Team A',players:[{id:'ann',name:'Ann'},{id:'bo',name:'Bo'}],privateSource:'must-not-leak'},teamB={id:'b',name:'Team B',players:[{id:'opp',name:'Opp'}]};
const game={id:'g',teamId:'a',opponent:'Team B',opponentTeamId:'b',date:'2026-11-16',finished:true,field:FIELD,opponents:teamB.players,videoLink:'https://www.youtube.com/watch?v=abcdefghijk',videoTimestamps:'',revisions:[{secret:'private-edit-history'}],events:[{id:'p',type:'point_start',line:['ann','bo'],opponentLine:['opp'],starting:'O',direction:1},{id:'pos',type:'possession_start',side:'us',playerId:'ann',location:{x:30,y:20}},{id:'pass',type:'pass',side:'us',throwerId:'ann',receiverId:'bo',opponentMarkerId:'opp',from:{x:30,y:20},to:{x:105,y:20},outcome:'goal',videoTimestamp:'1:23',notes:'Nice catch'},{id:'end',type:'point_end',winner:'us'}]};
const fixture=()=>({...emptyData(),teams:structuredClone([teamA,teamB]),games:structuredClone([game]),sources:[{id:'source',secret:'private-source-record'}]});

test('roles combine permissions by team without promoting a stats user on another team',()=>{const context={memberships:[{team_id:'a',role:'leadership'},{team_id:'b',role:'stats'}]};assert.equal(permits(context,'library.read','a'),true);assert.equal(permits(context,'library.read','b'),false);assert.equal(permits(context,'games.update','b'),true);assert.equal(permits(context,'teams.update','b'),false);assert.equal(permits(context,'library.read'),false);assert.equal(hasPermission(context,'library.read'),true);assert.equal(permits({admin:true},'library.read','anything'),true);});

test('PD projections match shared stat calculations and never return raw games',()=>{const data=fixture(),result=playerProjection(data,'a','bo'),row=statsFor(data.teams,data.games).find(r=>r.id==='bo'),advanced=advancedStatsFor(game,teamA).rows.find(r=>r.id==='bo');assert.equal(result.summary.goals,row.goals);assert.equal(result.summary.totalEdge,advanced.totalEdge);assert.equal(result.summary.totalEdgePerPoint,advanced.totalEdgePerPoint);assert.equal(result.clips.goals[0].videoUrl,'https://www.youtube.com/watch?v=abcdefghijk&t=83s');assert.equal(result.clips.goals[0].notes,'Nice catch');assert.equal(result.received[0].name,'Ann');const json=JSON.stringify(result);for(const privateValue of ['private-source-record','private-edit-history','must-not-leak','"events"','"revisions"','"passes"'])assert.equal(json.includes(privateValue),false,privateValue);assert.equal(playerProjection(data,'a','bo',{gameIds:['unavailable']}).summary.goals,0);});

test('server PD matchup numbers match the existing PD calculations on a recorded game',async()=>{
 const data=JSON.parse(await readFile(new URL('./fixtures/polar-bears-2026-10-06.json',import.meta.url),'utf8')),source=await readFile(new URL('../web/app.js',import.meta.url),'utf8'),extract=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
 const functions=[['function seasonAdvancedStats','function seasonAdvancedForTeams'],['function defenseEdgeComparisons','function guardedPointsByOpponent'],['function guardedPointsByOpponent','function totalDefenseEdgeComparison'],['function pointAdvancedRows',"// every player's breakdown"],['function cachedMatchupBreakdown','function gameOse'],['function gameOse','function pointScoreLabel'],['function seasonMatchupTables','// inserts an empty point']].map(([a,b])=>extract(a,b)).join('\n');
 for(const player of data.teams[0].players){const captured=[],context=vm.createContext({...core,data,huckYards:35,seasonOseCache:new Map(),matchupBreakdownCache:new Map(),pointAdvancedCache:new Map(),secondaryEdgeSettings:()=>({previousShare:data.settings.secondaryPreviousShare,previousPreviousShare:data.settings.secondaryPreviousPreviousShare,includeInTotal:data.settings.includeSecondaryInTotal}),relevantGames:()=>core.gamesForTeam(data,data.teams[0].id),OFFENSE_BREAKDOWN_HELP:'',DEFENSE_BREAKDOWN_HELP:'',SEASON_OFFENSE_BREAKDOWN_COLUMNS:[],DEFENSE_BREAKDOWN_COLUMNS:[],renderBreakdown:rows=>{captured.push(rows);return '';}});
  vm.runInContext(functions+`\nseasonMatchupTables(${JSON.stringify(player.id)})`,context);const projected=playerProjection(data,data.teams[0].id,player.id);
  for(const [index,side] of ['offense','defense'].entries()){assert.equal(projected.matchups[side].length,captured[index].length);for(const expected of captured[index]){const actual=projected.matchups[side].find(r=>r.opponentId===expected.opponentId&&r.teamName===expected.teamName);assert.ok(actual);for(const [key,value] of Object.entries(expected))if(typeof value==='number')assert.ok(Object.is(actual[key],value)||Math.abs(actual[key]-value)<1e-9,`${player.name} ${side} ${key}: ${actual[key]} != ${value}`);}}
 }
});

test('record diffs carry expected revisions and deletions without rewriting unchanged games',()=>{const before=fixture(),after=structuredClone(before);after.games[0].opponent='Changed';after.teams.pop();const changes=changedRecords(before,after,{'game:g':8,'team:b':3});assert.equal(changes.length,2);assert.equal(changes.find(c=>c.kind==='game').revision,8);assert.deepEqual(changes.find(c=>c.kind==='team'),{kind:'team',id:'b',deleted:true,revision:3});});

test('database policies, API scopes, atomic saves and stale clients',async t=>{
 const pg=new PGlite();
 try{
  await pg.exec('create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);');
  for(const name of ['202611160001_shared_library.sql','202611160002_initial_admin.sql','202611160003_email_memberships.sql','202611200001_usage.sql'])await pg.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
  for(const [role,id] of Object.entries(ids))await pg.query('insert into auth.users values($1,$2,$3)',[id,role==='admin'?'weschao@gmail.com':role+'@example.com',role==='unverified'?null:new Date().toISOString()]);
  const libraryId=(await pg.query('select id from trt_libraries')).rows[0].id;
  const save=async(user,changes)=>pg.query('select trt_apply_changes($1,$2,$3::jsonb) as value',[ids[user],libraryId,JSON.stringify(changes)]);
  const membership=async(user,team,role)=>pg.query('select trt_set_membership($1,$2,$3,$4,$5)',[ids.admin,libraryId,ids[user],team,role]);
  await save('admin',[...fixture().teams.map(payload=>({kind:'team',id:payload.id,payload,revision:0})),{kind:'game',id:'g',payload:game,revision:0},{kind:'source',id:'source',payload:fixture().sources[0],revision:0}]);
  await membership('player','a','player');await membership('stats','a','stats');await membership('leader','b','leadership');
  await t.test('only verified designated email receives admin',async()=>{assert.deepEqual((await pg.query('select user_id from trt_admins')).rows,[{user_id:ids.admin}]);await pg.query('insert into auth.users values($1,$2,null)',['00000000-0000-4000-8000-000000000006','WESCHAO@gmail.com']);assert.equal((await pg.query('select count(*)::int as n from trt_admins')).rows[0].n,1);});
  await t.test('authenticated clients cannot read raw tables or invoke privileged RPCs',async()=>{await pg.exec('set role authenticated');try{for(const query of ['select * from trt_entities','select * from trt_email_memberships',`select trt_set_email_membership('${ids.admin}','${libraryId}','someone@example.com',null,'leadership')`,`select trt_snapshot('${libraryId}')`,`select trt_permits('${ids.admin}','${libraryId}','library.read',null)`])await assert.rejects(pg.query(query),/permission denied/);}finally{await pg.exec('reset role');}});
  await t.test('stats cannot change rosters and failed transactions leave every record unchanged',async()=>{await assert.rejects(save('stats',[{kind:'game',id:'g',payload:{...game,opponent:'Would change'},revision:1},{kind:'team',id:'a',payload:{...teamA,name:'Forbidden'},revision:1}]),/Permission denied/);assert.equal((await pg.query("select payload->>'opponent' as opponent,revision from trt_entities where kind='game'")).rows[0].opponent,'Team B');});
  await t.test('stale updates and resurrection of deleted games are rejected',async()=>{await save('stats',[{kind:'game',id:'g',payload:{...game,opponent:'Updated'},revision:1}]);await assert.rejects(save('stats',[{kind:'game',id:'g',payload:game,revision:1}]),/Another user changed/);await save('admin',[{kind:'game',id:'g',deleted:true,revision:2}]);await assert.rejects(save('stats',[{kind:'game',id:'g',payload:game,revision:0}]),/Another user changed/);await save('admin',[{kind:'game',id:'g',payload:game,revision:3}]);});
  const fetcher=async(url,options={})=>{
  const requestLog=[];
   const u=new URL(url),body=options.body?JSON.parse(options.body):null;requestLog.push(u.pathname+u.search);const ok=(value,status=200)=>new Response(JSON.stringify(value),{status});
   if(u.pathname==='/auth/v1/user'){const role=options.headers.Authorization.replace('Bearer ','');if(!ids[role])return ok({error:'Unauthorized'},401);return ok((await pg.query('select * from auth.users where id=$1',[ids[role]])).rows[0]);}
   if(u.pathname==='/auth/v1/admin/users')return ok({users:Object.entries(ids).map(([role,id])=>({id,email:role+'@example.com'}))});
   try{
    const route=u.pathname.replace('/rest/v1/','');
    if(route.startsWith('rpc/')){const functionName=route.slice(4),args=Object.values(body),sql=`select ${functionName}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as value`;const value=(await pg.query(sql,args.map(value=>Array.isArray(value)?JSON.stringify(value):value))).rows[0].value;return value===null||value===""?new Response(null,{status:204}):ok(value);}
    assert.ok(['trt_admins','trt_libraries','trt_memberships','trt_email_memberships','trt_usage','trt_entities'].includes(route));const clauses=[],values=[];
    for(const [key,value] of u.searchParams){if(key==='order')continue;assert.match(key,/^[a-z_]+$/);if(value.startsWith('eq.')){values.push(value.slice(3));clauses.push(`${key}=$${values.length}`);}else if(value.startsWith('in.')){const inner=value.slice(4,-1),list=inner.startsWith('"')?[...inner.matchAll(/"((?:\\.|[^"\\])*)"/g)].map(match=>match[1].replace(/\\(.)/g,'$1')):inner.split(',');clauses.push(`${key} in (${list.map(v=>{values.push(v);return '$'+values.length;}).join(',')})`);}}
    return ok((await pg.query('select * from '+route+(clauses.length?' where '+clauses.join(' and '):''),values)).rows);
   }catch(error){return ok({message:error.message,code:error.code},400);}
  };
  const api=createApi({url:'https://example.supabase.co',serviceKey:'test-only',fetcher}),call=async(role,input)=>{const response=await api(new Request('https://example.supabase.co/functions/v1/trt-api',{method:'POST',headers:{Authorization:'Bearer '+role},body:JSON.stringify({libraryId,...input})}));return {status:response.status,value:await response.json()};};
  await t.test('usage accumulates per user and is listed to admins only',async()=>{
   assert.equal((await call('player',{action:'usage',totalSeconds:30,viewingSeconds:10})).status,200);
   assert.equal((await call('player',{action:'usage',totalSeconds:20,viewingSeconds:20})).status,200);
   assert.equal((await call('player',{action:'usage',totalSeconds:5,viewingSeconds:6})).status,400);
   assert.equal((await call('player',{action:'usage',totalSeconds:-1,viewingSeconds:0})).status,400);
   assert.equal((await call('player',{action:'members'})).status,403);
   const row=(await call('admin',{action:'members'})).value.usage.find(u=>u.user_id===ids.player);assert.deepEqual([Number(row.total_seconds),Number(row.viewing_seconds)],[50,30]);
  });
  await t.test('email grants can be updated and revoked before an account exists',async()=>{
   const grant=(email,teamId,role)=>call('admin',{action:'membership',email,teamId,role});
   assert.equal((await grant('  FUTURE@Example.com  ','a','player')).status,200);
   assert.equal((await grant('future@example.com','a','stats')).status,200);
   assert.equal((await grant('future@example.com',null,'player')).status,200);
   const listed=await call('admin',{action:'members'});assert.deepEqual(listed.value.admins,[ids.admin]);
   assert.equal(listed.status,200);
   assert.deepEqual(listed.value.pendingMemberships.map(m=>[m.email,m.team_id,m.role]).sort(),[['future@example.com',null,'player'],['future@example.com','a','stats']].sort());
   assert.equal((await pg.query('select count(*)::int as n from auth.users where email=$1',['future@example.com'])).rows[0].n,0);
   assert.equal((await grant('future@example.com',null,null)).status,200);
   assert.equal((await grant('cancelled@example.com',null,'leadership')).status,200);
   assert.equal((await grant('cancelled@example.com',null,null)).status,200);
   await pg.query('insert into auth.users values($1,$2,now())',['00000000-0000-4000-8000-000000000007','cancelled@example.com']);
   assert.equal((await pg.query('select count(*)::int as n from trt_memberships where user_id=$1',['00000000-0000-4000-8000-000000000007'])).rows[0].n,0);
  });
  await t.test('only a verified matching email claims pending grants and immediately gets its authorized library',async()=>{
   ids.future='00000000-0000-4000-8000-000000000008';
   await pg.query('insert into auth.users values($1,$2,null)',[ids.future,'FUTURE@example.com']);
   assert.equal((await pg.query('select count(*)::int as n from trt_memberships where user_id=$1',[ids.future])).rows[0].n,0);
   assert.equal((await call('future',{action:'context'})).status,403);
   await call('admin',{action:'membership',email:'future@example.com',teamId:'b',role:'player'});
   const otherLibrary=(await pg.query("insert into trt_libraries(name) values('Other library') returning id")).rows[0].id;
   assert.equal((await call('admin',{action:'membership',libraryId:otherLibrary,email:'future@example.com',teamId:null,role:'leadership'})).status,200);
   await pg.query('update auth.users set email_confirmed_at=now() where id=$1',[ids.future]);
   const context=await call('future',{action:'context'});
   assert.equal(context.status,200);assert.equal(context.value.admin,false);
   assert.equal(context.value.libraries.length,2);assert.equal(context.value.memberships.length,3);
   const library=await call('future',{action:'library'});
   assert.equal(library.status,200);assert.equal(library.value.data.games.length,1);
   assert.equal(library.value.context.memberships.find(m=>m.team_id==='a').role,'stats');
   assert.equal((await pg.query('select count(*)::int as n from trt_email_memberships where email=$1',['future@example.com'])).rows[0].n,0);
   await pg.query('update auth.users set email_confirmed_at=now() where id=$1',[ids.future]);
   assert.equal((await call('future',{action:'context'})).value.memberships.length,3);
  });
  await t.test('existing verified accounts receive email grants immediately and can have them removed',async()=>{
   assert.equal((await call('admin',{action:'membership',email:'FUTURE@example.com',teamId:'a',role:'leadership'})).status,200);
   assert.equal((await call('future',{action:'context'})).value.memberships.find(m=>m.team_id==='a').role,'leadership');
   assert.equal((await call('admin',{action:'membership',email:'future@example.com',teamId:'a',role:null})).status,200);
   assert.equal((await call('future',{action:'context'})).value.memberships.some(m=>m.team_id==='a'),false);
  });
  await t.test('first verified sign-in claims an email grant, while unrelated emails receive nothing',async()=>{
   await call('admin',{action:'membership',email:'new@example.com',teamId:null,role:'player'});
   ids.new='00000000-0000-4000-8000-000000000009';
   await pg.query('insert into auth.users values($1,$2,now())',[ids.new,'other@example.com']);
   assert.equal((await call('new',{action:'context'})).value.libraries.length,0);
   await pg.query('update auth.users set email=$1 where id=$2',['NEW@example.com',ids.new]);
   assert.equal((await call('new',{action:'context'})).value.memberships[0].role,'player');
   await call('admin',{action:'membership',email:'first@example.com',teamId:'a',role:'stats'});
   await pg.query('insert into auth.users values($1,$2,now())',['00000000-0000-4000-8000-000000000010','first@example.com']);
   assert.equal((await pg.query('select role from trt_memberships where user_id=$1',['00000000-0000-4000-8000-000000000010'])).rows[0].role,'stats');
  });
  await t.test('email changes and removals replace legacy grants on unverified accounts',async()=>{
   await membership('unverified','a','leadership');
   assert.equal((await call('admin',{action:'membership',email:'unverified@example.com',teamId:'a',role:'player'})).status,200);
   assert.equal((await pg.query('select count(*)::int as n from trt_memberships where user_id=$1',[ids.unverified])).rows[0].n,0);
   await membership('unverified','b','leadership');
   assert.equal((await call('admin',{action:'membership',email:'unverified@example.com',teamId:'b',role:null})).status,200);
   assert.equal((await pg.query('select count(*)::int as n from trt_memberships where user_id=$1',[ids.unverified])).rows[0].n,0);
   assert.equal((await call('admin',{action:'membership',email:'unverified@example.com',teamId:'a',role:null})).status,200);
  });
  await t.test('email grants enforce admin, scope and input validation on API and database paths',async()=>{
   for(const role of ['player','stats','leader'])assert.equal((await call(role,{action:'membership',email:'forbidden@example.com',teamId:null,role:'leadership'})).status,403);
   for(const email of ['',null,'no-at','two@@example.com','space in@example.com','x'.repeat(255)+'@example.com'])assert.equal((await call('admin',{action:'membership',email,teamId:null,role:'player'})).status,400);
   for(const [teamId,role] of [['a','admin'],['missing','player']])assert.equal((await call('admin',{action:'membership',email:'invalid@example.com',teamId,role})).status,400);
   await assert.rejects(pg.query('select trt_set_email_membership($1,$2,$3,$4,$5)',[ids.stats,libraryId,'forbidden@example.com',null,'leadership']),/Admin required/);
   await assert.rejects(pg.query('select trt_set_email_membership($1,$2,$3,$4,$5)',[ids.admin,libraryId,'bad email',null,'player']),/valid email/);
   assert.equal((await pg.query('select count(*)::int as n from trt_email_memberships')).rows[0].n,0);
   const audits=(await pg.query("select changes from trt_audit where changes->0->>'email'='future@example.com'")).rows;
   assert.ok(audits.some(a=>a.changes[0].action==='membership'));assert.ok(audits.some(a=>a.changes[0].action==='claim_membership'));
  });
  await t.test('players receive only their team directory and requested PD projection',async()=>{const result=await call('player',{action:'library'});assert.equal(result.status,200);assert.equal(result.value.data.games.length,0);assert.equal(result.value.data.sources.length,0);assert.deepEqual(result.value.data.teams.map(t=>t.id),['a']);assert.equal('privateSource' in result.value.data.teams[0],false);const pd=await call('player',{action:'player',teamId:'a',playerId:'bo'});assert.equal(pd.status,200);assert.equal(pd.value.summary.goals,1);assert.equal((await call('player',{action:'player',teamId:'b',playerId:'opp'})).status,403);});
  await t.test('stats have games but no source records or other-team access',async()=>{const result=await call('stats',{action:'library'});assert.equal(result.value.data.games.length,1);assert.equal(result.value.data.sources.length,0);assert.equal((await call('stats',{action:'members'})).status,403);assert.equal((await call('stats',{action:'save',changes:[{kind:'game',id:'g',payload:{...game,teamId:'b'},revision:4}]})).status,403);});
  await t.test('a linked opponent can view and edit the game from its own side without moving the canonical game',async()=>{const result=await call('leader',{action:'library'}),mirrored=result.value.data.games[0];assert.equal(mirrored.teamId,'b');assert.equal(mirrored.opponent,'Team A');assert.equal(mirrored.events.find(e=>e.id==='pass').side,'them');mirrored.events.find(e=>e.id==='pass').notes='Reviewed from Team B';const saved=await call('leader',{action:'save',changes:[{kind:'game',id:'g',payload:mirrored,revision:4}]});assert.equal(saved.status,200);const canonical=(await pg.query("select payload from trt_entities where kind='game'")).rows[0].payload;assert.equal(canonical.teamId,'a');assert.equal(canonical.events.find(e=>e.id==='pass').side,'us');assert.equal(canonical.events.find(e=>e.id==='pass').notes,'Reviewed from Team B');assert.equal('opponentPerspective' in canonical,false);});
  await t.test('all mutation paths enforce current identity and role',async()=>{assert.equal((await call('player',{action:'save',userId:ids.admin,changes:[{kind:'game',id:'g',payload:game,revision:4}]})).status,403);assert.equal((await call('stats',{action:'membership',userId:ids.stats,role:'leadership',teamId:null})).status,403);assert.equal((await call('unverified',{action:'context'})).status,403);assert.equal((await call('unknown',{action:'context'})).status,401);await membership('player','a',null);assert.equal((await call('player',{action:'player',teamId:'a',playerId:'bo'})).status,403);});
  await t.test('API reports conflicts without overwriting another save',async()=>{const result=await call('stats',{action:'save',changes:[{kind:'game',id:'g',payload:game,revision:1}]});assert.equal(result.status,409);});
 }finally{await pg.close();}
  const second={...structuredClone(game),id:'g2',events:structuredClone(game.events).map(e=>({...e,id:e.id+'-2'}))};
  const adminRequest=async(action,values={})=>{const result=await call('admin',{action,...values});if(result.status!==200)throw Object.assign(new Error(result.value.error),{status:result.status});return result.value;};
  const openStore=async()=>{const store=new CloudStore({enabled:true}),loaded=await adminRequest('library');store.libraryId=libraryId;store.request=adminRequest;store.versions=loaded.versions;store.baseline=structuredClone(loaded.data);store.revision=loaded.revision;return {store,data:structuredClone(loaded.data)};};
  await t.test('a save reads only the teams and the changed records, never the whole library',async()=>{
   assert.equal((await call('admin',{action:'save',changes:[{kind:'game',id:'g2',payload:second,revision:0}]})).status,200);
   const before=(await adminRequest('library')).versions['game:g2'];requestLog.length=0;
   assert.equal((await call('admin',{action:'save',changes:[{kind:'game',id:'g2',payload:{...second,opponent:'Narrow'},revision:before}]})).status,200);
   assert.ok(!requestLog.some(path=>path.includes('trt_snapshot')),'save must not load the full snapshot');
   const entityReads=requestLog.filter(path=>path.includes('trt_entities'));assert.ok(entityReads.some(path=>path.includes('kind=eq.team')));assert.ok(entityReads.some(path=>path.includes('kind=eq.game')&&path.includes('g2')&&!path.includes('%22g%22')),'only the changed game is read');
   assert.equal((await call('admin',{action:'save',changes:[{kind:'game',id:'g2',payload:{...second,teamId:'missing'},revision:before+1}]})).status,400);
   assert.equal((await call('admin',{action:'save',changes:[{kind:'game',id:'g2',payload:{...second,opponent:'Stale'},revision:before}]})).status,409);
  });
  await t.test('a save whose response was lost is recognised as committed, and later saves still work',async()=>{
   const {store,data}=await openStore();data.games.find(g=>g.id==='g2').opponent='Lost response';
   const real=store.request;let lose=true;store.request=async(action,values)=>{const result=await real(action,values);if(action==='save'&&lose){lose=false;throw Object.assign(new Error('The operation timed out'),{name:'TimeoutError'});}return result;};
   await store.save(data);assert.equal(store.failed,false);assert.equal(store.saving,0);assert.equal(store.versions['game:g2'],(await adminRequest('library')).versions['game:g2']);
   data.games.find(g=>g.id==='g2').opponent='After the lost response';await store.save(data);assert.equal(store.failed,false);
   assert.equal((await adminRequest('library')).data.games.find(g=>g.id==='g2').opponent,'After the lost response');
  });
  await t.test('a timeout before the server commits stays failed, and retrying then succeeds',async()=>{
   const {store,data}=await openStore();data.games.find(g=>g.id==='g2').opponent='Never reached';
   const real=store.request;let drop=true;store.request=async(action,values)=>{if(action==='save'&&drop){drop=false;throw Object.assign(new Error('The operation timed out'),{name:'TimeoutError'});}return real(action,values);};
   await assert.rejects(store.save(data),/timed out/);assert.equal(store.failed,true);
   await store.retry(data);assert.equal(store.failed,false);assert.equal((await adminRequest('library')).data.games.find(g=>g.id==='g2').opponent,'Never reached');
  });
  await t.test('a real conflict with another user is not mistaken for a lost response',async()=>{
   const {store,data}=await openStore(),other=await openStore();other.data.games.find(g=>g.id==='g2').opponent='Other user';await other.store.save(other.data);
   data.games.find(g=>g.id==='g2').opponent='Mine';await assert.rejects(store.save(data),/Another user changed/);assert.equal(store.failed,true);
   assert.equal((await adminRequest('library')).data.games.find(g=>g.id==='g2').opponent,'Other user');
  });
});

test('queued cloud saves stop after a conflict and preserve the acknowledged baseline',async()=>{const store=new CloudStore({enabled:true});store.baseline=fixture();store.request=async()=>{const error=new Error('conflict');error.status=409;throw error;};const a=fixture();a.games[0].opponent='First';const b=fixture();b.games[0].opponent='Second';await Promise.all([assert.rejects(store.save(a),/conflict/),assert.rejects(store.save(b),/Unsaved changes/)]);assert.equal(store.baseline.games[0].opponent,'Team B');assert.equal(store.failed,true);assert.equal(store.saving,0);});

test('Google PKCE ties the callback to this device and does not persist Google provider credentials',async()=>{
 const previous=Object.fromEntries(['localStorage','sessionStorage','location'].map(key=>[key,globalThis[key]])),items=new Map(),storage={getItem:key=>items.get(key)||null,setItem:(key,value)=>items.set(key,value),removeItem:key=>items.delete(key)};let destination;
 try{
  globalThis.localStorage=globalThis.sessionStorage=storage;globalThis.location={origin:'https://example.test',pathname:'/',assign:url=>destination=url};
  const store=new CloudStore({url:'https://project.supabase.co',nativeRedirect:'righttrousers://auth/callback'});
  await store.beginGoogle();const url=new URL(destination),pending=JSON.parse(items.get('right-trousers-pkce'));
  assert.equal(url.searchParams.get('provider'),'google');assert.equal(url.searchParams.get('redirect_to'),'https://example.test/');assert.equal(url.searchParams.get('code_challenge_method'),'s256');assert.equal(url.searchParams.get('code_challenge'),createHash('sha256').update(pending.verifier).digest('base64url'));
  store.auth=async(path,body)=>{assert.equal(path,'token?grant_type=pkce');assert.deepEqual(body,{auth_code:'single-use-code',code_verifier:pending.verifier});return {access_token:'access',refresh_token:'refresh',expires_in:3600,provider_token:'do-not-store',provider_refresh_token:'do-not-store'};};
  assert.equal(await store.finishGoogle('https://example.test/?code=single-use-code'),true);assert.equal(items.has('right-trousers-pkce'),false);assert.equal(items.get('right-trousers-auth').includes('do-not-store'),false);await assert.rejects(store.finishGoogle('https://example.test/?code=replay'),/Sign-in expired/);
  store.native=true;store.nativeBrowser={open:async({url})=>destination=url};await store.beginGoogle();assert.equal(new URL(destination).searchParams.get('redirect_to'),'righttrousers://auth/callback');
 }finally{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});

test('sign-in survives closing the site, and an expired refresh token returns to the sign-in screen',async()=>{
 const previous=Object.fromEntries(['localStorage','sessionStorage'].map(key=>[key,globalThis[key]])),persistent=new Map(),storage=items=>({getItem:key=>items.get(key)??null,setItem:(key,value)=>items.set(key,String(value)),removeItem:key=>items.delete(key)});
 try{
  globalThis.localStorage=storage(persistent);globalThis.sessionStorage=storage(new Map());
  const first=new CloudStore({url:'https://project.supabase.co'});first.remember({access_token:'access',refresh_token:'refresh',expires_in:3600});
  globalThis.sessionStorage=storage(new Map());
  const reopened=new CloudStore({url:'https://project.supabase.co'});assert.equal(await reopened.accessToken(),'access');
  // another tab rotated the token first: adopt it rather than reusing the old refresh token
  reopened.session.expires_at=0;persistent.set('right-trousers-auth',JSON.stringify({access_token:'other-tab',refresh_token:'rotated',expires_at:Date.now()/1000+3600}));reopened.auth=async()=>assert.fail('refreshed with a stale token');assert.equal(await reopened.accessToken(),'other-tab');
  reopened.session.expires_at=0;persistent.set('right-trousers-auth',JSON.stringify(reopened.session));reopened.auth=async()=>{throw Object.assign(new Error('Invalid Refresh Token'),{status:400});};await assert.rejects(reopened.accessToken(),error=>error.status===401);
  await reopened.signOut();assert.equal(persistent.has('right-trousers-auth'),false);
 }finally{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});
