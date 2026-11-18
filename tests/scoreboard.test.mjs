import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreboardData,scoreboardAvailable,scoreboardAt,jerseyColours,textColour,drawScoreboard,scoreboardLayout,dominantJersey,sampleStartingJerseys,SCOREBOARD_WIDTH,SCOREBOARD_HEIGHT} from '../web/scoreboard.js';
import {mirrorGame} from '../web/core.js';
const start=(starting,seconds)=>({type:'point_start',line:[],starting,direction:1,veoSeconds:seconds});
const play=(type,side,seconds,extra={})=>({type,side,veoSeconds:seconds,...extra});
const game=events=>({finished:true,teamId:'a',opponentTeamId:'b',opponent:'B',date:'2026-11-17T12:00:00',tournament:'Nationals',events,videoLink:'https://app.veo.co/matches/test/'});
const teams=[{id:'a',name:'Alpha',logo:'data:image/png;base64,logo'},{id:'b',name:'Beta'}];
test('score bug follows both sides, repeated turnovers, goals and backward seeks',()=>{
 const g=game([start('D',10),play('possession_start','them',11),play('pass','them',12,{outcome:'drop'}),play('possession_start','us',13),play('pass','us',14,{outcome:'throwaway'}),play('pass','them',15,{outcome:'block'}),play('pass','us',16,{outcome:'goal'}),play('point_end',null,17,{winner:'us'}),start('O',200),play('turnover','us',201),play('turnover','them',202),play('unattributed_goal','us',203)]),data=scoreboardData(g,teams);
 assert.equal(scoreboardAt(data,11).breakSide,null);assert.equal(scoreboardAt(data,12).breakSide,'us');assert.equal(scoreboardAt(data,14).breakSide,null);assert.equal(scoreboardAt(data,15).breakSide,'us');
 assert.deepEqual(scoreboardAt(data,16).score,[1,0]);assert.equal(scoreboardAt(data,16).breakSide,null);assert.deepEqual(scoreboardAt(data,110).score,[1,0]);
 assert.equal(scoreboardAt(data,201).breakSide,'them');assert.equal(scoreboardAt(data,202).breakSide,null);assert.deepEqual(scoreboardAt(data,203).score,[2,0]);assert.deepEqual(scoreboardAt(data,11).score,[0,0]);
 assert.match(data.caption,/Nov 17, 2026.*Nationals/);assert.equal(data.teams[0].logo,teams[0].logo);assert.equal(data.teams[1].name,'Beta');assert.equal(scoreboardData({...g,finished:false},teams),null);
});
test('Callahans score once and clear the break chance',()=>{
 const data=scoreboardData(game([start('O',0),play('turnover','us',5,{callahan:true}),play('point_end',null,6,{winner:'them'})]));assert.deepEqual(scoreboardAt(data,6).score,[0,1]);assert.equal(scoreboardAt(data,6).breakSide,null);
});
test('missing goal times use the next point minus 90 seconds and footage end for the last point',()=>{
 const data=scoreboardData(game([start('O',10),{type:'pass',side:'us',outcome:'goal'},start('D',200),{type:'unattributed_goal',side:'them'}]));assert.deepEqual(scoreboardAt(data,109,300).score,[0,0]);assert.deepEqual(scoreboardAt(data,110,300).score,[1,0]);assert.deepEqual(scoreboardAt(data,299,300).score,[1,0]);assert.deepEqual(scoreboardAt(data,300,300).score,[1,1]);
});
test('recorded Veo times and imported point timestamps share a clock',()=>{
 const g=game([{...start('D'),videoTimestamp:'1:00'},play('pass','them',65,{outcome:'drop'}),play('pass','us',70,{outcome:'goal'})]);const data=scoreboardData(g);assert.equal(scoreboardAt(data,64).breakSide,null);assert.equal(scoreboardAt(data,65).breakSide,'us');assert.deepEqual(scoreboardAt(data,70).score,[1,0]);
 const imported={...g,videoTimestamps:'1:00',events:[start('D'),play('pass','them',65,{outcome:'goal'})]};assert.deepEqual(scoreboardAt(scoreboardData(imported),64).score,[0,0]);
});
test('mixed jerseys use black against white and relative darkness otherwise; labels maximize contrast',()=>{
 assert.deepEqual(jerseyColours({us:{color:'#aa2244'}}),['#aa2244','#202124']);assert.deepEqual(jerseyColours({us:{mixed:true,color:'#bb7722'},them:{color:'#ffffff'}}),['#202124','#ffffff']);assert.deepEqual(jerseyColours({us:{color:'#ffffff'},them:{mixed:true,color:'#446699'}}),['#ffffff','#202124']);
 assert.deepEqual(jerseyColours({us:{mixed:true,color:'#556677'},them:{color:'#111122'}}),['#f4f4f4','#202124']);assert.deepEqual(jerseyColours({us:{mixed:true,color:'#112233'},them:{mixed:true,color:'#ccddff'}}),['#202124','#f4f4f4']);
 assert.equal(textColour('#ffffff'),'#000000');assert.equal(textColour('#101010'),'#ffffff');assert.equal(textColour('#ff0000'),'#000000');
});
test('logos, grey score boxes and break banner use the shared canvas renderer',()=>{
 const texts=[],fills=[],images=[],ctx={save(){},restore(){},beginPath(){},rect(){},clip(){},fillRect(...v){fills.push([this.fillStyle,...v]);},strokeRect(){},fillText(text){texts.push([this.fillStyle,text]);},measureText:t=>({width:t.length*18}),drawImage:(...args)=>images.push(args)};
 const data=scoreboardData(game([start('D',0),play('turnover','them',1)]),teams);drawScoreboard(ctx,data,scoreboardAt(data,1),new Map([[teams[0].logo,{width:100,height:50}]]));assert.equal(images.length,1);assert.equal(fills.filter(row=>row[0]==='#c9cbce').length,2);assert.ok(texts.some(row=>row[1].includes('BREAK')||row[1].includes('B R E A K')));assert.ok(texts.some(row=>row[1]==='ALPHA'));
});
test('opponent perspective swaps scoreboard kits and round trips',()=>{
 const g={...game([]),scoreboard:{us:{color:'#ffffff'},them:{color:'#123456',mixed:true}}};assert.deepEqual(mirrorGame(g).scoreboard,{us:g.scoreboard.them,them:g.scoreboard.us});assert.deepEqual(mirrorGame(mirrorGame(g)).scoreboard,g.scoreboard);
});

