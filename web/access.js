import {opponentPerspective} from './core.js';
// Roles are permission bundles. Team memberships can be combined with a library role.
export const ROLE_PERMISSIONS=Object.freeze({
 player:['players.read'],
 stats:['players.read','games.read','games.create','games.update'],
 leadership:['players.read','games.read','games.create','games.update','games.delete','teams.update','library.read','library.export','settings.update']
});
export function permits(context,permission,teamId=null){
 if(context?.admin)return true;
 return (context?.memberships||[]).some(member=>(member.team_id===null||member.team_id===teamId)&&(ROLE_PERMISSIONS[member.role]||[]).includes(permission));
}
export function hasPermission(context,permission){return !!context?.admin||(context?.memberships||[]).some(member=>(ROLE_PERMISSIONS[member.role]||[]).includes(permission));}
export function visibleTeams(context,teams){return teams.filter(team=>permits(context,'players.read',team.id));}
export function editorLibrary(context,library){
 const teams=visibleTeams(context,library.teams).map(team=>permits(context,'games.read',team.id)?team:{id:team.id,name:team.name,logo:team.logo,players:team.players.map(({id,name,number,gender})=>({id,name,number,gender}))}),ids=new Set(teams.filter(team=>permits(context,'games.read',team.id)).map(team=>team.id));
 // A shared game is shown from an authorized team's side. The API converts edits
 // back to its canonical recording side before validating and saving them.
 const games=library.games.filter(game=>ids.has(game.teamId)||ids.has(game.opponentTeamId)).map(game=>ids.has(game.teamId)?game:opponentPerspective(game,library.teams));
 return {...library,teams,games,sources:permits(context,'library.read')?library.sources:[]};
}
// manage access table: one row per membership, plus signed-in users with no access yet
export function accessRows(members){
 // admins: older API deploys omit the field, so the page keeps working until the edge function is redeployed
 const emailOf=new Map(members.users.map(user=>[user.id,user.email])),admins=new Set(members.admins||[]),granted=new Set([...members.memberships.map(membership=>membership.user_id),...admins]);
 const usageOf=new Map((members.usage||[]).map(row=>[row.user_id,row])),rows=[...members.memberships.map(membership=>({email:emailOf.get(membership.user_id)||membership.user_id,userId:membership.user_id,teamId:membership.team_id,role:membership.role,status:'signed in'})),...(members.pendingMemberships||[]).map(membership=>({email:membership.email,teamId:membership.team_id,role:membership.role,status:'pending'})),...members.users.filter(user=>admins.has(user.id)).map(user=>({email:user.email,userId:user.id,teamId:null,role:'admin',status:'signed in'})),...members.users.filter(user=>!granted.has(user.id)).map(user=>({email:user.email,userId:user.id,teamId:null,role:null,status:'signed in'}))];
 rows.sort((a,b)=>a.email.localeCompare(b.email)||(a.teamId??'').localeCompare(b.teamId??''));
 // usage belongs to the user, so only their first row carries it
 const shown=new Set();
 for(const row of rows){const usage=row.userId&&!shown.has(row.userId)?usageOf.get(row.userId):null;if(row.userId)shown.add(row.userId);row.viewingSeconds=usage?Number(usage.viewing_seconds):null;row.totalSeconds=usage?Number(usage.total_seconds):null;}
 return rows;
}
export function formatDuration(seconds){if(seconds==null)return '—';const minutes=Math.round(seconds/60);return minutes<60?minutes+'m':Math.floor(minutes/60)+'h '+String(minutes%60).padStart(2,'0')+'m';}
