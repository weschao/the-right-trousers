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
