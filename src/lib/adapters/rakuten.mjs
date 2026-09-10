// Rakuten Ichiba item search.
//
// Two caveats from the phase 0 research that this adapter cannot solve for you,
// and does not pretend to:
//
//   1. Rakuten describes these APIs as provided free for Ichiba members to use
//      for AFFILIATE purposes. A private price-tracking tool may sit outside
//      that intent. Registering for the application ID means accepting those
//      terms — your call, not this code's.
//   2. The affiliate partner terms Rakuten Web Service is tethered to prohibit
//      affiliate links on sites promoting 転売 (reselling). This tool places no
//      links and publishes nothing, so it probably does not bite, but it is the
//      exact category named.
//
// And one structural limit: Ichiba is B2C shop listings only. No Rakuma, no
// auctions, no C2C. For CDG that means brand-recycle boutiques running Ichiba
// storefronts — a real but shallow surface.

import { succeeded, failed, retryAfterSeconds } from './contract.mjs';

export const id = 'rakuten';

const ENDPOINT =
  process.env.RAKUTEN_ENDPOINT ??
  'https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601';
const PAGE_SIZE = 30;   // API maximum
const MAX_PAGE = 100;   // API maximum
// Commonly documented as roughly 1 request/second. Spaced conservatively.
export const MIN_INTERVAL_MS = 1200;

export async function fetchListings(config, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const limiter = deps.limiter ?? { wait: async () => {} };

  const appId = config.appId ?? process.env.RAKUTEN_APP_ID;
  if (!appId) return failed('no Rakuten application ID configured (RAKUTEN_APP_ID)');
  if (!config.keyword && !config.shopCode) {
    return failed('a Rakuten source needs a keyword or a shop code');
  }
  const currency = config.currency ?? 'JPY';
  if (currency !== 'JPY') {
    return failed(`Rakuten Ichiba quotes JPY; source is configured as ${currency}`);
  }

  if (limiter.setMinInterval) limiter.setMinInterval(MIN_INTERVAL_MS);

  const listings = [];
  let page = 1;
  let pageCount = null;
  const maxPages = Math.min(config.maxPages ?? 10, MAX_PAGE);

  for (; page <= maxPages; page++) {
    await limiter.wait();

    const url = new URL(ENDPOINT);
    url.searchParams.set('applicationId', appId);
    url.searchParams.set('format', 'json');
    url.searchParams.set('hits', String(PAGE_SIZE));
    url.searchParams.set('page', String(page));
    if (config.keyword) url.searchParams.set('keyword', config.keyword);
    if (config.shopCode) url.searchParams.set('shopCode', config.shopCode);
    if (config.genreId) url.searchParams.set('genreId', String(config.genreId));

    let res;
    try {
      res = await fetchImpl(url.toString(), {
        headers: { accept: 'application/json', 'user-agent': config.userAgent ?? 'resale-tracker/0.1' },
      });
    } catch (err) {
      return failed(`page ${page} request failed: ${err?.message ?? err}`);
    }

    if (res.status === 429) {
      // Reported as a rate limit so the runner can put the source on a cooldown
      // rather than asking again on the next tick.
      const wait = retryAfterSeconds(res.headers?.get?.('retry-after'));
      return failed(`rate limited on page ${page}`, undefined,
        { rateLimited: true, retryAfterSeconds: wait ?? undefined });
    }
    // Rakuten uses 400 for a quota breach as well as bad params, so the message
    // stays honest about the ambiguity rather than guessing.
    if (res.status === 400) return failed(`page ${page} returned 400 — bad parameters or quota exceeded`);
    if (!res.ok) return failed(`page ${page} returned HTTP ${res.status}`);

    let body;
    try {
      body = JSON.parse(await res.text());
    } catch {
      return failed(`page ${page} was not JSON`);
    }
    if (body?.error) return failed(`Rakuten error: ${body.error} ${body.error_description ?? ''}`.trim());

    const items = body?.Items;
    if (!Array.isArray(items)) return failed(`page ${page} had no Items array`);

    for (const wrapper of items) {
      const item = wrapper?.Item ?? wrapper;
      const listing = toListing(item);
      if (listing) listings.push(listing);
    }

    if (pageCount == null) pageCount = Number(body.pageCount ?? 1);
    if (page >= pageCount || items.length < PAGE_SIZE) {
      return succeeded(listings, { complete: true, pages: page });
    }
  }

  return succeeded(listings, {
    complete: false,
    pages: page - 1,
    note: `stopped at the ${maxPages}-page cap; ${pageCount ?? '?'} pages available`,
  });
}

function toListing(item) {
  const price = Number(item?.itemPrice);
  const code = item?.itemCode;
  if (!code || !Number.isFinite(price)) return null;

  return {
    sourceItemId: String(code),
    title: item.itemName ?? '',
    // Ichiba has no brand field; the brand lives in the title and is resolved
    // by the shared alias table rather than guessed here.
    brandRaw: null,
    price,
    currency: 'JPY',
    sizeRaw: null,
    conditionRaw: null,
    url: item.itemUrl ?? null,
    imageUrl: item.mediumImageUrls?.[0]?.imageUrl ?? item.smallImageUrls?.[0]?.imageUrl ?? null,
    sellerId: item.shopCode ?? item.shopName ?? null,
    // availability 1 = purchasable. Anything else is not a statement that it
    // sold, so the ingest layer maps it to unknown.
    available: Number(item.availability) === 1,
    extra: {
      shopName: item.shopName ?? null,
      shopCode: item.shopCode ?? null,
      // Ichiba is B2C only — no C2C inventory reaches this endpoint at all.
      marketplace: 'ichiba_b2c',
    },
  };
}
