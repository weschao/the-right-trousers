import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../web/veo_field_clicker.html',import.meta.url),'utf8');
function renderer({available=true}={}){
 const events={},elements={},state={frameUploaded:true,uploadedTime:42,viewFitted:true};let refreshes=0,pauses=0,aborts=0,programs=0;
 const gl={lost:false,isContextLost(){return this.lost;},createProgram(){return ++programs;},createShader(){return {};},getShaderParameter(){return true;},getProgramParameter(){return true;},getUniformLocation(){return {};},getAttribLocation(){return 0;},createTexture(){return {};},createBuffer(){return {};}};
 for(const method of ['shaderSource','compileShader','attachShader','linkProgram','useProgram','bindBuffer','bufferData','enableVertexAttribArray','vertexAttribPointer','bindTexture','texParameteri','texParameterf'])gl[method]=()=>{};
 const element=id=>elements[id]||=( {hidden:true,textContent:'',addEventListener:(type,callback)=>events[id+':'+type]=callback} );
 const picture={getContext:()=>available?gl:null,addEventListener:(type,callback)=>events[type]=callback};
 const context=vm.createContext({picture,state,element,Float32Array,VERTEX_SHADER:'vertex',FRAGMENT_SHADER:'fragment',footageController:{abort(){aborts++;}},video:{pause(){pauses++;}},refresh(){refreshes++;}});
 vm.runInContext(html.slice(html.indexOf('let gl = null,'),html.indexOf('const columnMajor =')),context);
 return {context,gl,state,events,elements,run:code=>vm.runInContext(code,context),enable(){available=true;},programs:()=>programs,refreshes:()=>refreshes,pauses:()=>pauses,aborts:()=>aborts};
}
test('unavailable graphics produces a recovery message without aborting viewer initialization',()=>{
 const h=renderer({available:false});
 assert.equal(h.run('initializePicture()'),false);
 assert.equal(h.elements['renderer-notice'].hidden,false);
 assert.match(h.elements['renderer-status'].textContent,/Fully quit and reopen/);
 assert.equal(h.state.frameUploaded,false);assert.equal(h.state.uploadedTime,null);
 // A metadata/seek refresh must not throw on the absent context.
 vm.runInContext(html.slice(html.indexOf('function draw() {'),html.indexOf('// ---- the overlay')),h.context);
 assert.doesNotThrow(()=>h.run('draw()'));
 h.enable();h.events['retry-renderer:click']();
 assert.equal(h.run('pictureReady()'),true);assert.equal(h.elements['renderer-notice'].hidden,true);assert.equal(h.refreshes(),1);
});
test('context loss pauses video and cancels export; restoration rebuilds resources and uploads the paused frame',()=>{
 const h=renderer();assert.equal(h.run('initializePicture()'),true);assert.equal(h.programs(),1);
 h.state.frameUploaded=true;h.state.uploadedTime=42;h.gl.lost=true;let prevented=0;
 h.events.webglcontextlost({preventDefault(){prevented++;}});
 assert.equal(prevented,1);assert.equal(h.pauses(),1);assert.equal(h.aborts(),1);
 assert.equal(h.run('pictureReady()'),false);assert.equal(h.elements['renderer-notice'].hidden,false);
 h.gl.lost=false;h.events.webglcontextrestored();
 assert.equal(h.programs(),2);assert.equal(h.run('pictureReady()'),true);
 assert.equal(h.state.frameUploaded,false);assert.equal(h.state.uploadedTime,null);
 assert.equal(h.elements['renderer-notice'].hidden,true);
});
