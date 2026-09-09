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

import { succeeded, failed } from './contract.mjs';
import { parseRobots, isAllowed } from '../robots.mjs';

const PAGE_SIZE = 250;
const MAX_PAGES = 40; // 10k products; a hard stop so a pagination bug cannot loop.

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
      // Back off and report incomplete. Partial data must never be treated as
      // a full catalogue view.
      const retryAfter = res.headers?.get?.('retry-after');
      return failed(`rate limited on page ${page}`, retryAfter ? `Retry-After: ${retryAfter}` : undefined);
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
