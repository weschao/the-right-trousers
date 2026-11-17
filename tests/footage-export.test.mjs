import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {sphericalMp4,sphericalMovieBox} from '../web/spherical-mp4.js';
import {createFootageInput,createFootageFileOutput,exportTimeRemaining,horizonRotation,resolutionCandidates,selectFootageEncoding} from '../web/footage-export.js';
import {Conversion} from '../web/vendor/mediabunny.js';
const text=new TextEncoder();
const join=parts=>new Uint8Array(Buffer.concat(parts));
function box(type,...parts){const bytes=join(parts),header=new Uint8Array(8);new DataView(header.buffer).setUint32(0,bytes.length+8);header.set(text.encode(type),4);return join([header,bytes]);}
function children(bytes,start=0){const result=[];for(let at=start;at<bytes.length;){const n=new DataView(bytes.buffer,bytes.byteOffset+at).getUint32(0);assert.ok(n>=8);result.push({type:Buffer.from(bytes.subarray(at+4,at+8)).toString(),body:bytes.subarray(at+8,at+n),at});at+=n;}return result;}
const child=(bytes,type,start=0)=>children(bytes,start).find(b=>b.type===type).body;
const handler=type=>box('hdlr',new Uint8Array(8),text.encode(type));
test('export ETA handles startup, seconds, minutes, hours and finalization',()=>{
 assert.equal(exportTimeRemaining(0,10),'Estimating time remaining…');
 assert.equal(exportTimeRemaining(0.1,0.5),'Estimating time remaining…');
 assert.equal(exportTimeRemaining(0.5,20),'~20s remaining');
 assert.equal(exportTimeRemaining(0.25,30),'~1m 30s remaining');
 assert.equal(exportTimeRemaining(0.5,5400),'~1h 30m remaining');
 assert.equal(exportTimeRemaining(1,5400),'Finishing…');
});
test('Veo QuickTime containers are recognized despite their .mp4 URL and MIME type',async()=>{
 for(const [brand,format] of [['qt  ','QuickTime File Format'],['isom','MP4']]){
  // The qt header is the actual brand/version layout returned by Veo.
  const header=box('ftyp',text.encode(brand),new Uint8Array([32,5,3,0]),text.encode(brand));
  const input=createFootageInput('https://video.example/panorama/game.mp4',{fetchFn:async()=>new Response(header,{headers:{'Content-Type':'video/mp4','Content-Length':String(header.length)}})});
  try{assert.equal((await input.getFormat()).name,format);}finally{input.dispose();}
 }
});
function fixture(entry='avc1'){
 const sample=box(entry,new Uint8Array(78),box('avcC',new Uint8Array([1,2,3,4])));
 const offsets=new Uint8Array(12);new DataView(offsets.buffer).setUint32(4,1);new DataView(offsets.buffer).setUint32(8,16);
 const video=box('trak',box('mdia',handler('vide'),box('minf',box('stbl',box('stsd',new Uint8Array([0,0,0,0,0,0,0,1]),sample),box('stco',offsets)))));
 const audio=box('trak',box('mdia',handler('soun')));
 return {file:join([box('ftyp',text.encode('isom')),box('mdat',new Uint8Array([11,12,13,14])),box('moov',video,audio)]),audio};
}
test('YouTube export metadata preserves media bytes and offsets and tags only video',async()=>{
 const {file,audio}=fixture(),result=new Uint8Array(await sphericalMp4(file,8192,4096).arrayBuffer());
 const before=children(file),after=children(result);assert.deepEqual(after.map(b=>b.type),['ftyp','mdat','moov']);
 const moovAt=before.find(b=>b.type==='moov').at;assert.deepEqual(result.subarray(0,moovAt),file.subarray(0,moovAt));
 const tracks=children(child(result,'moov')),video=tracks[0].body;
 assert.deepEqual(box('trak',tracks[1].body),audio);
 const xml=Buffer.from(child(video,'uuid').subarray(16)).toString();
 assert.match(xml,/<GSpherical:Spherical>true/);assert.match(xml,/<GSpherical:ProjectionType>equirectangular/);assert.match(xml,/<GSpherical:FullPanoWidthPixels>8192/);
 const stbl=child(child(child(video,'mdia'),'minf'),'stbl');
 const oldStbl=child(child(child(children(child(file,'moov'))[0].body,'mdia'),'minf'),'stbl');
 assert.deepEqual(child(stbl,'stco'),child(oldStbl,'stco'));
 const avc1=child(child(stbl,'stsd'),'avc1',8);
 assert.deepEqual(child(avc1,'avcC',78),new Uint8Array([1,2,3,4]));
 assert.equal(child(avc1,'st3d',78)[4],0);
 const proj=child(child(avc1,'sv3d',78),'proj');assert.deepEqual(child(proj,'equi'),new Uint8Array(20));
});
test('all supported MP4 encoders receive V2 spherical metadata',async()=>{
 for(const entry of ['hvc1','hev1','av01']){
  const bytes=new Uint8Array(await sphericalMp4(fixture(entry).file,8192,4096).arrayBuffer());
  const track=children(child(bytes,'moov'))[0].body;
  const stbl=child(child(child(track,'mdia'),'minf'),'stbl');
  const sample=child(child(stbl,'stsd'),entry,8);
  assert.ok(child(child(child(sample,'sv3d',78),'proj'),'equi'));
 }
});
test('metadata injection refuses layouts that would invalidate chunk offsets',()=>{
 const {file}=fixture(),parts=children(file);
 assert.throws(()=>sphericalMp4(join([box('moov',parts[2].body),box('mdat',parts[1].body)]),4096,2048),/moov after mdat/);
 assert.throws(()=>sphericalMp4(file,1920,1080),/2:1/);
 assert.throws(()=>sphericalMp4(new Uint8Array([0,0]),4096,2048),/Incomplete/);
});
test('sphere resolution follows source detail and GPU limits, highest first',()=>{
 assert.equal(resolutionCandidates(2048,16384)[0],8192);
 assert.equal(resolutionCandidates(2048,4096)[0],4096);
 assert.equal(resolutionCandidates(256,16384)[0],1024);
 for(const width of resolutionCandidates(2048,6144)){assert.equal(width%4,0);assert.ok(width<=6144);}
});
test('higher-resolution HEVC and AV1 take precedence over a 4K H.264 limit',async()=>{
 for(const alternative of ['hevc','av1']){
  const chosen=await selectFootageEncoding(2048,16384,30,async(codec,config)=>codec===alternative||codec==='avc'&&config.width<=4096);
  assert.equal(chosen.width,8192);assert.equal(chosen.codec,alternative);
 }
 const fallback=await selectFootageEncoding(2048,16384,30,async(codec,config)=>codec==='avc'&&config.width<=4096);
 assert.equal(fallback.width,4096);assert.equal(fallback.codec,'avc');
 const preferred=await selectFootageEncoding(2048,16384,30,async()=>true);assert.equal(preferred.codec,'avc');
 await assert.rejects(selectFootageEncoding(2048,16384,30,async()=>false),/no suitable MP4/);
});
test('encoder selection rejects silently shrunken WebGL buffers',async()=>{
 const probed=[];
 const selected=await selectFootageEncoding(2048,16384,30,async(codec,{width})=>{probed.push(width);return true;},()=>{},(width,height)=>width<=7680&&height<=3840);
 assert.equal(selected.width,7680);assert.equal(selected.height,3840);
 assert.ok(!probed.includes(8192));
});
test('spherical reprojection levels a tilted camera with an orthonormal basis',()=>{
 const down=[0.2,0.97,0.1],rotation=horizonRotation({down}),normal=Math.hypot(...down);
 for(let i=0;i<3;i++)assert.ok(Math.abs(rotation[i][1]-down[i]/normal)<1e-12);
 const columns=[0,1,2].map(i=>rotation.map(row=>row[i]));
 for(let i=0;i<3;i++)for(let j=0;j<3;j++)assert.ok(Math.abs(columns[i].reduce((n,v,k)=>n+v*columns[j][k],0)-(i===j?1:0))<1e-12);
 assert.deepEqual(horizonRotation(null),[[1,0,0],[0,1,0],[0,0,1]]);
});

