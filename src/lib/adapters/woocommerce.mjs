// Generic WooCommerce adapter.
//
// The second platform small dealers actually run on. Shopify covers a lot of
// them and nothing else was supported, so every shop on WordPress — which is a
// large share of one-person archive dealers — could only ever be entered by
// hand.
//
// WooCommerce ships a public, unauthenticated Store API:
//
//   /wp-json/wc/store/v1/products?per_page=100&page=1
//
// It is meant for a shop's own front end, so it is on by default, needs no key
// and is documented rather than reverse-engineered.
//
// One thing it does BETTER than Shopify's products.json: it states its own
// currency, per price, as an ISO code plus the number of minor units. So this
// adapter never needs a currency configured and never guesses one — the price
// and the code arrive together and travel together. `currency` in config is
// accepted as a fallback for a shop whose API omits it, and a mismatch is
// reported rather than silently resolved.
//
// What it does not do, same as every adapter here: it never concludes a piece
// was sold. `is_in_stock: false` means sold, reserved, or withdrawn, and the
// ingest layer maps that to "unknown".

import { succeeded, failed, retryAfterSeconds } from './contract.mjs';
import { parseRobots, isAllowed } from '../robots.mjs';

const PATH = '/wp-json/wc/store/v1/products';
const PAGE_SIZE = 100;                        // the Store API's documented maximum
const MAX_PAGES = 50;

// How long this will sit and wait inside a single run when a shop names a
// delay. Long enough to ride out the short bursts that are most of what a
// `Retry-After` says, short enough that a poll cannot become a job that holds a
// connection for an hour. Anything longer becomes a cooldown instead, which is
// the right shape for it: waiting is what the next run is for.
const MAX_INLINE_RETRY_SECONDS = 30;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const id = 'woocommerce';

/**
 * @param {object} config  { domain, currency?, userAgent, maxPages?, base? }
 * @param {object} deps    { fetchImpl, limiter, log }
 */
