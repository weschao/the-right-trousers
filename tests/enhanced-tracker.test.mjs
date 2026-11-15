import test from 'node:test';
import assert from 'node:assert/strict';
import {isVeoLink,enhancedEnabled,videoTimestamp,clickMetadata,clickLocation} from '../web/enhanced-tracker.js';
import {timestampLink} from '../web/video.js';

test('enhanced tracking is opt-in per game and limited to the Veo app host',()=>{
 for(const link of ['https://app.veo.co/matches/game/','http://app.veo.co/matches/game/','app.veo.co/matches/game/'])assert.equal(isVeoLink(link),true);
 for(const link of ['',null,'javascript:alert(1)','https://app.veo.co.evil.test/matches/game/','https://example.com/app.veo.co','https://veo.co'])assert.equal(isVeoLink(link),false);
 const game={videoLink:'https://app.veo.co/matches/game/'};
 assert.equal(enhancedEnabled(game),false);
 assert.equal(enhancedEnabled({...game,enhancedTracker:false}),false);
 assert.equal(enhancedEnabled({...game,enhancedTracker:true}),true);
 assert.equal(enhancedEnabled({...game,enhancedTracker:true,videoLink:'https://youtu.be/abcdefghijk'}),false);
});
test('video event timestamps retain exact seconds and produce existing watch links',()=>{
 const click={videoSeconds:12.456,veoSeconds:3723.456,x:30.2,y:12.1};
 assert.deepEqual(clickMetadata(click),{videoTimestamp:'1:02:03.46',videoSeconds:12.456,veoSeconds:3723.456});
 assert.equal(timestampLink({videoLink:'https://app.veo.co/matches/game/'},clickMetadata(click).videoTimestamp),'https://app.veo.co/matches/game/#t=1:02:03');
 assert.equal(videoTimestamp(0),'0:00.00');assert.equal(videoTimestamp(59.999),'1:00.00');assert.equal(videoTimestamp(60),'1:00.00');
});
test('video clicks use the same field coordinate frame and boundary limits as the pitch',()=>{
 const field={length:110,width:40};
 assert.deepEqual(clickLocation({x:23.25,y:17.5},field),{x:23.25,y:17.5});
 assert.deepEqual(clickLocation({x:-3,y:43},field),{x:0,y:40});
 assert.deepEqual(clickLocation({x:114,y:-1},field),{x:110,y:0});
});