test('scoreboard requires a timestamp for every point, including imported timestamps',()=>{
 const g=game([start('O',10),play('pass','us',12,{outcome:'goal'}),start('D')]);assert.equal(scoreboardAvailable(g),false);assert.equal(scoreboardData(g),null);
 g.videoTimestamps='0:10\n0:20';assert.equal(scoreboardAvailable(g),true);assert.ok(scoreboardData(g));assert.equal(scoreboardData(game([])),null);
 const missing=game([start('O'),play('pass','us',12,{outcome:'goal'})]);assert.equal(scoreboardData(missing),null);
});
test('only team logos are shown; per-game logos are ignored',()=>{
 const g={...game([start('D',0)]),scoreboard:{us:{logo:'obsolete'}}};assert.equal(scoreboardData(g,teams).teams[0].logo,teams[0].logo);
});

test('edited timestamps take priority over the original captured clock',()=>{
 const g=game([{...start('D',10),videoTimestamp:'0:20'},play('pass','them',25,{outcome:'drop',videoTimestamp:'0:30'})]);const data=scoreboardData(g);assert.equal(scoreboardAt(data,26).breakSide,null);assert.equal(scoreboardAt(data,30).breakSide,'us');
});

test('recording clocks and timestamped pickups never estimate a break chance',()=>{
 const data=scoreboardData(game([start('D',100),{type:'turnover',side:'them',at:'2026-01-01T12:00:00Z'},play('possession_start','us',120),play('pass','us',130,{outcome:'complete'}),start('O',400),{type:'pass',side:'us',outcome:'drop',at:'2026-01-01T12:10:00Z'},play('possession_start','them',420)]));
 for(const time of [99,100,119,120,130,400,420])assert.equal(scoreboardAt(data,time).breakSide,null);
});
test('break chance requires a confirmed timestamped turnover and clears on uncertain possession changes',()=>{
 const data=scoreboardData(game([start('D',100),play('turnover','them',110),play('possession_start','us',111),play('pass','us',120,{outcome:'complete'}),play('pass','us',130,{outcome:'drop'}),play('pass','them',140,{outcome:'block'}),{type:'turnover',side:'us',at:'2026-01-01T12:00:00Z'},play('possession_start','us',160)]));assert.equal(scoreboardAt(data,110).breakSide,'us');assert.equal(scoreboardAt(data,120).breakSide,'us');assert.equal(scoreboardAt(data,130).breakSide,null);assert.equal(scoreboardAt(data,140).breakSide,null);assert.equal(scoreboardAt(data,160).breakSide,null);
});
test('a matching timestamped goal advances the score at the goal',()=>{
 const data=scoreboardData(game([start('O',400),play('possession_start','us',600),play('pass','us',650,{outcome:'goal'})]));assert.deepEqual(scoreboardAt(data,509).score,[0,0]);assert.deepEqual(scoreboardAt(data,650).score,[1,0]);assert.deepEqual(scoreboardAt(data,649).score,[0,0]);
});
test('scoreboard dimensions are half the old width and two thirds the old height',()=>{
 for(const width of [400,1200,2000]){const box=scoreboardLayout(width,800),oldWidth=Math.min(width*.92,1080);assert.equal(box.width,oldWidth/2);assert.ok(Math.abs(box.height-oldWidth*144/1200*2/3)<1e-9);}
});
test('automatic jersey colours reject grass and choose the dominant torso colour',()=>{
 const grass=[80,110,40],samples=Array.from({length:30},()=>({rgb:[240,241,238],background:grass}));samples.push(...Array.from({length:100},()=>({rgb:grass,background:grass})));assert.equal(dominantJersey(samples).color,'#f4f4f4');assert.equal(dominantJersey(Array.from({length:20},()=>({rgb:[200,32,40],background:grass}))).color,'#c82028');assert.equal(dominantJersey(Array.from({length:20},()=>({rgb:grass,background:grass}))),null);
});
test('first-point jersey sampling assigns the two goal lines using attack direction',()=>{
 const data=new Uint8ClampedArray(2048*2048*4);for(let i=0;i<data.length;i+=4)data.set([80,110,40,255],i);for(const [u,color] of [[600,[240,240,240,255]],[1400,[200,32,40,255]]])data.set(color,(300*2048+u)*4);
 const geometry={groundPlaneAt:()=>({down:[0,1,0],heightMetres:5}),fieldToDirection:(f,d,s,p)=>[p.x/110,1,0],sampleDirection:(lens,ray)=>[{u:ray[0]<2.5?600:1400,v:300}]},field={length:110,width:40,endzone:20};
 const result=sampleStartingJerseys({width:2048,height:2048,data},{},{},null,{seconds:10,direction:1},field,geometry);assert.equal(result.us.color,'#f4f4f4');assert.equal(result.them.color,'#c82028');const reverse=sampleStartingJerseys({width:2048,height:2048,data},{},{},null,{seconds:10,direction:-1},field,geometry);assert.equal(reverse.us.color,'#c82028');
});

