import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  summariseItem,
  weightedMedian,
  observationWeight,
  MIN_COMPS,
  EVIDENCE_WEIGHT,
} from '../src/lib/priceHistory.mjs';

const NOW = new Date('2026-09-04T00:00:00Z');
const recent = (days = 1) => new Date(NOW.getTime() - days * 86_400_000);

const obs = (price, over = {}) => ({
  price_base: price,
  evidence: 'active_ask',
  status: 'active',
  condition_tier: 'good',
  date_seen: recent(2),
  last_verified_at: recent(2),
  entered_manually: true,
  ...over,
});

test('a confirmed sale outweighs an active ask, which outweighs an inference', () => {
  assert.ok(EVIDENCE_WEIGHT.confirmed_sale > EVIDENCE_WEIGHT.active_ask);
  assert.ok(EVIDENCE_WEIGHT.active_ask > EVIDENCE_WEIGHT.inferred_disappearance);
});

test('weighted median favours the heavier evidence', () => {
  const m = weightedMedian([
    { value: 100, weight: 1 },
    { value: 900, weight: 0.05 },
    { value: 110, weight: 1 },
  ]);
  assert.ok(m < 200, `outlier should not drag the centre, got ${m}`);
});

test('weighted median ignores zero-weight and non-numeric entries', () => {
  const m = weightedMedian([
    { value: 100, weight: 1 },
    { value: 5000, weight: 0 },
    { value: NaN, weight: 1 },
  ]);
  assert.equal(m, 100);
});

test('an empty set has no median rather than zero', () => {
  assert.equal(weightedMedian([]), null);
});

test('below the minimum comp count it refuses to produce a number', () => {
  const s = summariseItem([obs(100), obs(120)], NOW);
  const good = s.tiers.find((t) => t.tier === 'good');
  assert.equal(good.count, 2);
  assert.equal(good.sufficient, false);
  assert.equal(good.median, null);
  assert.match(good.reason, /insufficient data/);
  assert.equal(good.confidence, 0);
});

test('at the minimum comp count it produces a median', () => {
  const s = summariseItem([obs(100), obs(120), obs(140)], NOW);
  const good = s.tiers.find((t) => t.tier === 'good');
  assert.equal(good.count, MIN_COMPS);
  assert.equal(good.sufficient, true);
  assert.ok(good.median > 0);
});

test('comps are never pooled across condition tiers', () => {
  const s = summariseItem(
    [
      obs(1000, { condition_tier: 'new' }),
      obs(1000, { condition_tier: 'new' }),
      obs(1000, { condition_tier: 'new' }),
      obs(200, { condition_tier: 'damaged' }),
      obs(200, { condition_tier: 'damaged' }),
      obs(200, { condition_tier: 'damaged' }),
    ],
    NOW,
  );
  const tiers = Object.fromEntries(s.tiers.map((t) => [t.tier, t]));
  assert.equal(tiers.new.count, 3);
  assert.equal(tiers.damaged.count, 3);
  assert.ok(tiers.new.median > 900);
  assert.ok(tiers.damaged.median < 300);
});

test('observations without a condition tier get their own bucket', () => {
  const s = summariseItem([obs(100, { condition_tier: null }), obs(120)], NOW);
  assert.equal(s.untiered.count, 1);
  assert.equal(s.tiers.find((t) => t.tier === 'good').count, 1);
});

test('recent comps outweigh old ones', () => {
  const fresh = observationWeight(obs(100, { date_seen: recent(1), last_verified_at: recent(1) }), NOW);
  const old = observationWeight(obs(100, { date_seen: recent(400), last_verified_at: recent(400) }), NOW);
  assert.ok(fresh > old, `fresh ${fresh} should beat old ${old}`);
});

test('confidence rises with more and better evidence', () => {
  const asks = summariseItem([obs(100), obs(110), obs(120)], NOW).tiers[0];
  const sales = summariseItem(
    [
      obs(100, { evidence: 'confirmed_sale', status: 'sold_confirmed' }),
      obs(110, { evidence: 'confirmed_sale', status: 'sold_confirmed' }),
      obs(120, { evidence: 'confirmed_sale', status: 'sold_confirmed' }),
    ],
    NOW,
  ).tiers[0];
  assert.ok(sales.confidence > asks.confidence);
});

