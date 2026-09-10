// What a 429 means, and what it must not cost.
//
// The failure this exists for: a shop whose catalogue runs past the point where
// it first rate-limits could never ingest ANYTHING. The adapter returned
// `failed()` on the 429, a failed poll writes nothing, and so ten pages of real
// listings were thrown away — then re-fetched on the next tick fifteen minutes
// later, hitting the same wall, for ever. Not merely a source stuck at zero: a
// platform hammering a shop hard enough that it began rate-limiting robots.txt
// too, which is how this was reported.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchListings } from '../src/lib/adapters/shopify.mjs';
import { retryAfterSeconds, MAX_RETRY_AFTER_SECONDS } from '../src/lib/adapters/contract.mjs';
import { cooldownMinutes, DEFAULT_COOLDOWN_MINUTES, MIN_COOLDOWN_MINUTES, MAX_COOLDOWN_MINUTES }
  from '../src/lib/ingest.mjs';

const CONFIG = { domain: 'shop.invalid', currency: 'EUR', base: 'https://shop.invalid' };

const product = (id) => ({
  id,
  title: `Comme des Garcons Homme Plus AD2002 wool jacket ${id}`,
  handle: `p${id}`,
  vendor: 'Comme des Garcons',
  images: [{ src: `https://img.invalid/${id}.jpg` }],
  variants: [{ id: id * 10, title: 'M', price: '500.00', available: true }],
});

