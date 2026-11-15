import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
const navigation=source.slice(source.indexOf(" const dialog=$('#modal'),nativeLinks="),source.indexOf(" $('#modal').querySelectorAll('[data-event-timestamp]')"));
const restore=source.slice(source.indexOf('function restorePvl()'),source.indexOf('function closeModal()'));
const classes=()=>{const values=new Set();return {add:value=>values.add(value),remove:value=>values.delete(value),contains:value=>values.has(value),toggle(value,on){if(on)values.add(value);else values.delete(value);}};};
function library(){
 const gameA={id:'a',videoLink:'veo-a',events:[{id:'lead',videoTimestamp:'0:05'},{id:'one'},{id:'lead2',videoTimestamp:'0:20'},{id:'two'}]},gameB={id:'b',videoLink:'veo-b',events:[{id:'lead',videoTimestamp:'1:00'},{id:'three'}]};
 const rows=[{game:gameA,event:gameA.events[1],pointIndex:0},{game:{id:'disabled'}},{game:gameA,event:gameA.events[3],pointIndex:0},{game:gameB,event:gameB.events[1],pointIndex:0}],tableRows=rows.map(()=>({classList:classes(),hidden:false,isConnected:true}));
 tableRows.forEach(row=>row.parentElement={rows:tableRows});
 const links=[0,2,3].map(index=>({dataset:{pvlNative:String(index)},closest:()=>tableRows[index],focus(){this.focused=true;}})),connections=[];
 let viewer;
 const dialog={open:true,classList:classes(),querySelector(selector){if(selector==='.pvl-viewer')return viewer;if(selector==='[data-pvl-native]')return links[0];if(selector==='.throwaway-table-wrap')return {after:node=>{viewer=node;}};},querySelectorAll:selector=>selector==='[data-pvl-native]'?links:tableRows};
 const document={createElement(){const previous={},next={},position={},holder={querySelector:()=>({})},controls={'[data-pvl-previous]':previous,'[data-pvl-next]':next,'[data-pvl-position]':position,'.pvl-video-holder':holder};return {querySelector:selector=>controls[selector],remove(){viewer=null;}};}};
 class Connection{constructor(frame,game,options){Object.assign(this,{frame,game,options,seeks:[],focuses:0});this.api={pause:()=>{},focus:()=>this.focuses++};connections.push(this);}start(){this.options.onConnected(this.api);}seek(seconds){this.seeks.push(seconds);}dispose(){this.disposed=true;}}
 const context=vm.createContext({rows,document,$:()=>dialog,EnhancedConnection:Connection,enhancedMarkup:()=>'',pointsOf:()=>[],importedPointTimestamps:()=>[],timestampSeconds:value=>value?value.split(':').reduce((sum,n)=>sum*60+Number(n),0):null,matchMedia:()=>({matches:true}),setTimeout:fn=>{fn();return 1;},clearTimeout(){}});
 vm.runInContext('let pvlTimer,pvlConnection;'+restore+navigation,context);
 return {links,tableRows,connections,dialog,viewer:()=>viewer,restore:()=>vm.runInContext('restorePvl()',context)};
}
test('PVL navigation follows enabled plays, reuses the same game viewer and focuses playback immediately',()=>{
 const h=library();h.links[0].onclick({preventDefault(){}});
 assert.equal(h.connections.length,1);assert.equal(h.connections[0].options.initialSeconds,5);assert.equal(h.connections[0].focuses,1);
 const previous=h.viewer().querySelector('[data-pvl-previous]'),next=h.viewer().querySelector('[data-pvl-next]');
 assert.equal(previous.disabled,true);assert.equal(next.disabled,false);
 next.onclick();assert.equal(h.connections.length,1);assert.deepEqual(h.connections[0].seeks,[20]);assert.equal(h.connections[0].focuses,2);
 assert.deepEqual(h.tableRows.map(row=>row.hidden),[true,true,false,true]);
 assert.equal(h.viewer().querySelector('[data-pvl-position]').textContent,'Play 2 of 3');
 next.onclick();assert.equal(h.connections.length,2);assert.equal(h.connections[0].disposed,true);assert.equal(h.connections[1].options.initialSeconds,60);assert.equal(h.connections[1].focuses,1);assert.equal(next.disabled,true);
 next.onclick();assert.equal(h.connections.length,2);
 previous.onclick();assert.equal(h.connections.length,3);assert.equal(h.connections[1].disposed,true);
 h.restore();assert.equal(h.connections[2].disposed,true);assert.equal(h.viewer(),null);assert.deepEqual(h.tableRows.map(row=>row.hidden),[false,false,false,false]);assert.equal(h.dialog.classList.contains('pvl-fullscreen'),false);
});
