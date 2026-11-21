import test from 'node:test';
import assert from 'node:assert/strict';
import {swatchForSample} from '../web/scoreboard.js';
test('a sampled color maps to the team swatch of its light or dark class, else stays as sampled',()=>{
 const jerseys={dark:'#112233',light:'#eeeeee'};
 assert.equal(swatchForSample('#f0f0f0',jerseys),'#eeeeee');
 assert.equal(swatchForSample('#202060',jerseys),'#112233');
 assert.equal(swatchForSample('#f0f0f0',{dark:'#112233'}),'#f0f0f0');
 assert.equal(swatchForSample('#202060',undefined),'#202060');
});