/** A shop that serves `good` full pages and then rate-limits. */
function shopThatLimitsAfter(good, { retryAfter } = {}) {
  let pages = 0;
  const impl = async (url) => {
    if (String(url).endsWith('/robots.txt')) {
      return new Response('User-agent: *\nAllow: /\n', {
        status: 200, headers: { 'content-type': 'text/plain' },
      });
    }
    pages++;
    if (pages > good) {
      return new Response('', {
        status: 429,
        headers: retryAfter ? { 'retry-after': retryAfter } : {},
      });
    }
    // A full page, so the adapter asks for another.
    return new Response(
      JSON.stringify({ products: Array.from({ length: 250 }, (_, i) => product(pages * 1000 + i)) }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  return { impl, pagesServed: () => pages };
}

test('a rate limit keeps every page that already succeeded', async () => {
  const shop = shopThatLimitsAfter(3, { retryAfter: '600' });
  const res = await fetchListings(CONFIG, { fetchImpl: shop.impl });

  assert.equal(res.ok, true, 'three pages of real listings are not a failed poll');
  assert.equal(res.listings.length, 750);
  assert.equal(res.rateLimited, true);
  assert.match(res.note, /rate limited on page 4/);
});

test('and reports incomplete, which is what makes partial data safe', async () => {
  // An incomplete enumeration may add and re-price and may NEVER conclude that
  // anything is gone. That property is the whole reason keeping the pages costs
  // nothing — statusChangeVeto refuses the absence on its own.
  const shop = shopThatLimitsAfter(2, { retryAfter: '600' });
  const res = await fetchListings(CONFIG, { fetchImpl: shop.impl });
  assert.equal(res.complete, false);
});

test('a rate limit with nothing collected is still a failure', async () => {
  // Reporting ok with an empty list is indistinguishable from a shop that has
  // emptied out, and would be read as one.
  const shop = shopThatLimitsAfter(0, { retryAfter: '600' });
  const res = await fetchListings(CONFIG, { fetchImpl: shop.impl });

  assert.equal(res.ok, false);
  assert.match(res.error, /rate limited on page 1/);
  assert.equal(res.rateLimited, true);
});

test('a short Retry-After is waited out once, in the run', async () => {
  // The shop named a delay it is reasonable to sit through, so the page is
  // asked for again rather than the whole catalogue being abandoned.
  let requests = 0;
  let limited = 0;
  const full = Array.from({ length: 250 }, (_, i) => product(i));
  const impl = async (url) => {
    if (String(url).endsWith('/robots.txt')) {
      return new Response('User-agent: *\nAllow: /\n', { status: 200 });
    }
    requests++;
    // A full first page, so the adapter asks for a second one at all.
    if (requests === 1) {
      return new Response(JSON.stringify({ products: full }), { status: 200 });
    }
    if (requests === 2) {
      limited++;
      return new Response('', { status: 429, headers: { 'retry-after': '1' } });
    }
    // The retry of page 2: a short page, which ends the catalogue.
    return new Response(JSON.stringify({ products: [product(9999)] }), { status: 200 });
  };

  const res = await fetchListings(CONFIG, { fetchImpl: impl });
  assert.equal(res.ok, true);
  assert.equal(limited, 1, 'it hit the limit');
  assert.equal(res.rateLimited, undefined, 'and got past it, so the run was not limited');
  assert.equal(res.listings.length, 251, 'the retried page is kept, not skipped');
  assert.equal(res.complete, true, 'and the catalogue was enumerated after all');
});

test('a robots.txt 429 is a rate limit, not a refusal', async () => {
  // "Do-not-fetch" is the right reading of an UNREADABLE robots.txt, where
  // permission is genuinely unknown. A 429 says "too often" — about frequency,
  // not about permission — and calling it a refusal sent the poller back in
  // fifteen minutes to ask again, which is what escalated it.
  const res = await fetchListings(CONFIG, {
    fetchImpl: async () => new Response('', { status: 429, headers: { 'retry-after': '300' } }),
  });

  assert.equal(res.ok, false);
  assert.match(res.error, /rate limited on robots\.txt/);
  assert.equal(res.rateLimited, true);
  assert.equal(res.retryAfterSeconds, 300);
  assert.doesNotMatch(res.error, /do-not-fetch/);
});

test('an unreadable robots.txt is still a refusal', async () => {
  // The distinction has to cut both ways, or fixing one reading breaks the other.
  const res = await fetchListings(CONFIG, {
    fetchImpl: async () => new Response('', { status: 500 }),
  });
  assert.equal(res.ok, false);
  assert.match(res.error, /do-not-fetch/);
  assert.equal(res.rateLimited, undefined);
});

test('Retry-After is read in both legal forms', () => {
  const now = new Date('2026-09-10T12:00:00Z').getTime();
  assert.equal(retryAfterSeconds('120', now), 120);
  // An HTTP date is legal and appears in the wild; reading only seconds threw
  // away the one number the source volunteered.
  assert.equal(retryAfterSeconds('Thu, 10 Sep 2026 12:05:00 GMT', now), 300);
  // A date already past asks for nothing.
  assert.equal(retryAfterSeconds('Thu, 10 Sep 2026 11:00:00 GMT', now), null);
  assert.equal(retryAfterSeconds('nonsense', now), null);
  // Rounded up, never to zero: a fraction of a second is still a request to wait.
  assert.equal(retryAfterSeconds('0.4', now), 1);
  assert.equal(retryAfterSeconds(null, now), null);
  // Bounded: a header is not something to obey without limit.
  assert.equal(retryAfterSeconds('99999999', now), MAX_RETRY_AFTER_SECONDS);
});

test('a cooldown honours what the shop asked for, within reason', () => {
  assert.equal(cooldownMinutes(600), 10);
  // No number given is not no cooldown.
  assert.equal(cooldownMinutes(null), DEFAULT_COOLDOWN_MINUTES);
  assert.equal(cooldownMinutes(0), DEFAULT_COOLDOWN_MINUTES);
  // Two seconds is not a cooldown worth recording; a fortnight is a header
  // parking a source indefinitely.
  assert.equal(cooldownMinutes(2), MIN_COOLDOWN_MINUTES);
  assert.equal(cooldownMinutes(60 * 60 * 24 * 14), MAX_COOLDOWN_MINUTES);
});
