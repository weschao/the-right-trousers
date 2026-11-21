import {emptyData,validateData,opponentPerspective} from '../../../web/core.js';
import {permits,editorLibrary} from '../../../web/access.js';
import {playerProjection} from '../../../web/player-projection.js';

const KINDS=['team','game','source','settings'];
// cached rows are shared by every request a worker serves, so a change in place must fail loudly
function deepFreeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const item of Object.values(value))deepFreeze(item);}return value;}

export function createApi({url,serviceKey,fetcher=fetch}){
 const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store','Content-Type':'application/json'};
 const respond=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
 // void RPCs answer 204 with an empty body
 async function db(path,body){const response=await fetcher(url+'/rest/v1/'+path,{method:body===undefined?'GET':'POST',headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const text=await response.text(),value=text?JSON.parse(text):null;if(!response.ok){const error=new Error(value.message||'Database request failed');error.status=value.code==='40001'?409:value.code==='42501'?403:value.code==='22023'?400:500;if(error.status===500)error.message+=' ('+path.split('?')[0]+')';throw error;}return value;}
 function unpack(rows){const library=emptyData();for(const row of rows){if(row.deleted)continue;if(row.kind==='settings')library.settings=row.payload;else library[{team:'teams',game:'games',source:'sources'}[row.kind]].push(row.payload);}return library;}
 const quote=value=>'"'+value.replace(/[\\"]/g,'\\$&')+'"',scope=libraryId=>'trt_entities?library_id=eq.'+encodeURIComponent(libraryId);
 async function rowsById(libraryId,kind,ids){const queries=[];for(let start=0;start<ids.length;start+=100)queries.push(db(scope(libraryId)+'&kind=eq.'+kind+'&id=in.('+encodeURIComponent(ids.slice(start,start+100).map(quote).join(','))+')'));return (await Promise.all(queries)).flat();}
 // every row of each library this worker has read, by kind:id. A request lists the rows' revisions without
 // their payloads and fetches only the rows that changed since, so a warm worker never rereads the whole library.
 const libraryRows=new Map();
 async function currentRows(libraryId){
  const cached=libraryRows.get(libraryId)||new Map(),index=await db(scope(libraryId)+'&select=kind,id,revision,deleted&order=kind.asc,id.asc');
  const stale=KINDS.map(kind=>index.filter(row=>row.kind===kind&&!row.deleted&&cached.get(kind+':'+row.id)?.revision!==row.revision).map(row=>row.id));
  const fetched=new Map((await Promise.all(KINDS.map((kind,position)=>rowsById(libraryId,kind,stale[position])))).flat().map(row=>[row.kind+':'+row.id,deepFreeze(row)]));
  const rows=new Map(index.map(row=>{const key=row.kind+':'+row.id,old=cached.get(key);return [key,fetched.get(key)||(old?.revision===row.revision?old:row)];}));
  libraryRows.set(libraryId,rows);return [...rows.values()];
 }
 // what this user may see, with a stamp per record that changes whenever the copy they receive does:
 // a game shown from the opponent's side also changes when the team that recorded it does
 function visibleView(context,rows){
  const filtered=editorLibrary(context,unpack(rows)),byKey=new Map(rows.map(row=>[row.kind+':'+row.id,row])),records=new Map(),versions={},stamps={};
  for(const [kind,list] of [['team',filtered.teams],['game',filtered.games],['source',filtered.sources]])for(const payload of list)records.set(kind+':'+payload.id,{kind,id:payload.id,payload});
  if(byKey.has('settings:settings'))records.set('settings:settings',{kind:'settings',id:'settings',payload:filtered.settings});
  for(const [key,record] of records){const row=byKey.get(key);versions[key]=row.revision;stamps[key]=record.kind==='game'&&record.payload.teamId!==row.payload.teamId?row.revision+':'+byKey.get('team:'+row.payload.teamId).revision:String(row.revision);}
  return {data:filtered,records,versions,stamps};
 }
 return async request=>{
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(request.method!=='POST')return respond({error:'POST required'},405);
  try{
   const token=request.headers.get('Authorization');if(!/^Bearer\s+\S+$/i.test(token||''))return respond({error:'Sign in required'},401);
   const auth=await fetcher(url+'/auth/v1/user',{headers:{Authorization:token,apikey:serviceKey}});if(!auth.ok)return respond({error:'Sign in required'},401);
   const user=await auth.json();if(!user.email_confirmed_at)return respond({error:'Verify your email before signing in'},403);
   const length=Number(request.headers.get('content-length')||0);if(length>50000000)return respond({error:'Request too large'},413);
   const raw=await request.text();if(raw.length>50000000)return respond({error:'Request too large'},413);
   const input=JSON.parse(raw),admin=(await db('trt_admins?user_id=eq.'+encodeURIComponent(user.id))).length>0;
   const memberships=await db('trt_memberships?user_id=eq.'+encodeURIComponent(user.id));
   const libraries=admin?await db('trt_libraries?order=name.asc'):memberships.length?await db('trt_libraries?id=in.('+[...new Set(memberships.map(m=>m.library_id))].join(',')+')&order=name.asc'):[];
   if(input.action==='context')return respond({user:{id:user.id,email:user.email},admin,libraries,memberships});
   const libraryId=input.libraryId;if(!libraries.some(l=>l.id===libraryId))return respond({error:'Library unavailable'},403);
   const context={admin,memberships:memberships.filter(m=>m.library_id===libraryId)};
   if(input.action==='usage'){
    const {totalSeconds,viewingSeconds}=input;if(![totalSeconds,viewingSeconds].every(value=>Number.isInteger(value)&&value>=0&&value<=3600)||viewingSeconds>totalSeconds)return respond({error:'Invalid usage'},400);
    await db('rpc/trt_add_usage',{p_user:user.id,p_library:libraryId,p_total:totalSeconds,p_viewing:viewingSeconds});return respond({saved:true});
   }
   if(input.action==='members'){
    if(!admin)return respond({error:'Admin required'},403);
    const users=[];for(let page=1;;page++){const response=await fetcher(url+`/auth/v1/admin/users?page=${page}&per_page=100`,{headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey}});if(!response.ok)throw new Error('Unable to load users');const result=await response.json();users.push(...result.users.map(u=>({id:u.id,email:u.email})));if(result.users.length<100)break;}
    return respond({users,admins:(await db('trt_admins')).map(row=>row.user_id),memberships:await db('trt_memberships?library_id=eq.'+encodeURIComponent(libraryId)),pendingMemberships:await db('trt_email_memberships?library_id=eq.'+encodeURIComponent(libraryId)),usage:await db('trt_usage?library_id=eq.'+encodeURIComponent(libraryId))});
   }
   if(input.action==='membership'){
    if(!admin)return respond({error:'Admin required'},403);
    if(!['player','stats','leadership',null].includes(input.role)||(input.teamId!==null&&typeof input.teamId!=='string'))return respond({error:'Invalid membership'},400);
    if(input.email!==undefined){
     const email=typeof input.email==='string'?input.email.trim().toLowerCase():'';if(email.length>254||!/^[^\s@]+@[^\s@]+$/.test(email))return respond({error:'Enter a valid email address'},400);
     await db('rpc/trt_set_email_membership',{p_actor:user.id,p_library:libraryId,p_email:email,p_team:input.teamId,p_role:input.role});
    }else{
     if(typeof input.userId!=='string')return respond({error:'Invalid membership'},400);
     await db('rpc/trt_set_membership',{p_actor:user.id,p_library:libraryId,p_user:input.userId,p_team:input.teamId,p_role:input.role});
    }
    return respond({saved:true});
   }
   // read before any row, so the rows a request returns are never older than this revision
   const revision=libraries.find(l=>l.id===libraryId).revision;
   if(input.action==='library'){
    const view=visibleView(context,await currentRows(libraryId));
    return respond({data:view.data,revision,versions:view.versions,stamps:view.stamps,context,teams:view.data.teams.map(t=>({id:t.id,name:t.name,players:t.players.map(({id,name,number,gender})=>({id,name,number,gender}))}))});
   }
   // the records whose stamp differs from the caller's copy, and the keys it holds that it may no longer see
   if(input.action==='changes'){
    const known=input.stamps;if(!known||typeof known!=='object'||Array.isArray(known)||Object.values(known).some(stamp=>typeof stamp!=='string'))return respond({error:'Invalid stamps'},400);
    const view=visibleView(context,await currentRows(libraryId)),changed=[...view.records.keys()].filter(key=>known[key]!==view.stamps[key]);
    return respond({revision,context,records:changed.map(key=>view.records.get(key)),removed:Object.keys(known).filter(key=>!view.records.has(key)),versions:Object.fromEntries(changed.map(key=>[key,view.versions[key]])),stamps:Object.fromEntries(changed.map(key=>[key,view.stamps[key]]))});
   }
   if(input.action==='player'){
    if(!permits(context,'players.read',input.teamId))return respond({error:'Player unavailable'},403);
    const huckYards=Number(input.huckYards??35);if(!Number.isFinite(huckYards)||huckYards<0||huckYards>1000||!Array.isArray(input.gameIds||[])||(input.gameIds||[]).some(id=>typeof id!=='string'))return respond({error:'Invalid filters'},400);
    return respond(playerProjection(unpack(await currentRows(libraryId)),input.teamId,input.playerId,{gameIds:input.gameIds||[],huckYards}));
   }
   if(input.action==='save'){
    if(!Array.isArray(input.changes)||input.changes.length>2000)return respond({error:'Invalid changes'},400);
    // a save only needs every team (roster and reference checks) plus the stored copy of each changed record,
    // so it never loads or revalidates the other games
    const changedIds=kind=>[...new Set(input.changes.filter(c=>c?.kind===kind&&typeof c.id==='string').map(c=>c.id))];
    const rows=(await Promise.all([db(scope(libraryId)+'&kind=eq.team'),rowsById(libraryId,'game',changedIds('game')),rowsById(libraryId,'source',changedIds('source'))])).flat(),library=unpack(rows);
    const next=structuredClone(library),keys=new Set(),converted=new Set();
    for(const c of input.changes){
     const key=c.kind+':'+c.id;if(keys.has(key)||!['team','game','source','settings'].includes(c.kind)||typeof c.id!=='string'||!Number.isSafeInteger(c.revision)||c.revision<0)return respond({error:'Invalid change'},400);keys.add(key);
     const old=rows.find(r=>r.kind===c.kind&&r.id===c.id);
     if(c.kind==='game'&&!c.deleted&&old&&c.payload?.teamId!==old.team_id&&c.payload?.teamId===old.payload.opponentTeamId&&c.payload?.opponentTeamId===old.team_id){c.payload=opponentPerspective(c.payload,library.teams);delete c.payload.opponentPerspective;converted.add(key);}
     const teamId=c.deleted?old?.team_id:c.kind==='team'?c.id:c.payload?.teamId;
     const permission=c.kind==='game'?(c.deleted?'games.delete':old?'games.update':'games.create'):c.kind==='team'?'teams.update':c.kind==='settings'?'settings.update':'library.read';
     const primaryTeam=c.kind==='game'&&old?old.team_id:teamId;
     if(!permits(context,permission,primaryTeam??null)&&!(c.kind==='game'&&old&&permits(context,permission,old.payload.opponentTeamId)))return respond({error:'You do not have permission to make this change'},403);
     if(c.kind==='settings'){if(c.deleted)return respond({error:'Settings cannot be deleted'},400);next.settings=c.payload;continue;}
     const collection={team:'teams',game:'games',source:'sources'}[c.kind];next[collection]=next[collection].filter(item=>item.id!==c.id);
     if(!c.deleted){if(c.payload?.id!==c.id)return respond({error:'Invalid record ID'},400);next[collection].push(c.payload);}
    }
    validateData(next);
    const result=await db('rpc/trt_apply_changes',{p_user:user.id,p_library:libraryId,p_changes:input.changes}),[saved]=await db('trt_libraries?id=eq.'+encodeURIComponent(libraryId)+'&select=revision');
    // the saved payloads are exactly what the caller holds, except a game converted back from the opponent's side,
    // so those get no stamp and the caller's next refresh fetches the server's copy
    const cached=libraryRows.get(libraryId),stamps={};
    for(const {kind,id,revision:stored} of result){const key=kind+':'+id,change=input.changes.find(c=>c.kind===kind&&c.id===id);cached?.set(key,deepFreeze({kind,id,revision:stored,deleted:!!change.deleted,payload:change.payload}));if(!change.deleted&&!converted.has(key))stamps[key]=String(stored);}
    return respond({versions:result,revision:saved.revision,stamps});
   }
   return respond({error:'Unknown action'},400);
  }catch(error){return respond({error:error.status?error.message:error.message?.startsWith('Invalid game file:')?error.message:'Request failed'},error.status||((error instanceof SyntaxError||error.message?.startsWith('Invalid game file:'))?400:500));}
 };
}
if(typeof Deno!=='undefined')Deno.serve(createApi({url:Deno.env.get('SUPABASE_URL'),serviceKey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}));
