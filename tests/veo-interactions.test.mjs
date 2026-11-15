import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {EnhancedTracker} from '../web/enhanced-tracker.js';

// Run the actual clicker actions and gesture handlers without video/WebGL rendering.
const source=fs.readFileSync(new URL('../web/veo_field_clicker.html',import.meta.url),'utf8');
function clicker(){
 const handlers={},moves=[],state={view:{},viewFitted:true,fit:{},lens:{},drift:null,field:{length:110,width:40},clicks:[{u:100,v:100,x:10,y:10,inField:true,videoSeconds:12.5,veoSeconds:12.5,frame:374}]};
 const video={paused:false,currentTime:99,duration:120,pause(){this.paused=true;},play(){this.paused=false;}};
 let pans=0;
 const context=vm.createContext({state,video,window:{},document:{addEventListener:(name,fn)=>handlers['key:'+name]=fn},stage:{style:{},addEventListener:(name,fn)=>handlers[name]=fn,setPointerCapture(){}},
  screenOfPixel:(u,v)=>({x:u,y:v}),stagePoint:e=>({x:e.clientX,y:e.clientY}),guarded:fn=>fn,refresh(){},say(){},groundPlaneNow:()=>null,veoSecondsNow:()=>99,videoReady:()=>true,
  trackerBlocked:true,trackerCanMoveClick:true,trackerHoveringVideo:false,trackerConnection:{onMove:click=>moves.push({...click})},CLICK_SLOP_PIXELS:4,
  VeoField:{screenToDirection:(view,x,y)=>({x,y}),sampleDirection:(lens,p)=>p.x<0?[]:[{u:p.x,v:p.y}],pixelToField:(lens,fit,drift,seconds,u,v)=>v<0?null:{x:u/10,y:v/10},panBy:view=>{pans++;return view;}}});
 vm.runInContext(source.slice(source.indexOf('const ACTIONS = {'),source.indexOf('window.ACTIONS = ACTIONS;')+'window.ACTIONS = ACTIONS;'.length),context);
 vm.runInContext(source.slice(source.indexOf('let press = null;'),source.indexOf("stage.addEventListener('wheel'")),context);
 vm.runInContext(source.slice(source.indexOf('function handlePlaybackKey('),source.indexOf("for (const name of ['timeupdate'")),context);
 const pointer=(x,y)=>({button:0,pointerId:1,clientX:x,clientY:y,target:{closest:()=>null},preventDefault(){}});
 return {state,video,moves,context,handlers,pointer,actions:context.window.ACTIONS,pans:()=>pans};
}
test('crosshair dragging moves the pending location, preserves the grab offset and original event time',()=>{
 const h=clicker();h.handlers.pointerdown(h.pointer(104,103));h.handlers.pointermove(h.pointer(204,153));h.handlers.pointerup(h.pointer(214,163));
 const point=h.state.clicks[0];assert.equal(point.x,21);assert.equal(point.y,16);assert.equal(point.u,210);assert.equal(point.v,160);
 assert.equal(point.videoSeconds,12.5);assert.equal(point.veoSeconds,12.5);assert.equal(point.frame,374);
 assert.equal(h.state.clicks.length,1);assert.equal(h.pans(),0);assert.equal(h.video.paused,true);assert.equal(h.moves.at(-1).x,21);
});
test('cancelling a crosshair drag restores the original location and notifies the event picker',()=>{
 const h=clicker();h.handlers.pointerdown(h.pointer(100,100));h.handlers.pointermove(h.pointer(250,150));h.handlers.pointercancel();
 assert.equal(h.state.clicks[0].x,10);assert.equal(h.state.clicks[0].y,10);assert.equal(h.moves.at(-1).x,10);assert.equal(h.moves.at(-1).videoSeconds,12.5);
});
test('dragging elsewhere pans; a line picker or a closed event cannot move the crosshair',()=>{
 const h=clicker();h.handlers.pointerdown(h.pointer(400,250));h.handlers.pointermove(h.pointer(450,270));h.handlers.pointerup(h.pointer(450,270));assert.equal(h.pans(),1);assert.equal(h.state.clicks[0].x,10);
 h.context.trackerCanMoveClick=false;assert.equal(h.actions.moveClickAt(200,200),null);assert.equal(h.state.clicks[0].x,10);
 h.handlers.pointerdown(h.pointer(100,100));h.handlers.pointerup(h.pointer(100,100));assert.equal(h.state.clicks.length,1);
});
test('invalid drag locations leave the last valid coordinates intact',()=>{
 const h=clicker();assert.equal(h.actions.moveClickAt(-1,200),null);assert.equal(h.actions.moveClickAt(200,-1),null);assert.equal(h.state.clicks[0].x,10);assert.equal(h.moves.length,0);
});
test('Space over the video toggles playback, even when a text input still has focus',()=>{
 const h=clicker();h.context.trackerHoveringVideo=true;let prevented=0;
 const space=()=>h.handlers['key:keydown']({key:' ',target:{tagName:'INPUT'},preventDefault(){prevented++;}});
 space();assert.equal(h.video.paused,true);space();assert.equal(h.video.paused,false);assert.equal(prevented,2);
});
test('parent sidebar focus routes Space to playback when the pointer is over the video',()=>{
 const originalWindow=globalThis.window,originalDocument=globalThis.document;let keydown;
 try{
  globalThis.window={addEventListener(){}};globalThis.document={addEventListener:(type,fn)=>{if(type==='keydown')keydown=fn;}};
  const tracker=new EnhancedTracker({});let toggles=0,prevented=0;tracker.api={handlePlaybackKey:()=>toggles++};tracker.hoveringVideo=true;
  keydown({key:' ',target:{closest:()=>({})},preventDefault:()=>prevented++});assert.equal(toggles,1);assert.equal(prevented,1);
 }finally{if(originalWindow===undefined)delete globalThis.window;else globalThis.window=originalWindow;if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;}
});

