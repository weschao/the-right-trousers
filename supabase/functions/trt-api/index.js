import {emptyData,validateData,opponentPerspective} from '../../../web/core.js';
import {permits,editorLibrary,visibleTeams} from '../../../web/access.js';
import {playerProjection} from '../../../web/player-projection.js';

export function createApi({url,serviceKey,fetcher=fetch}){
 const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store','Content-Type':'application/json'};
 const respond=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
 // void RPCs answer 204 with an empty body
 async function db(path,body){const response=await fetcher(url+'/rest/v1/'+path,{method:body===undefined?'GET':'POST',headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const text=await response.text(),value=text?JSON.parse(text):null;if(!response.ok){const error=new Error(value.message||'Database request failed');error.status=value.code==='40001'?409:value.code==='42501'?403:value.code==='22023'?400:500;throw error;}return value;}
 function unpack(rows){const library=emptyData();for(const row of rows){if(row.deleted)continue;if(row.kind==='settings')library.settings=row.payload;else library[{team:'teams',game:'games',source:'sources'}[row.kind]].push(row.payload);}return library;}
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
   if(input.action==='members'){
    if(!admin)return respond({error:'Admin required'},403);
    const users=[];for(let page=1;;page++){const response=await fetcher(url+`/auth/v1/admin/users?page=${page}&per_page=100`,{headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey}});if(!response.ok)throw new Error('Unable to load users');const result=await response.json();users.push(...result.users.map(u=>({id:u.id,email:u.email})));if(result.users.length<100)break;}
    return respond({users,admins:(await db('trt_admins')).map(row=>row.user_id),memberships:await db('trt_memberships?library_id=eq.'+encodeURIComponent(libraryId)),pendingMemberships:await db('trt_email_memberships?library_id=eq.'+encodeURIComponent(libraryId))});
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
   const snapshot=await db('rpc/trt_snapshot',{p_library:libraryId}),rows=snapshot.entities,library=unpack(rows);
   if(input.action==='library'){
    const filtered=editorLibrary(context,library),keys=new Set([...filtered.teams.map(t=>'team:'+t.id),...filtered.games.map(g=>'game:'+g.id),...filtered.sources.map(s=>'source:'+s.id),'settings:settings']);
    return respond({data:filtered,revision:snapshot.revision,versions:Object.fromEntries(rows.filter(r=>keys.has(r.kind+':'+r.id)).map(r=>[r.kind+':'+r.id,r.revision])),context,teams:visibleTeams(context,library.teams).map(t=>({id:t.id,name:t.name,players:t.players.map(({id,name,number,gender})=>({id,name,number,gender}))}))});
   }
   if(input.action==='player'){
    if(!permits(context,'players.read',input.teamId))return respond({error:'Player unavailable'},403);
    const huckYards=Number(input.huckYards??35);if(!Number.isFinite(huckYards)||huckYards<0||huckYards>1000||!Array.isArray(input.gameIds||[])||(input.gameIds||[]).some(id=>typeof id!=='string'))return respond({error:'Invalid filters'},400);
    return respond(playerProjection(library,input.teamId,input.playerId,{gameIds:input.gameIds||[],huckYards}));
   }
   if(input.action==='save'){
    if(!Array.isArray(input.changes)||input.changes.length>2000)return respond({error:'Invalid changes'},400);
    const next=structuredClone(library),keys=new Set();
    for(const c of input.changes){
     const key=c.kind+':'+c.id;if(keys.has(key)||!['team','game','source','settings'].includes(c.kind)||typeof c.id!=='string'||!Number.isSafeInteger(c.revision)||c.revision<0)return respond({error:'Invalid change'},400);keys.add(key);
     const old=rows.find(r=>r.kind===c.kind&&r.id===c.id);
     if(c.kind==='game'&&!c.deleted&&old&&c.payload?.teamId!==old.team_id&&c.payload?.teamId===old.payload.opponentTeamId&&c.payload?.opponentTeamId===old.team_id){c.payload=opponentPerspective(c.payload,library.teams);delete c.payload.opponentPerspective;}
     const teamId=c.deleted?old?.team_id:c.kind==='team'?c.id:c.payload?.teamId;
     const permission=c.kind==='game'?(c.deleted?'games.delete':old?'games.update':'games.create'):c.kind==='team'?'teams.update':c.kind==='settings'?'settings.update':'library.read';
     const primaryTeam=c.kind==='game'&&old?old.team_id:teamId;
     if(!permits(context,permission,primaryTeam??null)&&!(c.kind==='game'&&old&&permits(context,permission,old.payload.opponentTeamId)))return respond({error:'You do not have permission to make this change'},403);
     if(c.kind==='settings'){if(c.deleted)return respond({error:'Settings cannot be deleted'},400);next.settings=c.payload;continue;}
     const collection={team:'teams',game:'games',source:'sources'}[c.kind];next[collection]=next[collection].filter(item=>item.id!==c.id);
     if(!c.deleted){if(c.payload?.id!==c.id)return respond({error:'Invalid record ID'},400);next[collection].push(c.payload);}
    }
    validateData(next);
    const result=await db('rpc/trt_apply_changes',{p_user:user.id,p_library:libraryId,p_changes:input.changes});return respond({versions:result});
   }
   return respond({error:'Unknown action'},400);
  }catch(error){return respond({error:error.status?error.message:error.message?.startsWith('Invalid game file:')?error.message:'Request failed'},error.status||((error instanceof SyntaxError||error.message?.startsWith('Invalid game file:'))?400:500));}
 };
}
if(typeof Deno!=='undefined')Deno.serve(createApi({url:Deno.env.get('SUPABASE_URL'),serviceKey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}));
