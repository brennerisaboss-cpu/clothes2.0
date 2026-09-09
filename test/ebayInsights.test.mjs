// eBay Marketplace Insights — the only sanctioned source of sold prices.
//
// Everything else in the platform reports asking prices, so every margin rests
// on what two people hoped for. This adapter is the one that can say what
// somebody actually paid, which is the difference between a number worth acting
// on and a number worth looking at.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchListings, toSale, soldSinceFilter, scopeFor, MAX_WINDOW_DAYS,
} from '../src/lib/adapters/ebayInsights.mjs';

const sale = (id, price, soldAt) => ({
  itemId: id,
  title: 'Yohji Yamamoto Pour Homme wool coat',
  lastSoldPrice: { value: String(price), currency: 'GBP' },
  lastSoldDate: soldAt,
  condition: 'Used',
  itemWebUrl: 'https://example.invalid/x',
  seller: { username: 'someone' },
});

const respond = (body, status = 200) =>
  new Response(JSON.stringify(body), { status });

test('a completed sale is reported as one, with the date it happened', async () => {
  const res = await fetchListings(
    { queries: ['Yohji Yamamoto'], token: 't' },
    { fetchImpl: async () => respond({ total: 1, itemSales: [sale('v1|1|0', 640, '2026-07-02T10:00:00.000Z')] }) },
  );

  assert.equal(res.ok, true);
  assert.equal(res.listings.length, 1);
  const [got] = res.listings;
  assert.equal(got.evidence, 'confirmed_sale');
  assert.equal(got.price, 640);
  assert.equal(got.currency, 'GBP');
  assert.equal(got.soldAt.toISOString(), '2026-07-02T10:00:00.000Z');
  assert.equal(got.extra.soldDataAvailable, true);
});

test('it never claims to have enumerated a catalogue', async () => {
  // The property that makes the whole thing safe. A sold-item search is a
  // ranked sample over a ninety-day window, so its silences mean nothing — and
  // statusChangeVeto refuses to conclude an absence from an incomplete read, so
  // a sale ageing out of the window can never become a phantom delisting.
  const res = await fetchListings(
    { queries: ['Guidi'], token: 't' },
    { fetchImpl: async () => respond({ total: 1, itemSales: [sale('v1|2|0', 500, '2026-08-01T00:00:00.000Z')] }) },
  );
  assert.equal(res.ok, true);
  assert.equal(res.complete, false);
});

test('a sale with no date or no price is not a sale', async () => {
  // An undated sale cannot be weighted for recency, and stamping it with
  // today's date is the failure the date exists to prevent.
  assert.equal(toSale({ itemId: 'x', lastSoldPrice: { value: 'nonsense', currency: 'GBP' } }), null);
  assert.equal(toSale({ itemId: 'x', lastSoldPrice: { value: '10' } }), null);
  assert.equal(toSale({ lastSoldPrice: { value: '10', currency: 'GBP' } }), null);
  assert.equal(toSale({ ...sale('x', 10, 'not a date') }).soldAt, null);
});

test('the window is bounded at both ends and capped at what the API serves', () => {
  const now = new Date('2026-09-09T00:00:00.000Z');
  const filter = soldSinceFilter(30, now);
  assert.match(filter, /^lastSoldDate:\[2026-08-10T00:00:00\.000Z\.\.2026-09-09T00:00:00\.000Z\]$/);

  // Asking for more than the API serves returns an error rather than more data.
  const capped = soldSinceFilter(400, now);
  const from = capped.match(/\[(.*?)\.\./)[1];
  const days = (now.getTime() - new Date(from).getTime()) / 86_400_000;
  assert.equal(days, MAX_WINDOW_DAYS);
});

test('it asks for its own scope, not the Browse one', () => {
  // Requesting the wrong scope succeeds — eBay issues a token — and then every
  // search returns 403, which reads as an access problem with the API rather
  // than with the token that was asked for.
  assert.match(scopeFor('APPID-PRD-abc'), /buy\.marketplace\.insights$/);
  assert.match(scopeFor('APPID-SBX-abc'), /^https:\/\/api\.sandbox\.ebay\.com\//);
});

test('a 403 names the limited release rather than being retried', async () => {
  let calls = 0;
  const res = await fetchListings(
    { queries: ['Guidi'], token: 't' },
    { fetchImpl: async () => { calls++; return respond({}, 403); } },
  );
  assert.equal(res.ok, false);
  assert.equal(calls, 1, 'a gate on the keyset is not a transient error');
  assert.match(res.error, /limited release/i);
  assert.match(res.error, /separate/i);
});

test('a search with no sales in the window is an empty answer, not a fault', async () => {
  // For thin archive pieces it is the common one.
  const res = await fetchListings(
    { queries: ['Nothing Sold', 'Guidi'], token: 't' },
    {
      fetchImpl: async (url) => {
        const q = new URL(url).searchParams.get('q');
        if (q === 'Nothing Sold') return respond({ total: 0 });
        return respond({ total: 1, itemSales: [sale('v1|3|0', 500, '2026-08-01T00:00:00.000Z')] });
      },
    },
  );
  assert.equal(res.ok, true);
  assert.equal(res.listings.length, 1);
});

test('a rate limit stops asking rather than spending the rest on 429s', async () => {
  const asked = [];
  const res = await fetchListings(
    { queries: ['a', 'b', 'c'], token: 't' },
    {
      fetchImpl: async (url) => {
        asked.push(new URL(url).searchParams.get('q'));
        return respond({}, 429);
      },
    },
  );
  assert.deepEqual(asked, ['a'], 'the Insights quota is smaller than the Browse one');
  assert.equal(res.ok, false);
});
