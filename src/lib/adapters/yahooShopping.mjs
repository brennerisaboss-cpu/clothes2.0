// Yahoo! ショッピング (Shopping) item search v3.
//
// Phase 0 put this ahead of Rakuten in the build order and the reasoning
// stands: an application ID only (no Yahoo account linkage), a documented rate
// limit, confirmed active maintenance, and none of Rakuten's unresolved
// affiliate-purpose ambiguity.
//
// Two things this adapter has to get right that the Shopify one did not:
//
//   1. **Proxy-purchase eligibility.** The February 2026 update added a
//      per-item flag letting merchants exclude products from overseas
//      purchase-agency services. An excluded item cannot be bought through
//      Buyee or ZenMarket at all, so a proxy link for it is worse than useless
//      — it sends you to a dead end at the moment speed matters. Captured here
//      and stored on the listing.
//
//   2. **The rate limit is real.** 30 requests/minute per application ID. The
//      caller's limiter is told about it rather than being left to guess.
//
// As with every adapter: this returns observations, never conclusions. It
// cannot mark anything sold or gone.

import { succeeded, failed } from './contract.mjs';

export const id = 'yahoo_shopping';

const ENDPOINT =
  process.env.YAHOO_ENDPOINT ?? 'https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch';
const PAGE_SIZE = 50;        // API maximum per request
const MAX_RESULTS = 1000;    // API caps the offset window
// 30 requests/minute per app id, so 2s between calls with headroom.
export const MIN_INTERVAL_MS = 2100;

/**
 * @param {object} config { appId, query, sellerId?, currency, maxPages? }
 * @param {object} deps   { fetchImpl, limiter }
 */
export async function fetchListings(config, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const limiter = deps.limiter ?? { wait: async () => {} };

  const appId = config.appId ?? process.env.YAHOO_APP_ID;
  if (!appId) return failed('no Yahoo application ID configured (YAHOO_APP_ID)');
  // One source may carry several searches, for the same reason eBay does: a
  // marketplace is one venue, and a source per house would multiply routes by
  // the number of houses and score every listing against all of them.
  const queries = config.queries ?? (config.query ? [config.query] : []);
  if (!queries.length && !config.sellerId) {
    return failed('a Yahoo source needs a search query or a seller id');
  }
  // Yahoo Shopping prices are always JPY. Stated rather than inferred, and
  // still refused if the config disagrees, so a misconfigured source cannot
  // quietly mislabel every price.
  const currency = config.currency ?? 'JPY';
  if (currency !== 'JPY') {
    return failed(`Yahoo Shopping quotes JPY; source is configured as ${currency}`);
  }

  if (limiter.setMinInterval) limiter.setMinInterval(MIN_INTERVAL_MS);

  const listings = [];
  let allComplete = true;
  let totalPages = 0;
  // One search failing must not discard the others: a source carries a search
  // per house, and abandoning the run on a transient error throws away
  // everything collected before it. A skipped search marks the poll INCOMPLETE
  // instead, which is the property that matters — an incomplete enumeration
  // may never conclude that a listing is gone.
  const failures = [];
  let rateLimited = false;
  // Summed across searches, so a partial poll can say how much it did not see.
  let availableTotal = null;

  // A seller-only source has no query; run it once with none.
  for (const query of (queries.length ? queries : [null])) {
  if (rateLimited) break;
  let start = 1;
  let total = null;
  let pages = 0;
  const maxPages = Math.min(config.maxPages ?? 20, Math.ceil(MAX_RESULTS / PAGE_SIZE));

  while (pages < maxPages) {
    await limiter.wait();

    const url = new URL(ENDPOINT);
    url.searchParams.set('appid', appId);
    url.searchParams.set('results', String(PAGE_SIZE));
    url.searchParams.set('start', String(start));
    if (query) url.searchParams.set('query', query);
    if (config.sellerId) url.searchParams.set('seller_id', config.sellerId);
    // Used goods only where the caller asks for it; Yahoo mixes new and used.
    if (config.conditionUsed) url.searchParams.set('condition', 'used');

    let res;
    try {
      res = await fetchImpl(url.toString(), {
        headers: { accept: 'application/json', 'user-agent': config.userAgent ?? 'resale-tracker/0.1' },
      });
    } catch (err) {
      failures.push(`${query ?? 'seller'}: ${err?.message ?? err}`);
      break;
    }

    if (res.status === 429) {
      // Stop asking altogether. The limit is 30 requests a minute per app id,
      // and spending the remaining searches collecting 429s is exactly what it
      // exists to prevent.
      failures.push(`${query ?? 'seller'}: rate limited`);
      rateLimited = true;
      break;
    }
    if (res.status === 403) {
      // Almost always a bad or revoked app id. Not something to retry around.
      return failed('Yahoo returned 403 — check the application ID is valid and enabled');
    }
    if (!res.ok) { failures.push(`${query ?? 'seller'}: HTTP ${res.status}`); break; }

    let body;
    try {
      body = JSON.parse(await res.text());
    } catch {
      failures.push(`${query ?? 'seller'}: response was not JSON`);
      break;
    }

    const hits = body?.hits;
    if (!Array.isArray(hits)) {
      failures.push(`${query ?? 'seller'}: response had no hits array`);
      break;
    }

    if (total == null) {
      total = Number(body.totalResultsAvailable ?? 0);
      availableTotal = (availableTotal ?? 0) + total;
    }
    for (const hit of hits) listings.push(toListing(hit));
    pages++;

    if (hits.length < PAGE_SIZE) {
      // Short page: this search is exhausted. Move to the next one rather than
      // returning, or only the first house would ever be fetched.
      break;
    }
    start += PAGE_SIZE;
    if (start > MAX_RESULTS) break;
  }

  totalPages += pages;
  // Any search that stopped with results outstanding makes the whole poll a
  // partial view, and a partial view may never conclude anything is gone.
  if (total != null && total > listings.length && start > MAX_RESULTS) allComplete = false;
  if (pages >= maxPages) allComplete = false;
  }

  // A bad app id fails every search identically, so that stays a whole-source
  // failure (handled above as a 403). Everything failing for other reasons is
  // still a failure: there is no data, and no reason to think this is healthy.
  if (failures.length === (queries.length || 1)) {
    return failed(`all searches failed — first: ${failures[0]}`, undefined,
      { rateLimited: rateLimited || undefined });
  }
  if (failures.length) allComplete = false;

  if (allComplete) {
    return succeeded(listings, {
      complete: true,
      pages: totalPages,
      note: `${listings.length} across ${queries.length || 1} search${(queries.length || 1) === 1 ? '' : 'es'}`,
    });
  }

  // Stopped at a cap with more results outstanding. Real data, partial view —
  // and a partial view may never be used to conclude anything is gone.
  return succeeded(listings, {
    complete: false,
    pages: totalPages,
    // A limit reached mid-run is why this stopped, and the runner turns it into
    // a cooldown rather than asking again on the next tick.
    rateLimited: rateLimited || undefined,
    note:
      availableTotal != null && availableTotal > listings.length
        ? `${listings.length} of ${availableTotal} results fetched; capped`
        : 'stopped at the page cap',
  });
}

