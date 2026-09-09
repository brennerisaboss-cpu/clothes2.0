import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  statusChangeVeto,
  detectRelists,
  planAbsences,
  SHRINK_MIN_BASELINE,
} from '../src/lib/ingest.mjs';
import { succeeded, failed } from '../src/lib/adapters/contract.mjs';

const NOW = new Date('2026-09-04T00:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

test('a failed poll may never change any status', () => {
  const veto = statusChangeVeto(failed('timeout'), 40);
  assert.ok(veto, 'a failed poll must be vetoed');
  assert.match(veto, /poll failed/);
});

test('an incomplete poll may never change any status', () => {
  const veto = statusChangeVeto(succeeded([{ a: 1 }], { complete: false }), 40);
  assert.match(veto, /full catalogue/);
});

test('zero results after a non-zero baseline is vetoed', () => {
  const veto = statusChangeVeto(succeeded([], { complete: true }), 40);
  assert.match(veto, /returned 0 results/);
});

test('zero results with no baseline is allowed — a genuinely empty shop', () => {
  assert.equal(statusChangeVeto(succeeded([], { complete: true }), 0), null);
});

test('a suspicious shrink is vetoed', () => {
  const listings = Array.from({ length: 5 }, (_, i) => ({ sourceItemId: String(i) }));
  const veto = statusChangeVeto(succeeded(listings, { complete: true }), 40);
  assert.match(veto, /suspiciously fewer/);
});

test('a small shop losing a couple of items is not vetoed', () => {
  const listings = Array.from({ length: 3 }, (_, i) => ({ sourceItemId: String(i) }));
  // Below the baseline floor, ratios are noise.
  assert.equal(statusChangeVeto(succeeded(listings, { complete: true }), SHRINK_MIN_BASELINE - 1), null);
});

test('a healthy poll is allowed to change statuses', () => {
  const listings = Array.from({ length: 38 }, (_, i) => ({ sourceItemId: String(i) }));
  assert.equal(statusChangeVeto(succeeded(listings, { complete: true }), 40), null);
});

test('an adapter cannot return success without stating completeness', () => {
  assert.throws(() => succeeded([], {}), /complete/);
});

test('a same-seller same-title reappearance under a new id is a relist', () => {
  const gone = [
    { id: 'old-1', source_item_id: '100:1', title_raw: 'CDG Homme Plus wool jacket', seller_id: 'shopA', date_seen: daysAgo(5) },
  ];
  const incoming = [
    { sourceItemId: '200:9', title: 'CDG Homme Plus wool jacket', sellerId: 'shopA' },
  ];
  const links = detectRelists(incoming, gone, NOW);
  assert.equal(links.get('200:9'), 'old-1');
});

test('a reappearance outside the window is not treated as a relist', () => {
  const gone = [
    { id: 'old-1', source_item_id: '100:1', title_raw: 'CDG jacket', seller_id: 'shopA', date_seen: daysAgo(200) },
  ];
  const links = detectRelists([{ sourceItemId: '200:9', title: 'CDG jacket', sellerId: 'shopA' }], gone, NOW);
  assert.equal(links.size, 0);
});

test('a different seller with the same title is not a relist', () => {
  const gone = [
    { id: 'old-1', source_item_id: '100:1', title_raw: 'CDG jacket', seller_id: 'shopA', date_seen: daysAgo(2) },
  ];
  const links = detectRelists([{ sourceItemId: '200:9', title: 'CDG jacket', sellerId: 'shopB' }], gone, NOW);
  assert.equal(links.size, 0);
});

test('a listing that kept its id is not a relist of itself', () => {
  const gone = [
    { id: 'old-1', source_item_id: '100:1', title_raw: 'CDG jacket', seller_id: 'shopA', date_seen: daysAgo(2) },
  ];
  const links = detectRelists([{ sourceItemId: '100:1', title: 'CDG jacket', sellerId: 'shopA' }], gone, NOW);
  assert.equal(links.size, 0);
});

test('an absent listing becomes delisted, never sold', () => {
  const previous = [
    { id: 'a', source_item_id: '1' },
    { id: 'b', source_item_id: '2' },
  ];
  const plan = planAbsences(previous, ['1'], new Map());
  assert.equal(plan.length, 1);
  assert.equal(plan[0].id, 'b');
  assert.equal(plan[0].status, 'delisted');
  assert.equal(plan[0].evidence, 'inferred_disappearance');
  assert.notEqual(plan[0].status, 'sold_confirmed');
});

test('a listing identified as relisted is not also recorded as gone', () => {
  const previous = [{ id: 'a', source_item_id: '1' }];
  const plan = planAbsences(previous, [], new Map([['new-id', 'a']]));
  assert.equal(plan.length, 0, 'a relisted listing must not also be marked delisted');
});

// --- what a partial poll may and may not do ---------------------------------
//
// These were one question and had one answer, and the answer was "nothing".
// A source that cannot enumerate its catalogue — a search rather than a
// catalogue, a results page with no way to know how many follow — could
// therefore never record a price, though every price it reported had actually
// been seen. What must not be inferred from a partial read is an ABSENCE.

test('a poll that cannot enumerate may still record what it saw', async () => {
  const { ingestVeto } = await import('../src/lib/ingest.mjs');
  const partial = succeeded([{ a: 1 }], { complete: false });

  assert.equal(ingestVeto(partial), null, 'its observations are good');
  assert.ok(statusChangeVeto(partial, 40), 'its silences are not');
});

test('a fetch that failed reports nothing at all', async () => {
  const { ingestVeto } = await import('../src/lib/ingest.mjs');
  // An adapter that could not see properly says nothing about the world, so
  // its listings array is not evidence either way.
  assert.match(ingestVeto(failed('timeout')), /poll failed/);
});

test('a suspicious shrink blocks absences without discarding the sightings', async () => {
  const { ingestVeto } = await import('../src/lib/ingest.mjs');
  const shrunk = succeeded(Array.from({ length: 3 }, () => ({ a: 1 })), { complete: true });
  assert.equal(ingestVeto(shrunk), null);
  assert.match(statusChangeVeto(shrunk, 40), /suspiciously fewer/);
});
