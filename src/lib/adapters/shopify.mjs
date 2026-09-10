// Generic Shopify adapter.
//
// Every Shopify storefront exposes /products.json — public, unauthenticated,
// paginated, up to 250 per page. Adding a shop is a config line, not new code.
//
// What this deliberately does NOT do:
//   * It never guesses currency. /products.json does not carry one, and
//     inferring it from a domain TLD would silently corrupt every price on the
//     route. Currency is required per-shop config; a shop without one is
//     skipped with an explicit error.
//   * It never concludes anything is sold or gone. It reports what the feed
//     contained and whether it saw all of it.
//   * It never falls back to HTML if the feed is off. A shop without a feed
//     belongs in the manual tier.

import { succeeded, failed, retryAfterSeconds } from './contract.mjs';
import { parseRobots, isAllowed } from '../robots.mjs';

const PAGE_SIZE = 250;
const MAX_PAGES = 40; // 10k products; a hard stop so a pagination bug cannot loop.

// How long this will sit and wait inside a single run when a shop names a
// delay. Long enough to ride out the short bursts that are most of what a
// `Retry-After` says, short enough that a poll cannot become a job that holds a
// connection for an hour. Anything longer becomes a cooldown instead, which is
// the right shape for it: waiting is what the next run is for.
const MAX_INLINE_RETRY_SECONDS = 30;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const id = 'shopify';

/**
 * @param {object} config  { domain, currency, userAgent, maxPages?, brandFilter? }
 * @param {object} deps    { fetchImpl, limiter, log }
 */
export async function fetchListings(config, deps = {}) {
  const { domain, currency, userAgent } = config;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const limiter = deps.limiter ?? { wait: async () => {} };

  if (!domain) return failed('no domain configured');
  if (!currency || !/^[A-Z]{3}$/.test(currency)) {
    // Refusing is correct: a wrong currency is worse than no data, because it
    // produces a plausible-looking price that is off by a factor of ~150.
    return failed(`shop ${domain} has no currency configured — refusing to guess`);
  }

  const base = config.base ?? `https://${domain}`;

  // robots.txt first, every run. A shop can add a Disallow at any time and we
  // must notice, not rely on a probe from weeks ago.
  await limiter.wait();
  let groups;
  try {
    const res = await fetchImpl(`${base}/robots.txt`, {
      headers: { 'user-agent': userAgent, accept: 'text/plain' },
    });
    if (res.status === 200) {
      groups = parseRobots(await res.text());
    } else if (res.status === 404) {
      groups = [];
    } else if (res.status === 429) {
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

  const verdict = isAllowed(groups, userAgent, '/products.json');
  if (!verdict.allowed) {
    return failed(`robots.txt disallows /products.json (${verdict.rule})`);
  }
  if (verdict.crawlDelay && limiter.setCrawlDelay) limiter.setCrawlDelay(verdict.crawlDelay);

  const maxPages = Math.min(config.maxPages ?? MAX_PAGES, MAX_PAGES);
  const listings = [];
  // One inline retry per run, not per page: a shop that rate-limits twice is
  // telling you something a third request will not change.
  let retried = false;
  let page = 1;
  let complete = false;

  for (; page <= maxPages; page++) {
    await limiter.wait();

    let res;
    try {
      res = await fetchImpl(`${base}/products.json?limit=${PAGE_SIZE}&page=${page}`, {
        headers: { 'user-agent': userAgent, accept: 'application/json' },
      });
    } catch (err) {
      return failed(`page ${page} request failed: ${err?.message ?? err}`);
    }

    if (res.status === 429) {
      // KEEP WHAT WAS ALREADY COLLECTED.
      //
      // This used to return failed(), which discards the listings from every
      // page that succeeded — and a failed poll writes nothing at all. So a
      // shop whose catalogue runs past the point where it first rate-limits
      // could never ingest anything: the next run started at page 1, re-fetched
      // the same pages, and hit the same wall. Every fifteen minutes. That is
      // not merely a source stuck at zero, it is the platform hammering a shop
      // hard enough to make it start rate-limiting robots.txt too, which is
      // exactly the failure this comment was written under.
      //
      // Partial data is safe here and always was, because `complete: false` is
      // what the ingest actually keys on: an incomplete enumeration may add and
      // re-price, and may never conclude that anything is gone. The pages that
      // arrived are real observations. Throwing them away protected nothing.
      const wait = retryAfterSeconds(res.headers?.get?.('retry-after'));

      // One retry, and only when the shop named a delay short enough to sit
      // through. Waiting on a number nobody gave would be guessing at the one
      // thing the source is entitled to decide.
      if (!retried && wait != null && wait <= MAX_INLINE_RETRY_SECONDS) {
        retried = true;
        await sleep(wait * 1000);
        page--;                       // the same page, once more
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
    if (!res.ok) return failed(`page ${page} returned HTTP ${res.status}`);

    let body;
    try {
      body = JSON.parse(await res.text());
    } catch {
      // HTML here means the merchant turned the feed off. That is a manual-tier
      // shop now, not an error to retry around.
      return failed(`page ${page} was not JSON — the feed is not available`);
    }

    const products = body?.products;
    if (!Array.isArray(products)) return failed(`page ${page} had no products array`);

    for (const product of products) listings.push(...toListings(product, base));

    if (products.length < PAGE_SIZE) {
      // A short page is the end of the catalogue: enumeration is complete.
      complete = true;
      break;
    }
  }

  if (!complete) {
    // Hit the page cap without reaching the end. Real data, but a partial view,
    // so it must not be used to conclude anything is gone.
    return succeeded(listings, {
      complete: false,
      pages: page - 1,
      note: `stopped at the ${maxPages}-page cap; catalogue may be larger`,
    });
  }

  return succeeded(listings, { complete: true, pages: page });
}

/**
 * One Shopify product becomes one listing per variant.
 *
 * Archive shops are mostly one-of-one, but where a product does carry sizes
 * they are separate purchasable things at separate prices, and collapsing them
 * would break the size field the whole profit calculation depends on.
 */
function toListings(product, base) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const imageUrl = product?.images?.[0]?.src ?? null;
  const url = product?.handle ? `${base}/products/${product.handle}` : null;

  return variants
    .map((variant) => {
      const price = Number(variant?.price);
      if (!Number.isFinite(price)) return null;
      return {
        sourceItemId: `${product.id}:${variant.id}`,
        title: product.title ?? '',
        brandRaw: product.vendor ?? null,
        price,
        // Currency is filled in by the caller from shop config; the feed has none.
        currency: null,
        // "Default Title" is Shopify's placeholder for a product with no real
        // variants — it is not a size, so it must not be stored as one.
        sizeRaw:
          variant?.title && variant.title !== 'Default Title' ? String(variant.title) : null,
        // Shopify has no condition vocabulary at all. Left null rather than
        // assumed, so it never joins a comp pool it does not belong in.
        conditionRaw: null,
        url,
        imageUrl,
        sellerId: product.vendor ?? null,
        // `available: false` is ambiguous on Shopify: sold, withdrawn or simply
        // out of stock are indistinguishable. The ingest layer maps this to
        // "unknown", never to "sold".
        available: variant?.available !== false,
        extra: {
          productId: product.id,
          variantId: variant.id,
          productType: product.product_type ?? null,
          tags: product.tags ?? [],
          publishedAt: product.published_at ?? null,
          updatedAt: product.updated_at ?? null,
        },
      };
    })
    .filter(Boolean);
}