test('automatic colours persist once and preserve manual overrides',async()=>{
 const {EnhancedTracker}=await import('../web/enhanced-tracker.js');const g={...game([start('D',0)]),scoreboard:{us:{color:'#224466',mixed:false}}};let saves=0,updates=0;
 const tracker={game:g,teams,api:{setScoreboard:()=>updates++},onSave:()=>saves++};
 EnhancedTracker.prototype.saveScoreboardColors.call(tracker,{us:{color:'#ffffff'},them:{color:'#dd2233',mixed:true}});assert.equal(g.scoreboard.us.color,'#224466');assert.deepEqual(g.scoreboard.them,{color:'#dd2233',mixed:true,source:'auto',sampleVersion:2});assert.equal(saves,1);assert.equal(updates,1);
 EnhancedTracker.prototype.saveScoreboardColors.call(tracker,{them:{color:'#000000'}});assert.equal(saves,1);assert.equal(g.scoreboard.them.color,'#dd2233');
});

test('compact panels use uniform text scaling and a 50% larger caption strip',()=>{
 const box=scoreboardLayout(1200,800);assert.equal(box.width/SCOREBOARD_WIDTH,box.height/SCOREBOARD_HEIGHT);
 const fills=[],texts=[],ctx={save(){},restore(){},beginPath(){},rect(){},clip(){},fillRect(...args){fills.push(args);},strokeRect(){},fillText(...args){texts.push({args,font:this.font});},measureText:t=>({width:t.length*15})};const data=scoreboardData(game([start('D',0)]),teams);drawScoreboard(ctx,data,scoreboardAt(data,0));assert.ok(fills.some(row=>row[1]===136&&row[3]===56));assert.ok(texts.every(t=>t.args.length===3));assert.ok(texts.some(t=>t.font==='700 34px Arial, sans-serif'));
});

test('jersey sampling works without cone calibration and keeps side assignment',()=>{
 const data=new Uint8ClampedArray(2048*2048*4);for(let i=0;i<data.length;i+=4)data.set([80,110,40,255],i);for(const [u,color] of [[600,[200,32,40,255]],[1400,[240,240,240,255]]]){data.set(color,(300*2048+u)*4);data.set([150,100,70,255],(297*2048+u)*4);data.set([30,40,50,255],(305*2048+u)*4);}
 const geometry={sampleDirection:(lens,ray)=>[{u:ray[0]<0?600:1400,v:300}]};const result=sampleStartingJerseys({width:2048,height:2048,data},{},null,null,{seconds:0,direction:-1},{aSide:'left'},geometry);assert.equal(result.us.color,'#f4f4f4');assert.equal(result.them.color,'#c82028');
});

