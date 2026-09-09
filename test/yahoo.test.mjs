import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as yahoo from '../src/lib/adapters/yahooShopping.mjs';
import { proxyLinksFor, PROXY_SERVICES } from '../src/lib/proxyLinks.mjs';

const hit = (over = {}) => ({
  code: 'shop_abc123',
  name: 'コムデギャルソン オムプリュス ウール ジャケット AD2002',
  price: 48000,
  url: 'https://store.shopping.yahoo.co.jp/shop/abc123.html',
  image: { medium: 'https://item-shopping.c.yimg.jp/i/g/abc123' },
  seller: { sellerId: 'vintage-shop', name: 'Vintage Shop' },
  inStock: true,
  ...over,
});

function fakeFetch(pages) {
  let call = 0;
  return async () => {
    const body = pages[Math.min(call++, pages.length - 1)];
    if (body.status && body.status !== 200) {
      return { ok: false, status: body.status, headers: new Map(), text: async () => '' };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    };
  };
}

const CONFIG = { appId: 'test-app-id', query: 'コムデギャルソン', currency: 'JPY' };

test('a single short page is a complete enumeration', async () => {
  const r = await yahoo.fetchListings(CONFIG, {
    fetchImpl: fakeFetch([{ totalResultsAvailable: 2, hits: [hit(), hit({ code: 'b' })] }]),
  });
  assert.equal(r.ok, true);
  assert.equal(r.complete, true);
  assert.equal(r.listings.length, 2);
});

test('prices are reported in JPY and never converted by the adapter', async () => {
  const r = await yahoo.fetchListings(CONFIG, { fetchImpl: fakeFetch([{ hits: [hit()] }]) });
  assert.equal(r.listings[0].currency, 'JPY');
  assert.equal(r.listings[0].price, 48000);
});

test('a source misconfigured as another currency is refused, not coerced', async () => {
  const r = await yahoo.fetchListings({ ...CONFIG, currency: 'EUR' }, { fetchImpl: fakeFetch([{ hits: [] }]) });
  assert.equal(r.ok, false);
  assert.match(r.error, /quotes JPY/);
});

test('a missing application id fails rather than calling anonymously', async () => {
  const r = await yahoo.fetchListings({ query: 'x', currency: 'JPY' }, { fetchImpl: fakeFetch([{ hits: [] }]) });
  assert.equal(r.ok, false);
  assert.match(r.error, /application ID/);
});

test('a search with neither query nor seller is refused', async () => {
  const r = await yahoo.fetchListings({ appId: 'x', currency: 'JPY' }, { fetchImpl: fakeFetch([{ hits: [] }]) });
  assert.equal(r.ok, false);
  assert.match(r.error, /query or a seller/);
});

test('a 429 reports incomplete so nothing can be marked gone', async () => {
  const r = await yahoo.fetchListings(CONFIG, { fetchImpl: fakeFetch([{ status: 429, hits: [] }]) });
  assert.equal(r.ok, false);
  assert.equal(r.complete, false);
  assert.match(r.error, /rate limited/);
});

test('a 403 names the likely cause instead of retrying blindly', async () => {
  const r = await yahoo.fetchListings(CONFIG, { fetchImpl: fakeFetch([{ status: 403, hits: [] }]) });
  assert.equal(r.ok, false);
  assert.match(r.error, /application ID/);
});

test('hitting the page cap returns real data marked incomplete', async () => {
  const full = { totalResultsAvailable: 5000, hits: Array.from({ length: 50 }, (_, i) => hit({ code: `c${i}` })) };
  const r = await yahoo.fetchListings({ ...CONFIG, maxPages: 2 }, { fetchImpl: fakeFetch([full]) });
  assert.equal(r.ok, true);
  assert.equal(r.complete, false, 'a capped fetch must never claim completeness');
  assert.equal(r.listings.length, 100);
});

test('the rate limit is pushed to the limiter rather than assumed', async () => {
  let told = null;
  await yahoo.fetchListings(CONFIG, {
    fetchImpl: fakeFetch([{ hits: [] }]),
    limiter: { wait: async () => {}, setMinInterval: (ms) => { told = ms; } },
  });
  assert.equal(told, yahoo.MIN_INTERVAL_MS);
  assert.ok(told >= 2000, '30 req/min needs at least 2s spacing');
});

test('out of stock is reported as unavailable, never as sold', async () => {
  const r = await yahoo.fetchListings(CONFIG, { fetchImpl: fakeFetch([{ hits: [hit({ inStock: false })] }]) });
  assert.equal(r.listings[0].available, false);
  assert.equal(r.listings[0].status, undefined, 'an adapter must not set status at all');
});

test('proxy eligibility is captured when stated', async () => {
  const r = await yahoo.fetchListings(CONFIG, {
    fetchImpl: fakeFetch([{ hits: [hit({ purchaseAgency: 1 }), hit({ code: 'x', purchaseAgency: 0 })] }]),
  });
  assert.equal(r.listings[0].extra.proxyPurchasable, true);
  assert.equal(r.listings[1].extra.proxyPurchasable, false);
});

