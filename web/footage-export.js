import {Input,Output,UrlSource,MP4,QTFF,Mp4OutputFormat,StreamTarget,Conversion,Quality,canEncodeVideo} from './vendor/mediabunny.js';
import {sphericalMovieBox} from './spherical-mp4.js';

export function createFootageInput(url,sourceOptions={}){
 // Veo panorama URLs end in .mp4 and have video/mp4 MIME types, but some
 // files use the QuickTime "qt  " brand. Detect the container from its bytes.
 return new Input({source:new UrlSource(url,{getRetryDelay:()=>null,...sourceOptions}),formats:[MP4,QTFF]});
}

export function exportTimeRemaining(progress,elapsedSeconds){
 if(progress>=1)return 'Finishing…';
 if(!(progress>0)||!(elapsedSeconds>=1))return 'Estimating time remaining…';
 const seconds=Math.ceil(elapsedSeconds*(1-progress)/progress);
 if(!Number.isFinite(seconds))return 'Estimating time remaining…';
 const hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60);
 const duration=hours?`${hours}h ${minutes}m`:minutes?`${minutes}m ${seconds%60}s`:`${seconds}s`;
 return `~${duration} remaining`;
}

export function createFootageFileOutput(writable,width,height){
 let movie=null,moviePosition=null;
 // Keep only small write chunks and the sample tables in memory. The wrapper
 // stays independent of the file stream so we can add metadata before committing.
 const stream=new WritableStream({write:chunk=>writable.write(chunk)});
 const output=new Output({target:new StreamTarget(stream,{chunked:true,chunkSize:4*1024*1024}),
  format:new Mp4OutputFormat({fastStart:false,onMoov:(data,position)=>{
   movie=sphericalMovieBox(data,width,height);moviePosition=position;
  }})});
 return {output,async finish(){
  if(!movie||moviePosition===null)throw Error('The export did not produce MP4 movie metadata.');
  // moov is last, so growing it never shifts stco/co64 media offsets, even for
  // multi-gigabyte games. Never read or rebuild the media payload.
  await writable.write({type:'write',position:moviePosition,data:movie});
  await writable.truncate(moviePosition+movie.byteLength);
 }};
}
const columnMajor = m => [0,1,2].flatMap(c=>m.map(r=>r[c]));
const unit=a=>a.map(v=>v/Math.hypot(...a));
// Keep the horizon level even if the camera was tilted. The field stays in front,
// with the unrecorded rear hemisphere behind the initial YouTube viewport.
export function horizonRotation(plane){
 const down=plane?unit(plane.down):[0,1,0];
 const forward=unit([0,0,1].map((v,i)=>v-down[i]*down[2]));
 const right=[down[1]*forward[2]-down[2]*forward[1],down[2]*forward[0]-down[0]*forward[2],down[0]*forward[1]-down[1]*forward[0]];
 return [0,1,2].map(i=>[right[i],down[i],forward[i]]);
}
export function resolutionCandidates(sourceWidth,maxTextureSize){
 // A full sphere needs about twice the width of the two field-facing lenses.
 // Allow up to 8K to retain detail during spherical reprojection; never add padding.
 const maximum=Math.floor(Math.min(8192,sourceWidth*4,maxTextureSize)/4)*4;
 return [...new Set([maximum,7680,6144,5760,4096,3840,2560,1920,1280].filter(w=>w>0&&w<=maximum))].sort((a,b)=>b-a);
}
export async function selectFootageEncoding(sourceWidth,maxTextureSize,frameRate,probe=canEncodeVideo,checkCanceled=()=>{},canRender=()=>true){
 for(const width of resolutionCandidates(sourceWidth,maxTextureSize)){
  const height=width/2,quality=new Quality({bitrate:Math.min(100e6,Math.max(12e6,width*height*4))});
  checkCanceled();
  if(!canRender(width,height))continue;
  // Prefer H.264 at equal resolution, but don't throw away detail when a
  // YouTube-supported HEVC or AV1 encoder can produce a larger panorama.
  for(const codec of ['avc','hevc','av1']){
   checkCanceled();
   if(await probe(codec,{width,height,quality,frameRate}))return {width,height,quality,codec};
  }
 }
 throw Error('This browser has no suitable MP4 video encoder. Try a current desktop Chrome or Edge browser.');
}
export function createFootageRenderer({vertexShader,fragmentShader,lens,geometry}){
 const canvas=document.createElement('canvas');
 const gl=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,alpha:false});
 if(!gl)throw Error('Footage export needs WebGL 2. Try a current desktop Chrome or Edge browser.');
 const program=gl.createProgram(),shaders=[],buffer=gl.createBuffer(),texture=gl.createTexture();
 const dispose=()=>{gl.deleteTexture(texture);gl.deleteBuffer(buffer);gl.deleteProgram(program);shaders.forEach(s=>gl.deleteShader(s));gl.getExtension('WEBGL_lose_context')?.loseContext();canvas.width=canvas.height=1;};
 try{
  for(const [type,source] of [[gl.VERTEX_SHADER,vertexShader],[gl.FRAGMENT_SHADER,fragmentShader]]){
   const shader=gl.createShader(type);shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);
   if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));gl.attachShader(program,shader);
  }
  gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  const corner=gl.getAttribLocation(program,'corner');gl.enableVertexAttribArray(corner);gl.vertexAttribPointer(corner,2,gl.FLOAT,false,0,0);
  gl.bindTexture(gl.TEXTURE_2D,texture);
  for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,p,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameterf(gl.TEXTURE_2D,gl.TEXTURE_MAX_LOD,3);
  const at=name=>gl.getUniformLocation(program,name);
  gl.uniform1i(at('frame'),0);gl.uniform1f(at('pixelRatio'),1);gl.uniform1i(at('sphericalProjection'),1);
  gl.uniformMatrix3fv(at('rigToLens'),false,lens.lensToRig.flatMap(t=>columnMajor([0,1,2].map(r=>[0,1,2].map(c=>t[c][r])))));
  gl.uniform3fv(at('lensOrigin'),lens.lensToRig.flatMap(t=>t.slice(0,3).map(r=>r[3])));
  gl.uniform4fv(at('intrinsics'),lens.cameraMatrices.flatMap(m=>[m[0][0],m[1][1],m[0][2],m[1][2]]));
  gl.uniform1fv(at('distortion'),lens.distortions.flat());
  gl.uniform3f(at('rowMapping'),lens.verticalMapping.top_scale,lens.verticalMapping.knee_row,lens.verticalMapping.bottom_scale);
  gl.uniform1f(at('horizontalScale'),lens.horizontalScale);gl.uniform1f(at('feather'),geometry.FEATHER_PIXELS);
  gl.uniform1f(at('maximumRadiusSquared'),geometry.MAXIMUM_RADIUS_SQUARED);gl.uniform1f(at('minimumDepthFraction'),geometry.MINIMUM_DEPTH_FRACTION);
  const canRender=(width,height)=>{
   if(gl.isContextLost())throw Error('The graphics context was lost. Close other video tabs and retry the export.');
   if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
   // Chrome may silently shrink the drawing buffer below MAX_TEXTURE_SIZE
   // under its pixel/memory budget. VideoFrame captures that smaller buffer.
   return gl.drawingBufferWidth===width&&gl.drawingBufferHeight===height;
  };
  return {canvas,maxTextureSize:Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE),gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),...gl.getParameter(gl.MAX_VIEWPORT_DIMS)),
   canRender,
   draw(source,width,height,plane){
    if(!canRender(width,height))throw Error('The browser could not retain the export frame size. Close other video tabs and retry the export.');
    gl.viewport(0,0,width,height);gl.uniform2f(at('size'),width,height);gl.uniform1f(at('focal'),width/(2*Math.PI));
    gl.uniformMatrix3fv(at('viewRotation'),false,columnMajor(horizonRotation(plane)));
    gl.uniform4f(at('ground'),...(plane?[...plane.down,plane.heightMetres]:[0,0,0,0]));
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,source);gl.generateMipmap(gl.TEXTURE_2D);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    return canvas;
   },dispose};
 }catch(error){dispose();throw error;}
}