test('a goal that conflicts with the next starting score uses the official result at the fallback time',()=>{
 const data=scoreboardData(game([start('O',100),play('pass','us',200,{outcome:'goal'}),play('point_end',null,210,{winner:'them'}),start('D',400)]));assert.deepEqual(scoreboardAt(data,200).score,[0,0]);assert.deepEqual(scoreboardAt(data,309).score,[0,0]);assert.deepEqual(scoreboardAt(data,310).score,[0,1]);
});
test('an inconsistent last goal waits until footage end; a matching last goal uses its timestamp',()=>{
 const bad=scoreboardData(game([start('O',100),play('pass','us',200,{outcome:'goal'}),play('point_end',null,210,{winner:'them'})]));assert.deepEqual(scoreboardAt(bad,299,300).score,[0,0]);assert.deepEqual(scoreboardAt(bad,300,300).score,[0,1]);
 const good=scoreboardData(game([start('O',100),play('pass','us',200,{outcome:'goal'}),play('point_end',null,210,{winner:'us'})]));assert.deepEqual(scoreboardAt(good,199,300).score,[0,0]);assert.deepEqual(scoreboardAt(good,200,300).score,[1,0]);
});
test('new automatic results replace old auto colors and recognizable legacy guesses, preserving manual choices',async()=>{
 const {EnhancedTracker}=await import('../web/enhanced-tracker.js'),g={...game([start('D',0)]),scoreboard:{us:{color:'#f4f4f4'},them:{color:'#345391'}}};let saves=0;const tracker={game:g,teams,api:{setScoreboard(){}},onSave:()=>saves++},fresh={us:{color:'#bb2233',mixed:false},them:{color:'#f4f4f4',mixed:false}},old={us:{color:'#f4f4f4',mixed:false},them:{color:'#f4f4f4',mixed:false}};
 EnhancedTracker.prototype.saveScoreboardColors.call(tracker,fresh,old);assert.equal(g.scoreboard.us.color,'#bb2233');assert.equal(g.scoreboard.them.color,'#f4f4f4');assert.equal(g.scoreboard.us.source,'auto');assert.equal(saves,1);assert.deepEqual(scoreboardData(g,teams).sampleSides,[]);
 g.scoreboard.us={color:'#f4f4f4',source:'manual'};g.scoreboard.them={color:'#112233',source:'auto',sampleVersion:1};EnhancedTracker.prototype.saveScoreboardColors.call(tracker,fresh,old);assert.equal(g.scoreboard.us.color,'#f4f4f4');assert.equal(g.scoreboard.them.color,'#f4f4f4');
});
test('coherent red and white player lines beat field markings and large blue background patches',()=>{
 const width=2048,data=new Uint8ClampedArray(width*2048*4);for(let i=0;i<data.length;i+=4)data.set([80,110,40,255],i);const rect=(x,y,w,h,c)=>{for(let a=y;a<y+h;a++)for(let b=x;b<x+w;b++)data.set([...c,255],(a*width+b)*4);};
 for(let n=0;n<5;n++)for(const [base,c] of [[450,[240,240,240]],[1300,[200,32,40]]]){const x=base+n*45,y=380+n*2;rect(x,y,12,24,c);rect(x,y+24,12,12,[25,40,90]);rect(x,y+36,12,8,[25,25,25]);}
 rect(1400,450,80,3,[240,240,240]);rect(700,420,90,60,[20,45,160]);const geometry={sampleDirection:(lens,ray)=>{const yaw=Math.atan2(ray[0],ray[2]);return [{u:(yaw<0?300:1100)+Math.abs(yaw)*400,v:350+Math.asin(ray[1])*500}];}};
 const result=sampleStartingJerseys({width,height:2048,data},{},null,null,{direction:-1},{aSide:'left'},geometry);assert.equal(result.us.color,'#c82028');assert.equal(result.them.color,'#f4f4f4');assert.equal(result.us.mixed,false);
});

test('an untimed final score reaches the last export frame at the source frame rate',()=>{
 const data=scoreboardData(game([start('O',0),{type:'point_end',winner:'us'}]));for(const rate of [5,25,30000/1001,60]){const last=2-1/rate;assert.deepEqual(scoreboardAt(data,last-1/rate,2,1/rate).score,[0,0]);assert.deepEqual(scoreboardAt(data,last,2,1/rate).score,[1,0]);}
});
