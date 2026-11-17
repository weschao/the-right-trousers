// Google Spherical Video V1 and V2 metadata. The exporter writes moov AFTER
// mdat, so growing moov cannot invalidate any media chunk offsets.
// https://github.com/google/spatial-media/tree/master/docs
const utf8 = new TextEncoder();
const concat = parts => { const result = new Uint8Array(parts.reduce((n,p)=>n+p.length,0)); let at=0; for(const part of parts){result.set(part,at);at+=part.length;} return result; };
const u32 = n => {const bytes=new Uint8Array(4);new DataView(bytes.buffer).setUint32(0,n);return bytes;};
const box = (type,...parts) => {const payload=concat(parts);return concat([u32(payload.length+8),utf8.encode(type),payload]);};
function boxes(data,start=0,end=data.length){
 const view=new DataView(data.buffer,data.byteOffset,data.byteLength),result=[];
 for(let at=start;at<end;){
  if(at+8>end)throw Error('Incomplete MP4 box');
  const short=view.getUint32(at),header=short===1?16:8;
  if(at+header>end)throw Error('Incomplete MP4 box header');
  const size=short===1?Number(view.getBigUint64(at+8)):short||end-at;
  if(size<header||at+size>end||!Number.isSafeInteger(size))throw Error('Invalid MP4 box size');
  result.push({type:String.fromCharCode(...data.subarray(at+4,at+8)),at,end:at+size,body:at+header});at+=size;
 }
 return result;
}
const slice=(data,b)=>data.subarray(b.at,b.end);
function sphericalV1(width,height){
 const fields={Spherical:'true',Stitched:'true',StitchingSoftware:'The Right Trousers EPT',ProjectionType:'equirectangular',StereoMode:'mono',SourceCount:2,FullPanoWidthPixels:width,FullPanoHeightPixels:height,CroppedAreaImageWidthPixels:width,CroppedAreaImageHeightPixels:height,CroppedAreaLeftPixels:0,CroppedAreaTopPixels:0,InitialViewHeadingDegrees:0,InitialViewPitchDegrees:-15,InitialViewRollDegrees:0};
 const xml=`<?xml version="1.0"?><rdf:SphericalVideo xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:GSpherical="http://ns.google.com/videos/1.0/spherical/">${Object.entries(fields).map(([k,v])=>`<GSpherical:${k}>${v}</GSpherical:${k}>`).join('')}</rdf:SphericalVideo>`;
 return box('uuid',new Uint8Array([0xff,0xcc,0x82,0x63,0xf8,0x55,0x4a,0x93,0x88,0x14,0x58,0x7a,0x02,0x52,0x1f,0xdd]),utf8.encode(xml));
}
function sphericalV2(){
 return [box('st3d',new Uint8Array(5)),box('sv3d',box('svhd',new Uint8Array(4),utf8.encode('The Right Trousers EPT\0')),box('proj',box('prhd',new Uint8Array(16)),box('equi',new Uint8Array(20))))];
}
function decorateVideo(data,b){
 if(['mdia','minf','stbl'].includes(b.type))return box(b.type,...boxes(data,b.body,b.end).map(child=>decorateVideo(data,child)));
 if(b.type==='stsd')return box('stsd',data.subarray(b.body,b.body+8),...boxes(data,b.body+8,b.end).map(entry=>{
  if(!['avc1','avc3','hvc1','hev1','av01'].includes(entry.type))return slice(data,entry);
  return box(entry.type,data.subarray(entry.body,entry.body+78),...boxes(data,entry.body+78,entry.end).filter(x=>!['sv3d','st3d'].includes(x.type)).map(x=>slice(data,x)),...sphericalV2());
 }));
 return slice(data,b);
}
export function sphericalMovieBox(buffer,width,height){
 if(width!==height*2||width%4)throw Error('A spherical export must have a 2:1 frame with even dimensions');
 const data=new Uint8Array(buffer),top=boxes(data),moov=top[0];
 if(top.length!==1||!moov||moov.type!=='moov')throw Error('Expected one MP4 movie box');
 let videoTracks=0;
 const movie=box('moov',...boxes(data,moov.body,moov.end).map(trak=>{
  if(trak.type!=='trak')return slice(data,trak);
  const children=boxes(data,trak.body,trak.end),mdia=children.find(b=>b.type==='mdia');
  const handler=mdia&&boxes(data,mdia.body,mdia.end).find(b=>b.type==='hdlr');
  if(!handler||String.fromCharCode(...data.subarray(handler.body+8,handler.body+12))!=='vide')return slice(data,trak);
  videoTracks++;
  return box('trak',...children.map(b=>decorateVideo(data,b)),sphericalV1(width,height));
 }));
 if(!videoTracks)throw Error('The exported MP4 has no video track');
 return movie;
}
export function sphericalMp4(buffer,width,height){
 const data=new Uint8Array(buffer),top=boxes(data),moov=top.find(b=>b.type==='moov');
 if(!moov||top.some(b=>b.type==='moof')||top.some(b=>b.type==='mdat'&&b.at>moov.at))throw Error('Spherical metadata requires an unfragmented MP4 with moov after mdat');
 const movie=sphericalMovieBox(slice(data,moov),width,height);
 return new Blob(top.map(b=>b===moov?movie:slice(data,b)),{type:'video/mp4'});
}
