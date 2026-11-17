import {pointsOf} from './core.js';
import {timestampSeconds,importedPointTimestamps} from './video.js';

// Point timestamps are stored on Veo's clock; exported footage starts at source
// second zero. Keep minutes unbounded (e.g. 90:15), as in the requested MM:SS file.
export function pointTimestampFile(game,{offset=0}={}){
 const points=pointsOf(game),imported=importedPointTimestamps(game),score=[0,0],lines=[],missingPoints=[];
 points.forEach((point,index)=>{
  const stored=timestampSeconds(point.videoTimestamp)??(Number.isFinite(point.veoSeconds)?point.veoSeconds:null)??timestampSeconds(imported[index]);
  const seconds=stored===null?null:stored-offset;
  if(seconds===null||seconds<0)missingPoints.push(index+1);
  else{
   const whole=Math.floor(seconds),time=`${Math.floor(whole/60)}:${String(whole%60).padStart(2,'0')}`;
   lines.push(`${time} ${score[0]}-${score[1]} ${point.starting==='D'?'pull':'receive'}`);
  }
  if(point.winner==='us')score[0]++;
  if(point.winner==='them')score[1]++;
 });
 return {text:lines.length?lines.join('\n')+'\n':'',missingPoints};
}
export function timestampFileName(videoName){return String(videoName).replace(/\.mp4$/i,'')+'_timestamps.txt';}
export function downloadPointTimestampFile(data,videoName){
 const name=timestampFileName(videoName),url=URL.createObjectURL(new Blob([data.text],{type:'text/plain;charset=utf-8'})),link=document.createElement('a');
 link.href=url;link.download=name;document.body.append(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),60000);
 return name;
}
