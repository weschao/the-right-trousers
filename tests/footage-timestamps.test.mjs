import test from 'node:test';
import assert from 'node:assert/strict';
import {pointTimestampFile,timestampFileName} from '../web/footage-timestamps.js';
const make=()=>({videoLink:'https://app.veo.co/matches/test/',finished:true,events:[
 {id:'p1',type:'point_start',line:[],starting:'D',videoTimestamp:'0:00'},
 {type:'point_end',winner:'us'},
 {id:'p2',type:'point_start',line:[],starting:'D',videoTimestamp:'3:15.99'},
 {type:'point_end',winner:'them'},
 {id:'p3',type:'point_start',line:[],starting:'O',videoTimestamp:'1:01:10.25'},
 {type:'point_end',winner:'us'}]});
test('timestamp file has one line per point, our score first, and pull/receive at point start',()=>{
 const result=pointTimestampFile(make());
 assert.equal(result.text,'0:00 0-0 pull\n3:15 1-0 pull\n61:10 1-1 receive\n');
 assert.deepEqual(result.missingPoints,[]);
});
test('manual point timestamps override recorded numeric times and imported timestamps',()=>{
 const game=make();game.videoTimestamps='0:10\n4:00\n1:02:03.99';game.events[0].veoSeconds=99;
 delete game.events[2].videoTimestamp;game.events[2].veoSeconds=195;
 delete game.events[4].videoTimestamp;
 assert.equal(pointTimestampFile(game).text,'0:00 0-0 pull\n3:15 1-0 pull\n62:03 1-1 receive\n');
});
test('timestamps use the exported source clock when video has a Veo offset',()=>{
 const result=pointTimestampFile(make(),{offset:15});
 assert.equal(result.text,'3:00 1-0 pull\n60:55 1-1 receive\n');
 assert.deepEqual(result.missingPoints,[1]);
});
test('missing timestamps are reported without changing later scores',()=>{
 const game=make();delete game.events[2].videoTimestamp;
 const result=pointTimestampFile(game);
 assert.equal(result.text,'0:00 0-0 pull\n61:10 1-1 receive\n');
 assert.deepEqual(result.missingPoints,[2]);
 assert.deepEqual(pointTimestampFile({...game,events:[]}),{text:'',missingPoints:[]});
});
test('timestamp filename follows the actual MP4 name, including user renames',()=>{
 for(const [video,name] of [['name.mp4','name_timestamps.txt'],['Custom match.MP4','Custom match_timestamps.txt'],['match.one.mp4','match.one_timestamps.txt']])assert.equal(timestampFileName(video),name);
});