test('absent proxy eligibility is null, not an assumed yes', async () => {
  const r = await yahoo.fetchListings(CONFIG, { fetchImpl: fakeFetch([{ hits: [hit()] }]) });
  assert.equal(r.listings[0].extra.proxyPurchasable, null);
});

// --- proxy links -------------------------------------------------------------

test('proxy links are built for a Japanese source', () => {
  const r = proxyLinksFor({ source_id: 'yahoo_shopping', source_item_id: 'abc123', proxy_purchasable: true });
  assert.equal(r.links.length, PROXY_SERVICES.length);
  assert.ok(r.links.every((l) => l.href.includes('abc123')));
  assert.equal(r.suppressed, false);
});

test('an item the merchant excluded gets no links, and a reason', () => {
  const r = proxyLinksFor({ source_id: 'yahoo_shopping', source_item_id: 'abc123', proxy_purchasable: false });
  assert.equal(r.links.length, 0);
  assert.equal(r.suppressed, true);
  assert.match(r.reason, /excluded/);
});

test('unstated eligibility still links, but warns rather than implying it works', () => {
  const r = proxyLinksFor({ source_id: 'yahoo_shopping', source_item_id: 'abc123', proxy_purchasable: null });
  assert.ok(r.links.length > 0);
  assert.match(r.reason, /did not state/);
});

test('non-Japanese sources get no proxy links at all', () => {
  assert.equal(proxyLinksFor({ source_id: 'grailed', source_item_id: '1' }).links.length, 0);
  assert.equal(proxyLinksFor({ source_id: 'therealreal', source_item_id: '1' }).links.length, 0);
});

test('auctions and shopping use different entry points', () => {
  const shopping = proxyLinksFor({ source_id: 'yahoo_shopping', source_item_id: 'a' }).links;
  const auction = proxyLinksFor({ source_id: 'yahoo_auctions', source_item_id: 'a' }).links;
  assert.notEqual(shopping[0].href, auction[0].href);
});

test('item codes are URL-encoded', () => {
  const r = proxyLinksFor({ source_id: 'yahoo_shopping', source_item_id: 'a b/c' });
  assert.ok(r.links.every((l) => !l.href.includes(' ')));
});

test('one source runs a search per house and pools them', async () => {
  // Japanese secondhand is the point of this adapter, and the chains that
  // carry these labels sell through Yahoo. A source per house would multiply
  // routes by the number of houses; a marketplace is one venue.
  const asked = [];
  const res = await yahoo.fetchListings(
    { appId: 'k', queries: ['ヨウジヤマモト', 'コムデギャルソン'], conditionUsed: true },
    {
      fetchImpl: async (url) => {
        const u = new URL(url);
        asked.push({ q: u.searchParams.get('query'), condition: u.searchParams.get('condition') });
        return new Response(JSON.stringify({
          totalResultsAvailable: 1,
          hits: [{
            code: `c${asked.length}`, name: 'coat', price: 48000,
            url: 'https://example.invalid/x', inStock: true,
          }],
        }), { status: 200 });
      },
    },
  );

  assert.deepEqual(asked.map((a) => a.q), ['ヨウジヤマモト', 'コムデギャルソン']);
  assert.ok(asked.every((a) => a.condition === 'used'), 'used goods only, or these are retail comps');
  assert.equal(res.listings.length, 2);
  assert.equal(res.complete, true);
});

test('one failed search does not lose the others', async () => {
  const res = await yahoo.fetchListings(
    { appId: 'k', queries: ['ヨウジヤマモト', 'BROKEN', 'コムデギャルソン'], conditionUsed: true },
    {
      fetchImpl: async (url) => {
        const q = new URL(url).searchParams.get('query');
        if (q === 'BROKEN') return new Response('boom', { status: 500 });
        return new Response(JSON.stringify({
          totalResultsAvailable: 1,
          hits: [{ code: `c-${q}`, name: 'coat', price: 48000, url: 'https://example.invalid/x', inStock: true }],
        }), { status: 200 });
      },
    },
  );
  assert.equal(res.ok, true);
  assert.equal(res.listings.length, 2);
  assert.equal(res.complete, false, 'a partial view may never conclude anything is gone');
});

test('a rate limit stops asking, keeping what was already collected', async () => {
  let calls = 0;
  const res = await yahoo.fetchListings(
    { appId: 'k', queries: ['A', 'B', 'C', 'D'] },
    {
      fetchImpl: async () => {
        calls++;
        if (calls === 1) {
          return new Response(JSON.stringify({
            totalResultsAvailable: 1,
            hits: [{ code: 'c1', name: 'coat', price: 48000, url: 'https://example.invalid/x', inStock: true }],
          }), { status: 200 });
        }
        return new Response('slow down', { status: 429 });
      },
    },
  );
  assert.equal(res.ok, true);
  assert.equal(res.listings.length, 1);
  assert.equal(calls, 2, 'it stopped after the 429 rather than trying C and D');
});

test('every search failing is still a failure', async () => {
  const res = await yahoo.fetchListings(
    { appId: 'k', queries: ['A', 'B'] },
    { fetchImpl: async () => new Response('nope', { status: 500 }) },
  );
  assert.equal(res.ok, false);
});
