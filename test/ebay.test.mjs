import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchListings } from '../src/lib/adapters/ebay.mjs';

test('one source runs several searches and pools them', async () => {
  // Per-house searches are necessary because eBay ranks and truncates a broad
  // query. Making each its own SOURCE would multiply routes by the number of
  // houses and score every listing against all of them, so they live inside
  // one source and the exit venue stays one venue.
  const seen = [];
  const res = await fetchListings(
    { queries: ['Yohji Yamamoto', 'Guidi'], token: 't', marketplaceId: 'EBAY_GB' },
    {
      fetchImpl: async (url) => {
        seen.push(new URL(url).searchParams.get('q'));
        return new Response(JSON.stringify({
          total: 1,
          itemSummaries: [{
            itemId: `v1|${seen.length}|0`,
            title: `${seen[seen.length - 1]} coat`,
            price: { value: '500.00', currency: 'GBP' },
            condition: 'Used',
            itemWebUrl: 'https://example.invalid/x',
          }],
        }), { status: 200 });
      },
    },
  );

  assert.deepEqual(seen, ['Yohji Yamamoto', 'Guidi']);
  assert.equal(res.ok, true);
  assert.equal(res.listings.length, 2);
  assert.equal(res.complete, true);
});

test('a search returning nothing does not fail the whole source', async () => {
  const res = await fetchListings(
    { queries: ['Nothing Here', 'Guidi'], token: 't' },
    {
      fetchImpl: async (url) => {
        const q = new URL(url).searchParams.get('q');
        if (q === 'Nothing Here') return new Response(JSON.stringify({ total: 0 }), { status: 200 });
        return new Response(JSON.stringify({
          total: 1,
          itemSummaries: [{
            itemId: 'v1|2|0', title: 'Guidi boot',
            price: { value: '640.00', currency: 'GBP' }, condition: 'Used',
            itemWebUrl: 'https://example.invalid/g',
          }],
        }), { status: 200 });
      },
    },
  );
  assert.equal(res.ok, true);
  assert.equal(res.listings.length, 1);
  assert.equal(res.complete, true, 'an empty search is a real answer, not a truncated one');
});

// --- one search failing must not lose the others ----------------------------

test('a failed search is skipped, and the rest still land', async () => {
  // A source carries a search per house, so abandoning the run on a transient
  // error throws away everything collected before it — and the next run starts
  // from nothing again.
  const res = await fetchListings(
    { queries: ['Good One', 'Bad One', 'Another Good'], token: 't' },
    {
      fetchImpl: async (url) => {
        const q = new URL(url).searchParams.get('q');
        if (q === 'Bad One') return new Response('boom', { status: 500 });
        return new Response(JSON.stringify({
          total: 1,
          itemSummaries: [{
            itemId: `v1|${q}|0`, title: `${q} coat`,
            price: { value: '500.00', currency: 'GBP' }, condition: 'Used',
            itemWebUrl: 'https://example.invalid/x',
          }],
        }), { status: 200 });
      },
    },
  );

  assert.equal(res.ok, true);
  assert.equal(res.listings.length, 2, 'the two good searches still landed');
  // The safety property that matters: a partial view may never be used to
  // conclude a listing is gone.
  assert.equal(res.complete, false);
  assert.match(res.note, /1 failed/);
});

test('a rate limit stops asking rather than spending every search on 429s', async () => {
  let calls = 0;
  const res = await fetchListings(
    { queries: ['A', 'B', 'C', 'D'], token: 't' },
    {
      fetchImpl: async () => {
        calls++;
        if (calls === 1) {
          return new Response(JSON.stringify({
            total: 1,
            itemSummaries: [{
              itemId: 'v1|1|0', title: 'a coat',
              price: { value: '500.00', currency: 'GBP' }, condition: 'Used',
              itemWebUrl: 'https://example.invalid/x',
            }],
          }), { status: 200 });
        }
        return new Response('slow down', { status: 429 });
      },
    },
  );

  assert.equal(res.ok, true);
  assert.equal(res.listings.length, 1, 'what was collected before the limit is kept');
  assert.equal(res.complete, false);
  assert.equal(calls, 2, 'it stopped asking after the 429 rather than trying C and D');
  assert.match(res.note, /rate limit/);
});

test('every search failing is a failure, not an empty success', async () => {
  const res = await fetchListings(
    { queries: ['A', 'B'], token: 't' },
    { fetchImpl: async () => new Response('nope', { status: 500 }) },
  );
  assert.equal(res.ok, false);
  assert.equal(res.complete, false);
});

test('a bad token still fails the whole source', async () => {
  // It will fail every remaining search identically; carrying on would be
  // pointless and would look like a partial result.
  const res = await fetchListings(
    { queries: ['A', 'B'], token: 'stale' },
    { fetchImpl: async () => new Response('unauthorized', { status: 401 }) },
  );
  assert.equal(res.ok, false);
  assert.match(res.error, /401/);
});

// --- which eBay a keyset belongs to ------------------------------------------
//
// eBay runs two separate worlds on two hostnames and binds a keyset to one of
// them. Sent to the wrong host either keyset fails with `invalid_client` —
// which reads as a typo, and sends you back to re-copy a secret that was never
// wrong. So the host is derived from the key rather than configured beside it,
// and the two are then incapable of disagreeing.

test('the host and the scope come from the keyset, not from configuration', async () => {
  const { fetchToken, isSandboxKey, hostFor, SANDBOX, PRODUCTION } =
    await import('../src/lib/adapters/ebay.mjs');

  assert.equal(isSandboxKey('bS-clothing-SBX-25fe88853-8c22cd56'), true);
  assert.equal(isSandboxKey('bS-clothing-PRD-25fe88853-8c22cd56'), false);
  assert.equal(hostFor('x-y-SBX-z'), SANDBOX);
  assert.equal(hostFor('x-y-PRD-z'), PRODUCTION);
  // An id in neither form is not assumed to be a sandbox one: production is
  // the safe default here, because a production key sent to sandbox merely
  // fails, while the reverse would silently point a live source at fixtures.
  assert.equal(hostFor('something-else'), PRODUCTION);

  for (const [clientId, host] of [
    ['bS-clothing-SBX-25fe88853-8c22cd56', SANDBOX],
    ['bS-clothing-PRD-25fe88853-8c22cd56', PRODUCTION],
  ]) {
    const seen = [];
    await fetchToken({
      clientId,
      clientSecret: 'secret',
      fetchImpl: async (url, init) => {
        seen.push({ url: String(url), body: String(init.body) });
        return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 't', expires_in: 7200 }) };
      },
    });
    assert.equal(seen[0].url, `${host}/identity/v1/oauth2/token`);
    assert.match(seen[0].body, new RegExp(encodeURIComponent(`${host}/oauth/api_scope`)));
  }
});

test('a sandbox keyset searches the sandbox, not production', async () => {
  const { fetchListings, SANDBOX } = await import('../src/lib/adapters/ebay.mjs');
  const seen = [];
  await fetchListings(
    { queries: ['Comme des Garçons'], clientId: 'a-b-SBX-c', token: 't', maxPages: 1 },
    {
      fetchImpl: async (url) => {
        seen.push(String(url));
        return { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify({ itemSummaries: [], total: 0 }) };
      },
    },
  );
  assert.ok(seen[0].startsWith(`${SANDBOX}/buy/browse/v1/item_summary/search`), seen[0]);
});