export async function fetchListings(config, deps = {}) {
  const { domain, userAgent } = config;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const limiter = deps.limiter ?? { wait: async () => {} };

  if (!domain) return failed('no domain configured');

  const base = config.base ?? `https://${domain}`;

  // robots.txt first, every run — a shop can add a Disallow at any time.
  await limiter.wait();
  let groups;
  try {
    const res = await fetchImpl(`${base}/robots.txt`, {
      headers: { 'user-agent': userAgent, accept: 'text/plain' },
    });
    if (res.status === 200) groups = parseRobots(await res.text());
    else if (res.status === 404) groups = [];
    else if (res.status === 429) {
      // A rate limit is not a refusal, and calling it one was a category error.
      //
      // "Do-not-fetch" is the right reading of an UNREADABLE robots.txt — a 500,
      // a timeout, something that leaves permission genuinely unknown, where
      // failing closed is the only safe answer. A 429 is not that. It is the
      // shop saying "you are asking too often", which is a statement about
      // frequency and says nothing about permission at all.
      //
      // The run still stops here: permission cannot be confirmed this minute, so
      // nothing may be fetched. But it stops as a rate limit, which the runner
      // turns into a cooldown — where "do-not-fetch" simply came back in fifteen
      // minutes and asked again, which is what escalated a busy shop into
      // rate-limiting robots.txt in the first place.
      const wait = retryAfterSeconds(res.headers?.get?.('retry-after'));
      return failed(
        'rate limited on robots.txt',
        wait ? `the shop asked for ${wait}s` : 'no Retry-After given',
        { rateLimited: true, retryAfterSeconds: wait ?? undefined },
      );
    } else {
      return failed(`robots.txt returned ${res.status} — treated as do-not-fetch`);
    }
  } catch (err) {
    return failed(`robots.txt unreachable: ${err?.message ?? err}`);
  }

  const verdict = isAllowed(groups, userAgent, PATH);
  if (!verdict.allowed) return failed(`robots.txt disallows ${PATH} (${verdict.rule})`);
  if (verdict.crawlDelay && limiter.setCrawlDelay) limiter.setCrawlDelay(verdict.crawlDelay);

  const maxPages = Math.min(config.maxPages ?? MAX_PAGES, MAX_PAGES);
  const listings = [];
  // One inline retry per run, not per page: a shop that rate-limits twice is
  // telling you something a third request will not change.
  let retried = false;
  const currencies = new Set();
  let page = 1;
  let complete = false;

  for (; page <= maxPages; page++) {
    await limiter.wait();

    let res;
    try {
      res = await fetchImpl(`${base}${PATH}?per_page=${PAGE_SIZE}&page=${page}`, {
        headers: { 'user-agent': userAgent, accept: 'application/json' },
      });
    } catch (err) {
      return failed(`page ${page} request failed: ${err?.message ?? err}`);
    }

    if (res.status === 429) {
      // Keep what already arrived — see the same block in shopify.mjs. A failed
      // poll writes nothing, so discarding the pages that succeeded left a shop
      // whose catalogue runs past its rate limit permanently unable to ingest
      // anything, while re-fetching those same pages every fifteen minutes.
      // `complete: false` is what makes partial data safe, and it is set here.
      const wait = retryAfterSeconds(res.headers?.get?.('retry-after'));

      if (!retried && wait != null && wait <= MAX_INLINE_RETRY_SECONDS) {
        retried = true;
        await sleep(wait * 1000);
        page--;
        continue;
      }

      // Nothing collected is still a failure. Reporting ok with an empty list
      // is indistinguishable from a shop that has emptied out, and would be
      // read as one — the same flaw the eBay adapters had. Something collected
      // is real data with a partial view, which `complete: false` makes safe.
      const detail =
        `rate limited on page ${page}` + (wait ? `; the shop asked for ${wait}s` : '');

      if (!listings.length) {
        return failed(detail, undefined, {
          rateLimited: true,
          retryAfterSeconds: wait ?? undefined,
        });
      }

      return succeeded(listings, {
        complete: false,
        pages: page - 1,
        rateLimited: true,
        retryAfterSeconds: wait ?? undefined,
        note: `${detail}; keeping ${listings.length} from ${page - 1} page(s)`,
      });
    }
    // A shop with the Store API switched off answers 404 here. That is not a
    // fault to retry around — it is a manual-tier shop.
    if (res.status === 404) return failed('no WooCommerce Store API at this domain');
    if (!res.ok) return failed(`page ${page} returned HTTP ${res.status}`);

    let body;
    try {
      body = JSON.parse(await res.text());
    } catch {
      return failed(`page ${page} was not JSON — the Store API is not available`);
    }
    if (!Array.isArray(body)) return failed(`page ${page} was not a product array`);

    for (const product of body) {
      const listing = toListing(product, base);
      if (!listing) continue;
      if (listing.currency) currencies.add(listing.currency);
      listings.push(listing);
    }

    // The API reports the page count in a header; a short page says the same
    // thing without one. Either is enough to know enumeration finished.
    const totalPages = Number(res.headers?.get?.('x-wp-totalpages'));
    if (body.length < PAGE_SIZE || (Number.isFinite(totalPages) && totalPages > 0 && page >= totalPages)) {
      complete = true;
      break;
    }
  }

  // A shop quoting two currencies at once is a shop this cannot price. Better
  // to say so than to pick one and be wrong about half the catalogue.
  if (currencies.size > 1) {
    return failed(`feed mixes currencies (${[...currencies].sort().join(', ')}) — refusing to guess`);
  }
  const reported = [...currencies][0] ?? null;
  if (config.currency && reported && config.currency !== reported) {
    return failed(
      `configured currency ${config.currency} but the shop quotes ${reported} — refusing to guess which is right`,
    );
  }
  if (!reported && !config.currency) {
    return failed(`${domain} states no currency and none is configured — refusing to guess`);
  }

  // The currency is not returned as metadata: the poll runner reads it off the
  // listings themselves, which is stricter — a feed that stated one currency in
  // a summary and another per item could not slip through.
  if (!complete) {
    return succeeded(listings, {
      complete: false,
      pages: page - 1,
      note: `stopped at the ${maxPages}-page cap; catalogue may be larger`,
    });
  }
  return succeeded(listings, { complete: true, pages: page });
}