test('closing event and line dialogs restores video focus after playback resumes',()=>{
 const originalDocument=globalThis.document;
 try{
  for(const mode of ['event','line']){
   const calls=[],dialog={open:true,close(){calls.push('close');this.open=false;},closest:()=>null,classList:{remove(){}},style:{}};
   globalThis.document={querySelector:()=>dialog,querySelectorAll:()=>[]};
   const tracker={dialogMode:mode,api:{block:()=>calls.push('unblock'),play:()=>calls.push('play'),focus:()=>calls.push('focus')}};
   EnhancedTracker.prototype.closeDialog.call(tracker);assert.deepEqual(calls,['close','unblock','play','focus']);
  }
 }finally{if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;}
});
test('replacing a dialog does not steal focus, while other closed tracker dialogs return focus without changing playback',()=>{
 const originalDocument=globalThis.document;
 try{
  const calls=[],dialog={open:true,close(){this.open=false;},closest:()=>null,classList:{remove(){}},style:{}};
  globalThis.document={querySelector:()=>dialog,querySelectorAll:()=>[]};
  const tracker={dialogMode:'event',api:{block(){},play:()=>calls.push('play'),focus:()=>calls.push('focus')}};
  EnhancedTracker.prototype.closeDialog.call(tracker,false);assert.deepEqual(calls,[]);
  dialog.open=true;EnhancedTracker.prototype.closeDialog.call(tracker);assert.deepEqual(calls,['focus']);
 }finally{if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;}
});

