import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareByScore, discountRatio, isFlagged, SORT_LABELS } from '../src/lib/sorting.mjs';

// The comparator is pure and takes its scores as a Map, so it can be exercised
// without a database.
const row = (id, over = {}) => ({
  id,
  date_seen: new Date('2026-09-01T00:00:00Z'),
  last_verified_at: new Date('2026-09-01T00:00:00Z'),
  price_base: 100,
  ...over,
});

const score = (over = {}) => ({
  best: {
    scored: true,
    profit: 0,
    spreadPct: 0,
    confidence: 0.5,
    price: 100,
    resale: { value: 200, comps: 4 },
    flags: [],
    ...over,
  },
  routeCount: 1,
});

const order = (sort, rows, scores) => [...rows].sort(compareByScore(sort, scores)).map((r) => r.id);

test('every sort key has a label', () => {
  for (const key of ['profit', 'discount', 'confidence', 'spread', 'newest', 'oldest', 'flagged', 'price_asc', 'price_desc', 'stalest']) {
    assert.ok(SORT_LABELS[key], `missing label for ${key}`);
  }
});

test('profit sorts high to low', () => {
  const rows = [row('a'), row('b'), row('c')];
  const scores = new Map([
    ['a', score({ profit: 10 })],
    ['b', score({ profit: 500 })],
    ['c', score({ profit: 120 })],
  ]);
  assert.deepEqual(order('profit', rows, scores), ['b', 'c', 'a']);
});

test('a loss still sorts below a profit, and above nothing', () => {
  const rows = [row('loss'), row('gain')];
  const scores = new Map([
    ['loss', score({ profit: -50 })],
    ['gain', score({ profit: 5 })],
  ]);
  assert.deepEqual(order('profit', rows, scores), ['gain', 'loss']);
});

test('unscored rows sink to the bottom rather than sorting as zero', () => {
  const rows = [row('unscored'), row('loss')];
  const scores = new Map([
    ['unscored', { best: { scored: false, flags: [] }, routeCount: 0 }],
    ['loss', score({ profit: -400 })],
  ]);
  assert.deepEqual(
    order('profit', rows, scores),
    ['loss', 'unscored'],
    'a real loss is more informative than no data',
  );
});

test('spread sorts by percentage, not absolute profit', () => {
  const rows = [row('big'), row('efficient')];
  const scores = new Map([
    ['big', score({ profit: 500, spreadPct: 0.1 })],
    ['efficient', score({ profit: 50, spreadPct: 2.0 })],
  ]);
  assert.deepEqual(order('spread', rows, scores), ['efficient', 'big']);
});

test('discount sorts by distance below the exit estimate', () => {
  const rows = [row('shallow'), row('deep')];
  const scores = new Map([
    ['shallow', score({ price: 180, resale: { value: 200, comps: 4 } })],
    ['deep', score({ price: 40, resale: { value: 200, comps: 4 } })],
  ]);
  assert.deepEqual(order('discount', rows, scores), ['deep', 'shallow']);
});

test('confidence sorts high to low', () => {
  const rows = [row('weak'), row('strong')];
  const scores = new Map([
    ['weak', score({ confidence: 0.05 })],
    ['strong', score({ confidence: 0.9 })],
  ]);
  assert.deepEqual(order('confidence', rows, scores), ['strong', 'weak']);
});

test('flagged sorts flagged rows first, then by profit within each group', () => {
  const rows = [row('clean-big'), row('flagged-small'), row('flagged-big')];
  const scores = new Map([
    ['clean-big', score({ profit: 900 })],
    ['flagged-small', score({ profit: 10, flags: [{ kind: 'steep_discount', severity: 'high' }] })],
    ['flagged-big', score({ profit: 300, flags: [{ kind: 'stale_comps', severity: 'high' }] })],
  ]);
  assert.deepEqual(order('flagged', rows, scores), ['flagged-big', 'flagged-small', 'clean-big']);
});

test('a medium-severity flag is not "flagged for review"', () => {
  const s = { scored: true, flags: [{ kind: 'thin_comps', severity: 'medium' }] };
  assert.equal(isFlagged(s), false);
  assert.equal(isFlagged({ scored: true, flags: [{ kind: 'x', severity: 'high' }] }), true);
});

test('newest and oldest are genuine inverses', () => {
  const rows = [
    row('old', { date_seen: new Date('2026-01-01') }),
    row('new', { date_seen: new Date('2026-09-01') }),
    row('mid', { date_seen: new Date('2026-05-01') }),
  ];
  const scores = new Map();
  assert.deepEqual(order('newest', rows, scores), ['new', 'mid', 'old']);
  assert.deepEqual(order('oldest', rows, scores), ['old', 'mid', 'new']);
});

test('price sorts put missing prices last, not first', () => {
  const rows = [row('none', { price_base: null }), row('cheap', { price_base: 10 })];
  const scores = new Map();
  assert.deepEqual(order('price_asc', rows, scores), ['cheap', 'none']);
  assert.deepEqual(order('price_desc', rows, scores), ['cheap', 'none']);
});

test('stalest surfaces the least recently verified first', () => {
  const rows = [
    row('fresh', { last_verified_at: new Date('2026-09-01') }),
    row('stale', { last_verified_at: new Date('2026-02-01') }),
    row('never', { last_verified_at: null }),
  ];
  assert.deepEqual(order('stalest', rows, new Map()), ['never', 'stale', 'fresh']);
});

test('an unknown sort key falls back to newest rather than throwing', () => {
  const rows = [row('a', { date_seen: new Date('2026-01-01') }), row('b', { date_seen: new Date('2026-09-01') })];
  assert.deepEqual(order('nonsense', rows, new Map()), ['b', 'a']);
});

test('discountRatio is null when there is nothing to compare against', () => {
  assert.equal(discountRatio(undefined), null);
  assert.equal(discountRatio({ scored: false, flags: [] }), null);
  assert.equal(discountRatio({ scored: true, price: 50, resale: { value: 200 }, flags: [] }), 0.75);
});
