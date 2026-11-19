import test from 'node:test';
import assert from 'node:assert/strict';
import {logoSize,setTeamLogo,teamMark,teamLogoButton} from '../web/team-logo.js';
import {editorLibrary} from '../web/access.js';
import {scoreboardData} from '../web/scoreboard.js';
const esc=s=>String(s).replace(/"/g,'&quot;').replace(/</g,'&lt;'),initials=name=>name.slice(0,2).toUpperCase(),logo='data:image/png;base64,AAAA';
test('logos shrink to fit 256 px and never grow',()=>{
 assert.deepEqual(logoSize(1024,512),{width:256,height:128});assert.deepEqual(logoSize(300,1200),{width:64,height:256});assert.deepEqual(logoSize(40,20),{width:40,height:20});
});
test('a team without a logo shows a placeholder and its monogram; with one, the image',()=>{
 const team={id:'a',name:'Mischief'};
 assert.match(teamLogoButton(team,esc),/class="team-logo-button empty".*Add logo/);assert.match(teamMark(team,esc,initials),/monogram">MI</);
 setTeamLogo(team,logo,'2026-11-19T00:00:00Z');assert.equal(team.updatedAt,'2026-11-19T00:00:00Z');
 assert.match(teamLogoButton(team,esc),/title="Change logo"><img src="data:image\/png;base64,AAAA" alt="Mischief logo">/);assert.match(teamMark(team,esc,initials),/<img class="monogram team-logo-image" src="data:image\/png;base64,AAAA"/);
});
test('the logo reaches scoreboards and players-only viewers',()=>{
 const team={id:'a',name:'Mischief',logo,players:[]},library={teams:[team],games:[],sources:[]};
 assert.equal(editorLibrary({memberships:[{team_id:'a',role:'player'}]},library).teams[0].logo,logo);
 const game={id:'g',teamId:'a',opponent:'Them',finished:true,events:[{id:'p',type:'point_start',line:[],starting:'O',direction:1,videoTimestamp:'0:10'},{type:'point_end',winner:'us'}]};
 assert.equal(scoreboardData(game,[team]).teams[0].logo,logo);
});