/**
 * `inStock: false` on Yahoo means out of stock, which for a one-off used
 * listing usually means sold — but "usually" is not evidence, and the ingest
 * layer maps unavailable to `unknown`, never to a sale.
 */
function toListing(hit) {
  const price = Number(hit?.price);
  return {
    sourceItemId: String(hit?.code ?? hit?.janCode ?? hit?.url ?? ''),
    title: hit?.name ?? '',
    brandRaw: hit?.brand?.name ?? null,
    price: Number.isFinite(price) ? price : NaN,
    currency: 'JPY',
    // Yahoo has no size field; sizes live in the title, which the size parser
    // does not attempt to mine. Left null rather than guessed.
    sizeRaw: null,
    // No condition vocabulary either, beyond the coarse new/used search filter.
    conditionRaw: hit?.condition ?? null,
    url: hit?.url ?? null,
    imageUrl: hit?.image?.medium ?? hit?.image?.small ?? null,
    sellerId: hit?.seller?.sellerId ?? hit?.seller?.name ?? null,
    available: hit?.inStock !== false,
    extra: {
      // The Feb 2026 field. 1 = purchasable via an overseas proxy service,
      // 0 = the merchant has excluded it. Suppress proxy links when excluded.
      proxyPurchasable: normaliseProxyFlag(hit),
      storeName: hit?.seller?.name ?? null,
      janCode: hit?.janCode ?? null,
    },
  };
}

function normaliseProxyFlag(hit) {
  // Yahoo has used more than one spelling for this field across revisions, so
  // check the known ones and return null when none is present rather than
  // assuming the item is purchasable.
  const raw =
    hit?.purchaseAgency ??
    hit?.purchase_agency ??
    hit?.seller?.purchaseAgency ??
    null;
  if (raw == null) return null;
  return Number(raw) === 1;
}
