import {pointsOf,other,pullEvent} from './core.js';
import {timestampSeconds,importedPointTimestamps} from './video.js';

const colour=value=>/^#[\da-f]{6}$/i.test(value||'')?value:null;
export function luminance(hex){const rgb=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;}
export const textColour=background=>luminance(background)>.179?'#000000':'#ffffff';
export function jerseyColours(kits={}){
 const us=colour(kits.us?.color)||'#f4f4f4',them=colour(kits.them?.color)||'#202124',mixedUs=!!kits.us?.mixed,mixedThem=!!kits.them?.mixed;
 if(!mixedUs&&!mixedThem)return [us,them];
 if(mixedUs&&!mixedThem&&luminance(them)>.8)return ['#202124',them];
 if(mixedThem&&!mixedUs&&luminance(us)>.8)return [us,'#202124'];
 return luminance(us)>=luminance(them)?['#f4f4f4','#202124']:['#202124','#f4f4f4'];
}
const secondsOf=e=>timestampSeconds(e.videoTimestamp)??(Number.isFinite(e.veoSeconds)?e.veoSeconds:null);
const pointStarts=(game,points)=>{const imported=importedPointTimestamps(game);return points.map((p,i)=>secondsOf(p)??timestampSeconds(imported[i])??null);};
export function scoreboardAvailable(game){if(!game?.finished)return false;const points=pointsOf(game);return points.length>0&&pointStarts(game,points).every(t=>t!==null);}
export function scoreboardData(game,teams=[]){
 if(!game.finished)return null;
 const points=pointsOf(game),starts=pointStarts(game,points);if(!points.length||starts.some(t=>t===null))return null;
 const kits=game.scoreboard||{},colors=jerseyColours(kits),team=teams.find(t=>t.id===game.teamId),opponent=teams.find(t=>t.id===game.opponentTeamId);
 const names=[team?.name||'Our team',opponent?.name||game.opponent||'Opponent'],logos=[team?.logo??team?.logoUrl,opponent?.logo??opponent?.logoUrl];
 const totals=[0,0],startScores=points.map(point=>{const before=[...totals];if(point.winner)totals[point.winner==='us'?0:1]++;return before;});
 const changes=[{seconds:0,score:[0,0],breakSide:null}];
 points.forEach((point,index)=>{
  const start=starts[index];
  let side=point.starting==='D'?'them':'us',ended=false,confirmed=false,lastTime=start;const defense=other(side);
  changes.push({seconds:start,breakSide:null});
  point.events.forEach((e,i)=>{
   const seconds=secondsOf(e),turnover=e.type==='turnover'||e.type==='pass'&&!['complete','goal'].includes(e.outcome),goal=e.type==='pass'&&e.outcome==='goal'||e.type==='unattributed_goal'||e.type==='turnover'&&e.callahan||e.type==='point_end';
   if(seconds===null){if(turnover||goal||e.type==='possession_start'&&e.side!==side){confirmed=false;changes.push({seconds:lastTime,breakSide:null});}return;}
   lastTime=seconds;
   if(e.type==='possession_start')side=e.side;
   if(e.type==='pass')side=['complete','goal'].includes(e.outcome)?e.side:other(e.side);
   if(e.type==='turnover')side=other(e.side);
   if(turnover)confirmed=side===defense;
   if(goal){ended=true;confirmed=false;}
   changes.push({seconds,breakSide:!ended&&confirmed&&side===defense?side:null});
  });
  if(point.winner){
   const expected=startScores[index+1]||totals,goal=point.events.findLast(e=>e.type==='pass'&&e.outcome==='goal'||e.type==='unattributed_goal'||e.type==='turnover'&&e.callahan),goalSide=goal?.callahan?other(goal.side):goal?.side,goalSeconds=goal?secondsOf(goal):null,candidate=[...startScores[index]];
   if(goalSide==='us'||goalSide==='them')candidate[goalSide==='us'?0:1]++;
   const matches=goalSeconds!==null&&candidate.every((value,i)=>value===expected[i]);
   const seconds=matches?goalSeconds:index+1<starts.length?Math.max(0,starts[index+1]-90):Infinity;
   changes.push({seconds,score:[...expected]});
  }
 });
 changes.sort((a,b)=>a.seconds-b.seconds);let current={score:[0,0],breakSide:null};
 const rows=changes.map(change=>{current={...current,...change};return current;});
 const dateValue=String(game.date||'').slice(0,10),date=/^\d{4}-\d{2}-\d{2}$/.test(dateValue)?new Date(dateValue+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'';
 return {teams:names.map((name,i)=>({name,color:colors[i],logo:logos[i]||null})),caption:[date,game.tournament].filter(Boolean).join('  ·  '),rows,
  firstPoint:{seconds:secondsOf(pullEvent(points[0])||{})??starts[0],direction:points[0].direction||1},sampleSides:['us','them'].filter(side=>!colour(kits[side]?.color)||kits[side]?.source!=='manual'&&(kits[side]?.source!=='auto'||(kits[side]?.sampleVersion||0)<JERSEY_SAMPLE_VERSION))};
}
export function scoreboardAt(data,seconds,duration=Infinity,frameDuration=1001/30000){
 if(!data)return null;
 let lo=0,hi=data.rows.length;
 while(lo<hi){const mid=(lo+hi)>>1,time=data.rows[mid].seconds===Infinity?Math.max(0,duration-frameDuration-1e-6):data.rows[mid].seconds;if(time<=seconds)lo=mid+1;else hi=mid;}
 return data.rows[Math.max(0,lo-1)]||{score:[0,0],breakSide:null};
}
export async function loadScoreboardLogos(data){
 const images=new Map();
 await Promise.all((data?.teams||[]).map(async team=>{
  const src=team.logo;if(!src||images.has(src))return;
  try{const url=new URL(src,globalThis.location?.href);if(!['https:','http:','data:'].includes(url.protocol))return;const img=new Image();img.crossOrigin='anonymous';img.src=src;await img.decode();images.set(src,img);}catch{/* A missing logo must not prevent playback or export. */}
 }));return images;
}
export const SCOREBOARD_WIDTH=1200,SCOREBOARD_HEIGHT=192;
export function drawScoreboard(ctx,data,row,images=new Map()){
 if(!data||!row)return;
 ctx.save();ctx.textBaseline='middle';ctx.textAlign='left';
 const fit=(text,x,y,width,size,weight=800)=>{ctx.font=`${weight} ${size}px Arial, sans-serif`;while(size>12&&ctx.measureText(text).width>width){size--;ctx.font=`${weight} ${size}px Arial, sans-serif`;}ctx.save();ctx.beginPath();ctx.rect(x,y-27,width,54);ctx.clip();ctx.fillText(text,x,y);ctx.restore();};
 data.teams.forEach((team,i)=>{
  const x=i*600,breaking=row.breakSide===(i?'them':'us');
  ctx.fillStyle=team.color;ctx.fillRect(x,40,600,96);
  ctx.fillStyle='#c9cbce';ctx.fillRect(x+492,40,108,96);
  let nameX=x+22,nameWidth=450;const logo=images.get(team.logo);
  if(logo){const scale=Math.min(64/logo.width,64/logo.height);ctx.drawImage(logo,x+14+(64-logo.width*scale)/2,56+(64-logo.height*scale)/2,logo.width*scale,logo.height*scale);nameX=x+92;nameWidth=382;}
  ctx.fillStyle=textColour(team.color);fit(team.name.toUpperCase(),nameX,88,nameWidth,44);
  ctx.fillStyle='#090909';ctx.textAlign='center';ctx.font='800 72px Arial, sans-serif';ctx.fillText(String(row.score[i]),x+546,89);ctx.textAlign='left';
  if(breaking){ctx.fillStyle='#bd292f';ctx.fillRect(x,0,600,40);ctx.strokeStyle='#bd292f';ctx.lineWidth=4;ctx.strokeRect(x+2,40,596,94);ctx.fillStyle='#fff';ctx.textAlign='center';ctx.font='700 28px Arial, sans-serif';ctx.fillText('B R E A K   C H A N C E',x+300,21);ctx.textAlign='left';}
 });
 ctx.fillStyle='#e1e4e5';ctx.fillRect(0,136,1200,56);ctx.fillStyle='#28565a';ctx.textAlign='center';const caption=data.caption.toUpperCase();let size=34;ctx.font=`700 ${size}px Arial, sans-serif`;while(size>12&&ctx.measureText(caption).width>1168){size--;ctx.font=`700 ${size}px Arial, sans-serif`;}ctx.fillText(caption,600,164);ctx.restore();
}

// Keep the broadcast panel compact without squeezing its lettering.
export function scoreboardLayout(width,height){const w=Math.min(width*.92,1080)/2,h=w*SCOREBOARD_HEIGHT/SCOREBOARD_WIDTH;return {x:(width-w)/2,y:height-h-Math.max(10,height*.025),width:w,height:h};}

// Torso candidates are projected from the two starting goal lines. Reject grass
// and low-contrast background pixels, then use the dominant jersey colour family.
export function dominantJersey(samples){
 const groups=new Map();
 for(const {rgb,background} of samples){
  const [r,g,b]=rgb,max=Math.max(...rgb),min=Math.min(...rgb),delta=max-min;
  if(Math.hypot(...rgb.map((v,i)=>v-background[i]))<48)continue;
  if(g>r*1.08&&g>b*1.05)continue;
  const light=max>145&&delta<max*.35,dark=max<95&&delta<max*.4;
  let hue=0;if(delta)hue=(max===r?(g-b)/delta:max===g?2+(b-r)/delta:4+(r-g)/delta)*60;if(hue<0)hue+=360;
  const key=light?'white':dark?'black':delta>max*.28?hue<20||hue>340?'red':hue<55?'orange':hue<85?'yellow':hue<170?'green':hue<255?'blue':hue<285?'purple':'pink':null;if(!key)continue;
  if(!groups.has(key))groups.set(key,[]);groups.get(key).push(rgb);
 }
 const ranked=[...groups].sort((a,b)=>b[1].length-a[1].length);if(!ranked.length||ranked[0][1].length<8)return null;
 const [key,pixels]=ranked[0],rgb=[0,1,2].map(c=>pixels.map(p=>p[c]).sort((a,b)=>a-b)[Math.floor(pixels.length/2)]);
 return {color:key==='white'?'#f4f4f4':key==='black'?'#202124':'#'+rgb.map(v=>Math.round(v).toString(16).padStart(2,'0')).join(''),mixed:ranked.length>2&&ranked[2][1].length>pixels.length*.5};
}
export function sampleStartingJerseys(frame,lens,fit,drift,point,field,geometry){
 if(!fit)return sampleUncalibratedJerseys(frame,lens,point,field,geometry);
 const width=frame.width,height=frame.height,pixels=frame.data,seconds=point.seconds,plane=geometry.groundPlaneAt(fit,drift,seconds,field);
 const pixel=(u,v)=>{const x=Math.max(0,Math.min(width-1,Math.round(u*width/2048))),y=Math.max(0,Math.min(height-1,Math.round(v*height/2048))),i=(y*width+x)*4;return [pixels[i],pixels[i+1],pixels[i+2]];};
 const result={};
 for(const side of ['us','them']){
  const low=(point.direction===1)===(side==='us'),goal=low?field.endzone:field.length-field.endzone,samples=[];
  for(let x=goal-8;x<=goal+8;x+=1)for(let y=2;y<=field.width-2;y+=.65){
   const direction=geometry.fieldToDirection(fit,drift,seconds,{x,y}),descent=direction.reduce((sum,v,i)=>sum+v*plane.down[i],0);if(descent<=0)continue;
   for(const torso of [.85,1.15,1.45]){
    const ray=direction.map((v,i)=>v*plane.heightMetres/descent-plane.down[i]*torso),at=geometry.sampleDirection(lens,ray,null)[0];if(!at)continue;
    const around=[pixel(at.u-8,at.v),pixel(at.u+8,at.v),pixel(at.u,at.v+8)],background=[0,1,2].map(c=>around.map(p=>p[c]).sort((a,b)=>a-b)[1]);
    samples.push({rgb:pixel(at.u,at.v),background});
   }
  }
  const kit=dominantJersey(samples);if(kit)result[side]=kit;
 }
 return result;
}

// Without cones, find separate upright jersey patches in each starting half.
// Count players rather than raw pixels so tents, painted lines and shaded grass
// cannot outweigh a line of small players. White and its blue shade stay joined.
function sampleJerseyLines(frame,lens,point,field,geometry){
 const {width,height,data}=frame,result={},colorAt=i=>{const r=data[i*4],g=data[i*4+1],b=data[i*4+2],max=Math.max(r,g,b),min=Math.min(r,g,b);return r>g*1.35&&r>b*1.3&&r>65?1:b>r*1.25&&b>g*1.1&&b>60?2:max>145&&max-min<max*.35&&b>=r*.95&&b>=g*.9?3:0;};
 for(const side of ['us','them']){
  const low=(point.direction===1)===(side==='us'),left=low===(field.aSide!=='right'),locations=[];
  for(let yaw=.35;yaw<=1.4;yaw+=.04)for(const pitch of [.025,.3]){const a=left?-yaw:yaw,ray=[Math.sin(a)*Math.cos(pitch),Math.sin(pitch),Math.cos(a)*Math.cos(pitch)],at=geometry.sampleDirection(lens,ray,null)[0];if(at)locations.push(at);}
  if(!locations.length)continue;
  const x0=Math.max(0,Math.floor(Math.min(...locations.map(p=>p.u))*width/2048)),x1=Math.min(width-1,Math.ceil(Math.max(...locations.map(p=>p.u))*width/2048)),y0=Math.max(0,Math.floor(Math.min(...locations.map(p=>p.v))*height/2048)),y1=Math.min(height-1,Math.ceil(Math.max(...locations.map(p=>p.v))*height/2048)),w=x1-x0+1,h=y1-y0+1,mask=new Uint8Array(w*h),visited=new Uint8Array(w*h),scale=width/2048;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const i=(y+y0)*width+x+x0,key=colorAt(i);if(!key)continue;
   if(key===3){const d=Math.max(3,Math.round(12*scale)),l=(y+y0)*width+Math.max(0,x+x0-d),r=(y+y0)*width+Math.min(width-1,x+x0+d),distance=j=>Math.hypot(data[i*4]-data[j*4],data[i*4+1]-data[j*4+1],data[i*4+2]-data[j*4+2]);if(Math.max(distance(l),distance(r))<35)continue;}
   mask[y*w+x]=key;
  }
  const kits={red:[],blue:[],white:[]},stack=[];
  for(let seed=0;seed<mask.length;seed++){
   if(!mask[seed]||visited[seed])continue;visited[seed]=1;stack.push(seed);let minX=w,maxX=0,minY=h,maxY=0,count=0;const counts=[0,0,0,0],pixels=[];
   while(stack.length){const i=stack.pop(),x=i%w,y=Math.floor(i/w);count++;counts[mask[i]]++;pixels.push((y+y0)*width+x+x0);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const nx=x+dx,ny=y+dy,n=ny*w+nx;if(nx>=0&&nx<w&&ny>=0&&ny<h&&mask[n]&&!visited[n]){visited[n]=1;stack.push(n);}}
   }
   const pw=maxX-minX+1,ph=maxY-minY+1;if(count<30*scale*scale||pw<3*scale||ph<18*scale||pw>42*scale||ph>85*scale||ph<pw*.75)continue;
   const cx=x0+Math.round((minX+maxX)/2),bottom=y0+maxY;let legs=false;
   for(const d of [2,5,9,14]){const y=Math.min(height-1,bottom+Math.round(d*scale)),i=(y*width+cx)*4;if(Math.max(data[i],data[i+1],data[i+2])<125){legs=true;break;}}
   if(!legs)continue;
   const torso=pixels.filter(i=>Math.floor(i/width)<=y0+minY+ph*.6),top=[0,0,0,0];for(const i of torso)top[colorAt(i)]++;
   const key=top[1]>torso.length*.3?'red':top[3]>torso.length*.15?'white':'blue';kits[key].push({x:x0+(minX+maxX)/2,y:y0+maxY,h:ph,weight:Math.sqrt(count),pixels:torso.filter(i=>colorAt(i)===(key==='red'?1:key==='white'?3:2))});
  }
  const line=players=>{let best=[];for(let i=0;i<players.length;i++)for(let j=i+1;j<players.length;j++){const a=players[i],b=players[j],dx=b.x-a.x;if(Math.abs(dx)<25*scale)continue;const slope=(b.y-a.y)/dx;if(Math.abs(slope)>.5)continue;const height=(a.h+b.h)/2,group=players.filter(p=>p.h>height*.6&&p.h<height*1.6&&Math.abs(p.y-a.y-slope*(p.x-a.x))<Math.max(4*scale,p.h*.3)).sort((a,b)=>a.x-b.x),separate=group.filter((p,k)=>!k||p.x-group[k-1].x>6*scale);if(separate.length>best.length&&separate.length<=10)best=separate;}return best;};
  const ranked=Object.entries(kits).map(([key,all])=>{const players=line(all);return {key,players,weight:players.reduce((n,p)=>n+p.weight,0)};}).sort((a,b)=>b.players.length-a.players.length||b.weight-a.weight),best=ranked[0];if(best.players.length<2)continue;
  const pixels=best.players.flatMap(p=>p.pixels),rgb=[0,1,2].map(c=>pixels.map(i=>data[i*4+c]).sort((a,b)=>a-b)[Math.floor(pixels.length/2)]);
  result[side]={color:best.key==='white'?'#f4f4f4':'#'+rgb.map(v=>v.toString(16).padStart(2,'0')).join(''),mixed:false,players:best.players.length};
 }
 return result;
}

