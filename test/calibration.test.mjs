import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calibrate, calibrationFactor, MIN_OBSERVATIONS } from '../src/lib/calibration.mjs';

test('no recorded sales leaves the estimate untouched', () => {
  const c = calibrate(1000, null);
  assert.equal(c.value, 1000);
  assert.equal(c.applied, false);
});

test('an anecdote does not move the number', () => {
  // Two sales at double the estimate is a story, not a market fact.
  const c = calibrate(1000, { ratio: 2.0, observations: 2 });
  assert.equal(c.applied, false);
  assert.equal(c.value, 1000);
  assert.match(c.reason, /not enough/);
});

test('a correction ramps in with evidence rather than switching on', () => {
  const few = calibrate(1000, { ratio: 1.5, observations: MIN_OBSERVATIONS });
  const many = calibrate(1000, { ratio: 1.5, observations: 12 });
  assert.equal(few.value, 1000, 'at the threshold the correction has no weight yet');
  assert.equal(many.value, 1500, 'with a body of sales it is trusted in full');

  const middling = calibrate(1000, { ratio: 1.5, observations: 8 });
  assert.ok(middling.value > 1000 && middling.value < 1500);
});

test('an implausible ratio is clamped and says so', () => {
  // Far more likely a mis-parsed price or a sale in the wrong currency than a
  // real 6x market fact — and applying it would be catastrophic.
  const c = calibrate(1000, { ratio: 6, observations: 20 });
  assert.equal(c.clamped, true);
  assert.equal(c.value, 2500);
  assert.match(c.reason, /mis-recorded/);
});

test('the uncorrected estimate is kept, so the adjustment can be checked', () => {
  const c = calibrate(1000, { ratio: 0.8, observations: 12 });
  assert.equal(c.raw, 1000);
  assert.equal(c.value, 800);
});

test('nonsense ratios are ignored rather than propagated', () => {
  for (const bad of [0, -1, NaN, null, undefined, 'abc']) {
    assert.equal(calibrationFactor({ ratio: bad, observations: 50 }).applied, false);
  }
});

test('a missing estimate stays missing rather than becoming a number', () => {
  assert.equal(calibrate(null, { ratio: 1.4, observations: 20 }).value, null);
});
