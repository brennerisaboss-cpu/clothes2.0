import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as rakuten from '../src/lib/adapters/rakuten.mjs';
import * as ebay from '../src/lib/adapters/ebay.mjs';

const ok = (body) => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) });
const bad = (status, body = '') => ({ ok: false, status, headers: { get: () => null }, text: async () => body });

// --- Rakuten -----------------------------------------------------------------

const rItem = (code, name, price, over = {}) => ({
  Item: {
    itemCode: code, itemName: name, itemPrice: price,
    itemUrl: `https://item.rakuten.co.jp/${code}/`,
    mediumImageUrls: [{ imageUrl: `https://thumb.rakuten/${code}.jpg` }],
    shopCode: 'brandshop', shopName: 'Brand Recycle Shop',
    availability: 1, ...over,
  },
});

const R_CONFIG = { appId: 'app', keyword: 'コムデギャルソン', currency: 'JPY' };

test('rakuten: a short page is a complete enumeration', async () => {
  const r = await rakuten.fetchListings(R_CONFIG, {
    fetchImpl: async () => ok({ pageCount: 1, Items: [rItem('a', 'コムデギャルソン ジャケット', 48000)] }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.complete, true);
  assert.equal(r.listings[0].currency, 'JPY');
  assert.equal(r.listings[0].price, 48000);
});

test('rakuten: refuses without an application id', async () => {
  const r = await rakuten.fetchListings({ keyword: 'x', currency: 'JPY' }, { fetchImpl: async () => ok({}) });
  assert.equal(r.ok, false);
  assert.match(r.error, /application ID/);
});

test('rakuten: refuses a non-JPY configuration rather than coercing it', async () => {
  const r = await rakuten.fetchListings({ ...R_CONFIG, currency: 'EUR' }, { fetchImpl: async () => ok({}) });
  assert.equal(r.ok, false);
  assert.match(r.error, /quotes JPY/);
});

test('rakuten: a 400 names both plausible causes rather than guessing', async () => {
  const r = await rakuten.fetchListings(R_CONFIG, { fetchImpl: async () => bad(400) });
  assert.equal(r.ok, false);
  assert.match(r.error, /bad parameters or quota/);
});

test('rakuten: an error body is surfaced', async () => {
  const r = await rakuten.fetchListings(R_CONFIG, {
    fetchImpl: async () => ok({ error: 'wrong_parameter', error_description: 'bad appid' }),
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /wrong_parameter/);
});

test('rakuten: unavailable items are reported unavailable, never sold', async () => {
  const r = await rakuten.fetchListings(R_CONFIG, {
    fetchImpl: async () => ok({ pageCount: 1, Items: [rItem('a', 'ギャルソン コート', 30000, { availability: 0 })] }),
  });
  assert.equal(r.listings[0].available, false);
  assert.equal(r.listings[0].status, undefined);
});

test('rakuten: malformed items are dropped, not stored with NaN prices', async () => {
  const r = await rakuten.fetchListings(R_CONFIG, {
    fetchImpl: async () => ok({ pageCount: 1, Items: [{ Item: { itemName: 'no code or price' } }] }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.listings.length, 0);
});

test('rakuten: hitting the page cap reports incomplete', async () => {
  const page = { pageCount: 50, Items: Array.from({ length: 30 }, (_, i) => rItem(`c${i}`, 'ギャルソン', 1000)) };
  const r = await rakuten.fetchListings({ ...R_CONFIG, maxPages: 2 }, { fetchImpl: async () => ok(page) });
  assert.equal(r.ok, true);
  assert.equal(r.complete, false);
  assert.equal(r.listings.length, 60);
});

test('rakuten: pushes its rate limit to the limiter', async () => {
  let told = null;
  await rakuten.fetchListings(R_CONFIG, {
    fetchImpl: async () => ok({ pageCount: 1, Items: [] }),
    limiter: { wait: async () => {}, setMinInterval: (ms) => { told = ms; } },
  });
  assert.equal(told, rakuten.MIN_INTERVAL_MS);
});

// --- eBay --------------------------------------------------------------------

const eItem = (id, title, value, over = {}) => ({
  itemId: id, title,
  price: { value: String(value), currency: 'GBP' },
  itemWebUrl: `https://www.ebay.co.uk/itm/${id}`,
  image: { imageUrl: `https://i.ebayimg.com/${id}.jpg` },
  condition: 'Pre-owned',
  seller: { username: 'archive_seller' },
  ...over,
});

const E_CONFIG = { query: 'comme des garcons homme plus', token: 'test-token' };

test('ebay: a short page is complete and prices carry their stated currency', async () => {
  const r = await ebay.fetchListings(E_CONFIG, {
    fetchImpl: async () => ok({ total: 1, itemSummaries: [eItem('v1|1', 'CDG Homme Plus jacket', 420)] }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.complete, true);
  assert.equal(r.listings[0].currency, 'GBP', 'eBay states currency per item; never inferred');
  assert.equal(r.listings[0].price, 420);
});

test('ebay: a zero-result search is a legitimate empty answer', async () => {
  const r = await ebay.fetchListings(E_CONFIG, { fetchImpl: async () => ok({ total: 0 }) });
  assert.equal(r.ok, true);
  assert.equal(r.complete, true);
  assert.equal(r.listings.length, 0);
});

test('ebay: a 403 names the Application Growth Check gate', async () => {
  const r = await ebay.fetchListings(E_CONFIG, { fetchImpl: async () => bad(403) });
  assert.equal(r.ok, false);
  assert.match(r.error, /Growth Check/);
});

test('ebay: a 401 is reported as a token problem, not retried blindly', async () => {
  const r = await ebay.fetchListings(E_CONFIG, { fetchImpl: async () => bad(401) });
  assert.equal(r.ok, false);
  assert.match(r.error, /token/);
});

test('ebay: a 429 reports incomplete so nothing can be marked gone', async () => {
  const r = await ebay.fetchListings(E_CONFIG, { fetchImpl: async () => bad(429) });
  assert.equal(r.ok, false);
  assert.equal(r.complete, false);
});

test('ebay: listings are flagged as carrying no sold data', async () => {
  const r = await ebay.fetchListings(E_CONFIG, {
    fetchImpl: async () => ok({ total: 1, itemSummaries: [eItem('v1|1', 'x', 100)] }),
  });
  assert.equal(r.listings[0].extra.soldDataAvailable, false);
});

test('ebay: items without a price or id are dropped', async () => {
  const r = await ebay.fetchListings(E_CONFIG, {
    fetchImpl: async () => ok({ total: 2, itemSummaries: [{ title: 'no id' }, eItem('v1|2', 'ok', 50)] }),
  });
  assert.equal(r.listings.length, 1);
});

test('ebay: a query is required', async () => {
  const r = await ebay.fetchListings({ token: 't' }, { fetchImpl: async () => ok({}) });
  assert.equal(r.ok, false);
  assert.match(r.error, /query/);
});

test('ebay: the token request reports a clean failure', async () => {
  const r = await ebay.fetchToken({ clientId: 'a', clientSecret: 'b', fetchImpl: async () => bad(401) });
  assert.equal(r.ok, false);
  assert.match(r.error, /401/);
});

test('ebay: a successful token round-trip returns the token', async () => {
  const r = await ebay.fetchToken({
    clientId: 'a', clientSecret: 'b',
    fetchImpl: async () => ok({ access_token: 'abc', expires_in: 7200 }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.token, 'abc');
});

test('ebay: missing credentials fail before any network call', async () => {
  let called = false;
  const r = await ebay.fetchToken({ fetchImpl: async () => { called = true; return ok({}); } });
  assert.equal(r.ok, false);
  assert.equal(called, false);
});