/**
 * One Store API product becomes one listing.
 *
 * Variations are not expanded. Reaching them costs one request per product,
 * and archive dealers are overwhelmingly one-of-one — so the size comes from
 * the product's own attributes where it states one, and a shop that genuinely
 * sells one piece in five sizes is not the kind of shop this platform is for.
 */
function toListing(product, base) {
  if (!product || product.id == null) return null;

  const prices = product.prices ?? {};
  // Minor units, as strings: "12000" with currency_minor_unit 2 is 120.00.
  // Dividing by the stated exponent rather than assuming cents, because JPY
  // and KRW quote zero decimals and would come out a hundred times too large.
  const minorUnit = Number.isFinite(Number(prices.currency_minor_unit))
    ? Number(prices.currency_minor_unit)
    : 2;
  const raw = prices.sale_price ?? prices.price ?? null;
  const amount = raw == null || raw === '' ? NaN : Number(raw) / 10 ** minorUnit;
  if (!Number.isFinite(amount)) return null;

  const currency =
    typeof prices.currency_code === 'string' && /^[A-Z]{3}$/.test(prices.currency_code)
      ? prices.currency_code
      : null;

  return {
    sourceItemId: String(product.id),
    // The Store API returns the name HTML-escaped, since it is meant to be
    // dropped into a template. Left escaped it reaches brand resolution as
    // "Yohji Yamamoto&#8217;s" and matches nothing.
    title: decodeEntities(product.name ?? ''),
    brandRaw: brandFrom(product),
    price: amount,
    currency,
    sizeRaw: sizeFrom(product),
    // WooCommerce has no condition vocabulary, so nothing is assumed: a
    // guessed tier would put the piece in a comp pool it does not belong in.
    conditionRaw: null,
    url: product.permalink ?? (product.slug ? `${base}/product/${product.slug}` : null),
    imageUrl: product.images?.[0]?.src ?? null,
    sellerId: null,
    // Sold, reserved and withdrawn are indistinguishable here, as everywhere.
    available: product.is_in_stock !== false,
    extra: {
      sku: product.sku ?? null,
      onSale: product.on_sale ?? false,
      regularPrice: prices.regular_price ?? null,
      categories: (product.categories ?? []).map((c) => c?.name).filter(Boolean),
      permalink: product.permalink ?? null,
    },
  };
}

/**
 * The brand, where the shop files it as one.
 *
 * Woo has no vendor field, so shops use a "Brand" or "Designer" attribute, or
 * a category. Only those are read: inventing a brand from the title is the
 * resolver's job, and it is better at it than a guess here would be.
 */
function brandFrom(product) {
  const attribute = (product.attributes ?? []).find((a) =>
    /^(brand|designer|maker|label)$/i.test(String(a?.name ?? '')),
  );
  const term = attribute?.terms?.[0]?.name;
  if (term) return decodeEntities(String(term));

  const category = (product.categories ?? []).find((c) => /designer|brand/i.test(String(c?.name ?? '')));
  return category?.name ? decodeEntities(String(category.name)) : null;
}

function sizeFrom(product) {
  const attribute = (product.attributes ?? []).find((a) =>
    /^(size|taille|größe|サイズ)$/i.test(String(a?.name ?? '')),
  );
  const terms = (attribute?.terms ?? []).map((t) => t?.name).filter(Boolean);
  return terms.length ? decodeEntities(String(terms[0])) : null;
}

/** WordPress escapes its strings for templates; undo that. */
function decodeEntities(text) {
  return String(text)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeChar(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeChar(Number(dec)))
    .replace(/&amp;/g, '&')
    .trim();
}

const safeChar = (code) =>
  Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