test('Shift+arrows skip one minute, plain arrows skip five seconds, and skips stay within the video',()=>{
 const h=clicker();let prevented=0;
 const key=(key,shiftKey=false)=>h.handlers['key:keydown']({key,shiftKey,target:{tagName:'BUTTON'},preventDefault(){prevented++;}});
 key('ArrowLeft',true);assert.equal(h.video.currentTime,39);key('ArrowRight',true);assert.equal(h.video.currentTime,99);
 key('ArrowLeft');assert.equal(h.video.currentTime,94);key('ArrowRight');assert.equal(h.video.currentTime,99);
 h.video.currentTime=5;key('ArrowLeft',true);assert.equal(h.video.currentTime,0);
 h.video.currentTime=100;key('ArrowRight',true);assert.equal(h.video.currentTime,120);assert.equal(prevented,6);
});
test('sidebar keyboard forwarding preserves Shift for one-minute skips',()=>{
 const originalWindow=globalThis.window,originalDocument=globalThis.document;let keydown;
 try{
  globalThis.window={addEventListener(){}};globalThis.document={addEventListener:(type,fn)=>{if(type==='keydown')keydown=fn;}};
  const tracker=new EnhancedTracker({}),forwarded=[];let prevented=0;
  tracker.dialogMode='event';tracker.api={handlePlaybackKey:(key,shift)=>{forwarded.push([key,shift]);return true;}};
  for(const key of ['ArrowLeft','ArrowRight'])keydown({key,shiftKey:true,target:{closest:()=>null},preventDefault:()=>prevented++});
  assert.deepEqual(forwarded,[['ArrowLeft',true],['ArrowRight',true]]);assert.equal(prevented,2);
 }finally{if(originalWindow===undefined)delete globalThis.window;else globalThis.window=originalWindow;if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;}
});

test('event dialog uses the left side at full width when the click is near the right edge',()=>{
 const oldWidth=globalThis.innerWidth,oldHeight=globalThis.innerHeight;
 try{
  globalThis.innerWidth=1600;globalThis.innerHeight=900;
  const dialog={classList:{contains:()=>false},style:{},getBoundingClientRect:()=>({height:300})};
  const tracker={dialogMode:'event',anchor:{x:1400,y:400},frame:{closest:()=>({})}};
  EnhancedTracker.prototype.positionDialog.call(tracker,dialog);
  assert.equal(dialog.style.width,'650px');assert.equal(dialog.style.left,'734px');
  tracker.anchor.x=200;EnhancedTracker.prototype.positionDialog.call(tracker,dialog);
  assert.equal(dialog.style.width,'650px');assert.equal(dialog.style.left,'216px');
 }finally{globalThis.innerWidth=oldWidth;globalThis.innerHeight=oldHeight;}
});
test('Shift+arrows over the video work after focus returns to an input',()=>{
 const h=clicker();h.context.trackerHoveringVideo=true;let prevented=0;
 h.handlers['key:keydown']({key:'ArrowLeft',shiftKey:true,target:{tagName:'INPUT'},preventDefault(){prevented++;}});
 assert.equal(h.video.currentTime,39);
 h.handlers['key:keydown']({key:'ArrowRight',shiftKey:false,target:{tagName:'INPUT'},preventDefault(){prevented++;}});
 assert.equal(h.video.currentTime,44);assert.equal(prevented,2);
});
test('parent forwards Shift+arrows over video after focus returns to an input',()=>{
 const oldWindow=globalThis.window,oldDocument=globalThis.document;let keydown;
 try{globalThis.window={addEventListener(){}};globalThis.document={addEventListener:(type,fn)=>{if(type==='keydown')keydown=fn;}};
  const tracker=new EnhancedTracker({}),calls=[];let prevented=0;tracker.hoveringVideo=true;tracker.api={handlePlaybackKey:(key,shift)=>calls.push([key,shift])};
  keydown({key:'ArrowRight',shiftKey:true,target:{closest:()=>({})},preventDefault(){prevented++;}});
  keydown({key:'ArrowLeft',shiftKey:false,target:{closest:()=>({})},preventDefault(){prevented++;}});
  assert.deepEqual(calls,[['ArrowRight',true],['ArrowLeft',false]]);assert.equal(prevented,2);
 }finally{if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;}
});