export async function exportFootage({url,writable,lens,vertexShader,fragmentShader,geometry,planeAt=()=>null,signal,onProgress=()=>{}}){
 if(!globalThis.VideoEncoder||!globalThis.VideoDecoder)throw Error('Footage export needs WebCodecs video encoding. Open EPT in a current desktop Chrome or Edge browser.');
 if(!writable)throw Error('Choose an MP4 file to save before exporting footage.');
 let input,output,conversion,renderer,committed=false;
 const canceled=()=>signal?.throwIfAborted();
 const cancel=()=>{conversion?.cancel().catch(()=>{});input?.dispose();};
 signal?.addEventListener('abort',cancel,{once:true});
 try{
  canceled();onProgress({message:'Reading the full game…',progress:0});
  input=createFootageInput(url);
  const track=await input.getPrimaryVideoTrack();canceled();
  if(!track)throw Error('The source footage has no video track.');
  const seconds=await track.computeDuration();canceled();
  if(!(await track.canDecode()))throw Error('This browser cannot decode the Veo footage. Try desktop Chrome or Edge.');
  renderer=createFootageRenderer({vertexShader,fragmentShader,lens,geometry});
  const stats=await track.computePacketStats(120);canceled();
  const frameRate=stats.averagePacketRate||30000/1001;
  const {width,height,quality,codec}=await selectFootageEncoding(track.displayWidth,renderer.maxTextureSize,frameRate,canEncodeVideo,canceled,renderer.canRender);
  const file=createFootageFileOutput(writable,width,height);output=file.output;
  conversion=await Conversion.init({input,output,tracks:'primary',trim:{start:0},showWarnings:false,
   video:{codec,quality,keyFrameInterval:2,processedWidth:width,processedHeight:height,process:sample=>{
    canceled();return renderer.draw(sample.toCanvasImageSource(),width,height,planeAt(sample.timestamp));
   }},audio:{codec:'aac'},tags:{title:'Veo footage — full game',comment:'The Right Trousers EPT · monoscopic equirectangular 360°'}});
  canceled();
  if(!conversion.isValid||!conversion.utilizedTracks.includes(track))throw Error('The source footage could not be converted to MP4 in this browser.');
  const audio=await input.getPrimaryAudioTrack();
  if(audio&&!conversion.utilizedTracks.includes(audio))throw Error('This browser cannot export the source audio. Try desktop Chrome or Edge.');
  const startedAt=performance.now();
  conversion.onProgress=progress=>{canceled();onProgress({width,height,progress,message:`Exporting full game · ${width} × ${height} · ${Math.floor(progress*100)}% · ${exportTimeRemaining(progress,(performance.now()-startedAt)/1000)} · Keep this tab open.`});};
  conversion.onProgress(0);
  await conversion.execute();canceled();
  onProgress({width,height,progress:1,message:'Adding YouTube 360° metadata…'});
  await file.finish();canceled();
  onProgress({width,height,progress:1,message:'Saving the full game…'});
  await writable.close();committed=true;
  return {width,height,codec,seconds};
 }catch(error){
  if(signal?.aborted)throw new DOMException('Export canceled','AbortError');
  // URLs may contain Veo's temporary credentials: keep upstream URLs out of UI errors.
  if(/fetch|network|403|401|404|HTTP/i.test(error.message))throw Error('The Veo footage could not be read. Refresh the video links with the Veo bookmark and retry.');
  throw error;
 }finally{
  signal?.removeEventListener('abort',cancel);
  if(conversion&&conversion.state!=='done')await conversion.cancel().catch(()=>{});
  if(output&&output.state!=='finalized'&&output.state!=='canceled')await output.cancel().catch(()=>{});
  input?.dispose();renderer?.dispose();
  if(!committed)await writable.abort().catch(()=>{});
 }
}
