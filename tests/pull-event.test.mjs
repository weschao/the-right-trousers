import test from 'node:test';
import assert from 'node:assert/strict';
import {pullEvent} from '../web/core.js';

test('the pull is the pickup that opens the point', () => {
  const pickup = {type: 'possession_start', side: 'them'};
  assert.equal(pullEvent({events: [pickup, {type: 'pass'}]}), pickup);
});

test('a pickup after a turnover is not the pull', () => {
  const events = [{type: 'turnover', side: 'them'}, {type: 'possession_start', side: 'us'}, {type: 'pass'}];
  assert.equal(pullEvent({events}), undefined);
});

test('a point with no events has no pull', () => {
  assert.equal(pullEvent({events: []}), undefined);
});
