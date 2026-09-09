// Size as evidence quality, not as identity.
//
// Putting size in the identity key would fragment every comp pool, and since
// the minimum is three comps most items would drop below it and stop being
// valued at all. One garment is one item however many sizes it was cut in.
//
// But a median drawn across every size answers "what does this coat fetch" when
// the question asked was "what does THIS one fetch" — on these venues the buyer
// pool for a mid size is several times larger, and the gap runs to tens of
// percent on one piece. So it weights the comp, the way evidence class and
// recency already do.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSize, sizeWeight, weighBySize, FLOOR_WEIGHT } from '../src/lib/size.mjs';
import { observationWeight } from '../src/lib/priceHistory.mjs';
import { resaleEstimate } from '../src/lib/scoring.mjs';

test('alpha sizes read onto one axis', () => {
  assert.deepEqual(parseSize('M'), { region: 'ALPHA', ordinal: 3, label: 'M' });
  assert.equal(parseSize('size L').ordinal, 4);
  assert.equal(parseSize('XL').region, 'ALPHA');
  assert.equal(parseSize('xxl').ordinal, 6);
});

test('the two unambiguous numeric systems are read, and nothing else is', () => {
  // 1–7 is Japanese designer sizing, which CDG, Yohji and Issey all cut to.
  assert.deepEqual(parseSize('3'), { region: 'JP', ordinal: 2, label: '3' });
  // 42–60 even is European garment sizing.
  assert.deepEqual(parseSize('48'), { region: 'EU', ordinal: 3, label: '48' });

  // A bare 32 is a US waist on trousers and a bust on a dress. Deciding which
  // would invent the one fact that makes the comparison mean anything.
  assert.equal(parseSize('32').ordinal, null);
  assert.equal(parseSize('32').region, 'UNKNOWN');
});

test('a size quoted with its system does not have to be inferred', () => {
  assert.deepEqual(parseSize('EU 48'), { region: 'EU', ordinal: 3, label: 'EU 48' });
  // An IT 50 is an EU 50 by another name.
  assert.equal(parseSize('IT 50').region, 'EU');
  assert.equal(parseSize('IT 50').ordinal, 4);
  assert.equal(parseSize('JP 3').region, 'JP');

  // A stated system with no scale here is a real fact that still cannot be put
  // on an axis, so it compares with nothing rather than with the wrong thing.
  assert.equal(parseSize('UK 10').ordinal, null);
});

test('an unreadable size compares with everything, never against it', () => {
  // Silence is compatible with any size. Only a stated size that demonstrably
  // differs is evidence of a difference, so this can demote a comp it can prove
  // is wrong and can never promote one on an assumption.
  assert.equal(sizeWeight(parseSize('M'), parseSize('')), 1);
  assert.equal(sizeWeight(parseSize(''), parseSize('M')), 1);
  assert.equal(sizeWeight(parseSize('M'), parseSize('one size')), 1);
});

test('sizes are compared only within a sizing system', () => {
  // A Yohji 3, a CDG M and an IT 50 are roughly one another, and "roughly" is a
  // conversion table somebody would then be trusting to the nearest step.
  assert.equal(sizeWeight(parseSize('M'), parseSize('3')), 1);
  assert.equal(sizeWeight(parseSize('48'), parseSize('M')), 1);
});

test('distance discounts gently and never to zero', () => {
  const m = parseSize('M');
  assert.equal(sizeWeight(m, parseSize('M')), 1);
  assert.equal(sizeWeight(m, parseSize('L')), 0.7);
  assert.equal(sizeWeight(m, parseSize('XL')), 0.4);
  // A comp three sizes out is still evidence the garment trades at this level.
  assert.equal(sizeWeight(m, parseSize('XXL')), FLOOR_WEIGHT);
  assert.ok(FLOOR_WEIGHT > 0);
});

test('the weight reaches the observation, multiplying the other two factors', () => {
  const base = { evidence: 'active_ask', date_seen: new Date(), entered_manually: false };
  const full = observationWeight(base);
  const halved = observationWeight({ ...base, sizeWeight: 0.4 });
  assert.equal(halved, Number((full * 0.4).toFixed(4)));

  // Absent, it is 1 — the honest default rather than a silent discount.
  assert.equal(observationWeight({ ...base, sizeWeight: undefined }), full);
});

test('weighing is inert when the piece being valued states no size', () => {
  const observations = [{ size_raw: 'M' }, { size_raw: 'XXL' }];
  const out = weighBySize(observations, null);
  assert.equal(out.comparable, 0);
  assert.equal(out.observations[0].sizeWeight, undefined);
  assert.equal(out.observations[1].sizeWeight, undefined);
});

test('the estimate says how much of itself is a different size', () => {
  const now = new Date();
  const comp = (price, size) => ({
    price_base: price, size_raw: size, evidence: 'active_ask', status: 'active',
    date_seen: now, entered_manually: false, source_role: 'exit',
    marketplace_kind: 'secondhand', condition_tier: null,
  });

  // Every comp states a size, and every one of them is a different size.
  const offSize = resaleEstimate(
    [comp(1000, 'XXL'), comp(1100, 'XXL'), comp(1200, 'XXL')], null, now, null, 'M',
  );
  assert.equal(offSize.sizeComparable, 3);
  assert.equal(offSize.offSizeComps, 3);
  assert.equal(offSize.sizeTarget, 'M');

  // The same pool in the size being valued reports nothing off-size, and is
  // worth more: the weights are higher, so volume aside the confidence is too.
  const onSize = resaleEstimate(
    [comp(1000, 'M'), comp(1100, 'M'), comp(1200, 'M')], null, now, null, 'M',
  );
  assert.equal(onSize.offSizeComps, 0);
  assert.ok(onSize.confidence > offSize.confidence,
    `expected an in-size pool to outweigh an off-size one (${onSize.confidence} vs ${offSize.confidence})`);

  // And neither is filtered away: a wrong-size comp is still a comp.
  assert.equal(offSize.comps, 3);
});
