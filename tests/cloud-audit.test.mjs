import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const migrations=new URL('../supabase/migrations/',import.meta.url);
const admin='00000000-0000-4000-8000-000000000001';
const team={id:'team',name:'Team',players:[{id:'p1',name:'Player'}]},game={id:'game',teamId:'team',opponent:'Rival',events:[]};

test('audit rows record who changed which records, without copying payloads',async()=>{
 const pg=new PGlite();
 try{
  await pg.exec('create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);');
  const files=(await readdir(migrations)).filter(name=>name.endsWith('.sql')).sort(),slim=files.indexOf('202611200002_slim_audit.sql');
  assert.ok(slim>0);
  const apply=async names=>{for(const name of names)await pg.exec((await readFile(new URL(name,migrations),'utf8')).replace("notify pgrst, 'reload schema';",''));};
  await apply(files.slice(0,slim));
  await pg.query('insert into auth.users values($1,$2,now())',[admin,'weschao@gmail.com']);
  const libraryId=(await pg.query('select id from trt_libraries')).rows[0].id;
  const save=async changes=>(await pg.query('select trt_apply_changes($1,$2,$3::jsonb) as value',[admin,libraryId,JSON.stringify(changes)])).rows[0].value;
  const audits=async()=>(await pg.query('select id,changes from trt_audit order by id')).rows;

  // before: a save copies every payload into the audit
  await save([{kind:'team',id:'team',payload:team,revision:0},{kind:'game',id:'game',payload:game,revision:0}]);
  await pg.query('select trt_set_membership($1,$2,$3,$4,$5)',[admin,libraryId,admin,'team','stats']);
  const before=await audits();
  assert.deepEqual(before[0].changes.map(change=>change.payload.id),['team','game']);

  await apply(files.slice(slim));
  const after=await audits();
  // existing rows lose only their payloads, in order; rows without payloads are untouched
  assert.deepEqual(after[0].changes,[{kind:'team',id:'team',revision:0},{kind:'game',id:'game',revision:0}]);
  assert.deepEqual(after[1],before[1]);

  const edited={...game,opponent:'Renamed'};
  assert.deepEqual(await save([{kind:'game',id:'game',payload:edited,revision:1}]),[{kind:'game',id:'game',revision:2}]);
  await save([{kind:'game',id:'game',deleted:true,revision:2}]);
  const latest=(await audits()).slice(-2).map(row=>row.changes);
  assert.deepEqual(latest,[[{kind:'game',id:'game',revision:1}],[{kind:'game',id:'game',deleted:true,revision:2}]]);
  // the payload stays in trt_entities, including on the tombstone of a deleted record
  const stored=(await pg.query("select payload,revision,deleted from trt_entities where kind='game' and id='game'")).rows[0];
  assert.deepEqual(stored,{payload:edited,revision:3,deleted:true});
 }finally{await pg.close();}
});