test('the evidence split is reported, not just a count', () => {
  const s = summariseItem(
    [
      obs(100, { evidence: 'confirmed_sale', status: 'sold_confirmed' }),
      obs(110),
      obs(120, { evidence: 'inferred_disappearance', status: 'unknown' }),
    ],
    NOW,
  );
  assert.equal(s.totals.counts.confirmed_sale, 1);
  assert.equal(s.totals.counts.inferred_disappearance, 1);
  assert.match(s.totals.evidenceSummary, /1 confirmed sale/);
  assert.match(s.totals.evidenceSummary, /1 inferred/);
});

test('lowest active price ignores non-active rows', () => {
  const s = summariseItem(
    [
      obs(500, { status: 'active' }),
      obs(200, { status: 'delisted' }),
      obs(300, { status: 'active' }),
    ],
    NOW,
  );
  assert.equal(s.tiers[0].lowestActive, 300);
});

test('data age is surfaced so a stale score is visible as stale', () => {
  const s = summariseItem(
    [obs(100, { date_seen: recent(9) }), obs(110, { date_seen: recent(200) }), obs(120, { date_seen: recent(50) })],
    NOW,
  );
  assert.equal(s.tiers[0].newestAgeDays, 9);
  assert.equal(s.tiers[0].oldestAgeDays, 200);
});

// --- matching + reverse image ------------------------------------------------
import { planMatch, itemKey } from '../src/lib/matching.mjs';
import { reverseImageLinks } from '../src/lib/reverseImage.mjs';

test('a clean sub-line title is matchable', () => {
  const p = planMatch({ title_raw: 'Comme des Garcons Homme Plus AD2002 wool jacket' });
  assert.equal(p.matchable, true);
  assert.equal(p.sublineId, 'cdg-homme-plus');
  assert.equal(p.adYear, 2002);
});

test('an ambiguous sub-line is never auto-matched', () => {
  const p = planMatch({ title_raw: 'CDG cargo trousers' });
  assert.equal(p.matchable, false);
});

test('an unmonitored sub-line is recognised but not matched', () => {
  const p = planMatch({ title_raw: 'Comme des Garcons Play heart tee' });
  assert.equal(p.matchable, false);
  assert.match(p.reason, /excluded from monitoring/);
});

test('an unknown brand is not matched', () => {
  assert.equal(planMatch({ title_raw: 'Yohji Yamamoto coat' }).matchable, false);
});

test('AD year separates otherwise identical items', () => {
  const a = itemKey({ sublineId: 'cdg-homme-plus', adYear: 1995, canonicalName: 'wool jacket' });
  const b = itemKey({ sublineId: 'cdg-homme-plus', adYear: 2002, canonicalName: 'wool jacket' });
  assert.notEqual(a, b);
});

test('an unknown AD year is its own bucket, not a wildcard', () => {
  const unknown = itemKey({ sublineId: 'cdg-shirt', adYear: null, canonicalName: 'striped shirt' });
  const known = itemKey({ sublineId: 'cdg-shirt', adYear: 2010, canonicalName: 'striped shirt' });
  assert.notEqual(unknown, known);
  assert.match(unknown, /ad\?/);
});

test('reverse image links are built for a usable image', () => {
  const links = reverseImageLinks('https://example.com/a%20photo.jpg');
  assert.equal(links.length, 3);
  assert.ok(links.every((l) => l.href.includes(encodeURIComponent('https://example.com/a%20photo.jpg'))));
});

test('no image, or an unusable one, yields no links rather than dead ones', () => {
  assert.deepEqual(reverseImageLinks(null), []);
  assert.deepEqual(reverseImageLinks('not a url'), []);
  assert.deepEqual(reverseImageLinks('data:image/png;base64,AAAA'), []);
});