export const JERSEY_SAMPLE_VERSION=2;
export function sampleAngularJerseys(frame,lens,point,field,geometry){
 const pixel=(u,v)=>{const x=Math.max(0,Math.min(frame.width-1,Math.round(u*frame.width/2048))),y=Math.max(0,Math.min(frame.height-1,Math.round(v*frame.height/2048))),i=(y*frame.width+x)*4;return [frame.data[i],frame.data[i+1],frame.data[i+2]];},result={};
 for(const side of ['us','them']){
  const low=(point.direction===1)===(side==='us'),left=low===(field.aSide!=='right'),samples=[];
  for(let yaw=.4;yaw<=1.2;yaw+=.004)for(let pitch=.065;pitch<=.17;pitch+=.004){
   const a=left?-yaw:yaw,at=geometry.sampleDirection(lens,[Math.sin(a)*Math.cos(pitch),Math.sin(pitch),Math.cos(a)*Math.cos(pitch)],null)[0];if(!at)continue;
   const rgb=pixel(at.u,at.v),head=[3,5,8].map(d=>pixel(at.u,at.v-d)).some(([r,g,b])=>r>70&&r>g*.95&&r>b*1.25),legs=[5,8,12].map(d=>pixel(at.u,at.v+d)).some(p=>Math.max(...p)<110&&Math.hypot(...rgb.map((v,i)=>v-p[i]))>55);if(!legs||!head&&Math.max(...rgb)-Math.min(...rgb)<Math.max(...rgb)*.4)continue;
   const around=[pixel(at.u-8,at.v),pixel(at.u+8,at.v),pixel(at.u,at.v+8)],background=[0,1,2].map(c=>around.map(p=>p[c]).sort((a,b)=>a-b)[1]);samples.push({rgb,background});
  }
  const kit=dominantJersey(samples);if(kit)result[side]=kit;
 }
 if(result.us&&result.them){const rgb=side=>result[side].color.slice(1).match(/../g).map(v=>parseInt(v,16)),a=rgb('us'),b=rgb('them'),chroma=p=>p.map(v=>v/Math.hypot(...p)),similar=chroma(a).reduce((sum,v,i)=>sum+v*chroma(b)[i],0)>.96,light=luminance(result.us.color)>=luminance(result.them.color)?'us':'them',dark=other(light);if(similar&&luminance(result[light].color)>(luminance(result[dark].color)+.005)*2)result[light].color='#f4f4f4';}
 return result;
}
export function sampleUncalibratedJerseys(frame,lens,point,field,geometry){
 const lines=sampleJerseyLines(frame,lens,point,field,geometry),baseline=sampleAngularJerseys(frame,lens,point,field,geometry);
 if(lines.us?.players>=3&&lines.them?.players>=3){const rgb=side=>lines[side].color.slice(1).match(/../g).map(v=>parseInt(v,16)),a=rgb('us'),b=rgb('them'),similarity=a.reduce((n,v,i)=>n+v*b[i],0)/(Math.hypot(...a)*Math.hypot(...b));if(similarity<.96)return Object.fromEntries(['us','them'].map(side=>[side,{color:lines[side].color,mixed:lines[side].mixed}]));}
 return baseline;
}