test('file output streams the complete source and adds spherical metadata before file commit',async()=>{
 const source=fs.readFileSync(new URL('./fixtures/footage-17s.mov',import.meta.url));
 const fromBytes=bytes=>createFootageInput('https://video.example/panorama/game.mp4',{fetchFn:async()=>new Response(bytes,{headers:{'Content-Length':String(bytes.length),'Content-Type':'video/mp4'}})});
 let bytes=new Uint8Array(),writes=0,closes=0;
 const writable={
  async write({data,position}){writes++;if(bytes.length<position+data.length){const grown=new Uint8Array(position+data.length);grown.set(bytes);bytes=grown;}bytes.set(data,position);},
  async truncate(size){bytes=bytes.slice(0,size);},async close(){closes++;}
 };
 const input=fromBytes(source),file=createFootageFileOutput(writable,4096,2048);
 try{
  const conversion=await Conversion.init({input,output:file.output,copy:{mode:'forced'},tracks:'primary',showWarnings:false});
  assert.equal(conversion.isValid,true);assert.equal(conversion.utilizedTracks.length,2);
  await conversion.execute();
  assert.ok(writes>0);assert.equal(closes,0);
  const raw=bytes.slice(),moov=children(raw).find(b=>b.type==='moov');
  await file.finish();
  assert.deepEqual(bytes.subarray(0,moov.at),raw.subarray(0,moov.at));
  assert.deepEqual(bytes,new Uint8Array(await sphericalMp4(raw,4096,2048).arrayBuffer()));
  assert.equal(closes,0);await writable.close();assert.equal(closes,1);
  const saved=fromBytes(bytes);
  try{
   assert.equal(await (await saved.getPrimaryVideoTrack()).computeDuration(),17);
   assert.ok(await saved.getPrimaryAudioTrack());
  }finally{saved.dispose();}
 }finally{input.dispose();}
});

test('spherical movie metadata preserves 64-bit offsets for multi-gigabyte files',()=>{
 const co64=new Uint8Array(16);new DataView(co64.buffer).setUint32(4,1);new DataView(co64.buffer).setBigUint64(8,2n**32n+1234n);
 const movie=box('moov',box('trak',box('mdia',handler('vide'),box('minf',box('stbl',box('co64',co64))))));
 const decorated=sphericalMovieBox(movie,7680,3840);
 const track=child(child(decorated,'moov'),'trak');
 assert.deepEqual(child(child(child(child(track,'mdia'),'minf'),'stbl'),'co64'),co64);
});
