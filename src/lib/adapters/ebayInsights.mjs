// eBay Marketplace Insights — item_sales/search.
//
// The only sanctioned source of SOLD prices this platform can reach, and the
// thing it has been missing since the beginning.
//
// Everything else here reports asking prices. An asking price is what one
// seller hopes for, so a margin computed from two of them is arithmetic on two
// hopes — which is why /opportunities holds ask-only rows behind a toggle and
// why `npm run status` says, on every fresh install, that every comp is an ask.
// The three evidence tiers exist precisely because that distinction decides
// whether a number is worth acting on, and until now the strongest tier was
// unreachable from any automated path: a poll that stops seeing a listing
// cannot know it sold, and this codebase refuses to pretend otherwise.
//
// A Marketplace Insights record is different in kind. It is eBay stating that
// an item sold, on a date, at a price. That is the source explicitly saying it
// sold, which is exactly what `sold_confirmed` means and the one thing that
// makes `confirmed_sale` representable. So this adapter — alone among them —
// reports observations of sales rather than of listings.
//
// TWO PROPERTIES THAT MAKE THAT SAFE.
//
//   It NEVER reports complete. A sold-item search is a ranked sample over a
//   ninety-day window, not an enumeration of a catalogue, so its silences mean
//   nothing at all. pollRunner's statusChangeVeto already refuses to conclude
//   an absence from an incomplete read, so a sale ageing out of the window can
//   never be mistaken for a listing that vanished. That falls out of the
//   architecture rather than needing a special case, which is the point of
//   having the architecture.
//
//   It reports the sale DATE, not the day we happened to ask. A sale is a fact
//   with a timestamp, and dating it to the poll would let a three-year-old sale
//   count as fresh evidence — which is the failure mode the recency weighting
//   exists to prevent.
//
// ACCESS. Marketplace Insights is a limited release: the scope has to be
// granted to your keyset by eBay, separately from the Buy APIs and separately
// from any growth check. Most keysets do not have it, and a 403 here says so
// plainly rather than being retried. Nothing in this code can grant it, and no
// configuration routes around it.

import { succeeded, failed } from './contract.mjs';
import { fetchToken, hostFor } from './ebay.mjs';

export const id = 'ebay_insights';

export const MIN_INTERVAL_MS = 250;
const PAGE_SIZE = 200;   // API maximum

/** The window the API serves. Asking for more returns an error, not more data. */
export const MAX_WINDOW_DAYS = 90;

// Its own scope, granted separately from the Buy APIs. Sending a Browse token
// here fails with an authorisation error that reads like a bad secret.
export const SCOPE_PATH = '/oauth/api_scope/buy.marketplace.insights';

const searchUrl = (clientId) =>
  process.env.EBAY_INSIGHTS_URL ??
  `${hostFor(clientId)}/buy/marketplace_insights/v1_beta/item_sales/search`;

export const scopeFor = (clientId) => `${hostFor(clientId)}${SCOPE_PATH}`;

/**
 * The `lastSoldDate` filter, as the API spells it.
 *
 * Bounded on both ends. An open-ended range is accepted and returns whatever
 * the index holds, which on a first run is a wall of sales of unknown age —
 * and age is most of what decides whether a comp means anything now.
 */
export function soldSinceFilter(days = MAX_WINDOW_DAYS, now = new Date()) {
  const window = Math.min(MAX_WINDOW_DAYS, Math.max(1, Number(days) || MAX_WINDOW_DAYS));
  const from = new Date(now.getTime() - window * 86_400_000);
  return `lastSoldDate:[${from.toISOString()}..${now.toISOString()}]`;
}

export async function fetchListings(config, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const limiter = deps.limiter ?? { wait: async () => {} };
  const now = deps.now ?? new Date();

  // One source, several searches — the same reasoning as the Browse adapter.
  // eBay ranks and truncates, so a single broad query returns what it favours
  // rather than the roster; and making each house its own source would multiply
  // routes by the number of houses and score every listing against all of them.
  const queries = config.queries ?? (config.query ? [config.query] : []);
  if (!queries.length) return failed('an eBay Marketplace Insights source needs a search query');
  if (limiter.setMinInterval) limiter.setMinInterval(MIN_INTERVAL_MS);

  const clientId = config.clientId ?? process.env.EBAY_CLIENT_ID;

  let token = config.token;
  if (!token) {
    const auth = await fetchToken({
      clientId,
      clientSecret: config.clientSecret ?? process.env.EBAY_CLIENT_SECRET,
      // Not the Browse scope. Requesting the wrong one succeeds — eBay issues a
      // token — and then every search returns 403, which reads as an access
      // problem with the API rather than with the token that was asked for.
      scope: scopeFor(clientId),
      fetchImpl,
    });
    if (!auth.ok) {
      return failed(
        `${auth.error}. Marketplace Insights needs its own scope (${SCOPE_PATH}), ` +
        'granted per keyset by eBay — a Browse keyset will not carry it.',
      );
    }
    token = auth.token;
  }

  const marketplace = config.marketplaceId ?? 'EBAY_GB';
  const soldFilter = config.filter ?? soldSinceFilter(config.windowDays, now);
  const listings = [];
  const failures = [];
  let rateLimited = false;
  let totalPages = 0;

  for (const query of queries) {
    if (rateLimited) break;
    let offset = 0;
    let total = null;
    let pages = 0;
    const maxPages = config.maxPages ?? 5;

    while (pages < maxPages) {
      await limiter.wait();

      const url = new URL(searchUrl(clientId));
      url.searchParams.set('q', query);
      url.searchParams.set('limit', String(PAGE_SIZE));
      url.searchParams.set('offset', String(offset));
      url.searchParams.set('filter', soldFilter);
      if (config.categoryIds) url.searchParams.set('category_ids', String(config.categoryIds));

      let res;
      try {
        res = await fetchImpl(url.toString(), {
          headers: {
            authorization: `Bearer ${token}`,
            accept: 'application/json',
            'X-EBAY-C-MARKETPLACE-ID': marketplace,
          },
        });
      } catch (err) {
        failures.push(`${query}: ${err?.message ?? err}`);
        break;
      }

      if (res.status === 429) {
        // Stop asking. Spending the remaining searches collecting 429s is the
        // behaviour a rate limit exists to prevent, and the Insights quota is
        // smaller than the Browse one.
        failures.push(`${query}: rate limited`);
        rateLimited = true;
        break;
      }
      if (res.status === 401) {
        return failed('eBay returned 401 — the Marketplace Insights token is invalid or expired');
      }
      if (res.status === 403) {
        // The limited-release gate, and not something to retry around. Named
        // exactly, because the identical status code on the Browse API means a
        // different thing and sends you to a different page of eBay's console.
        return failed(
          'eBay returned 403 — this keyset does not hold the Marketplace Insights scope. ' +
          'It is a limited release, granted per application on request, and is separate ' +
          'from Buy API access and from the Application Growth Check.',
        );
      }
      if (!res.ok) { failures.push(`${query}: HTTP ${res.status}`); break; }

      let body;
      try {
        body = JSON.parse(await res.text());
      } catch {
        failures.push(`${query}: response was not JSON`);
        break;
      }

      const sales = body?.itemSales;
      if (!Array.isArray(sales)) {
        // A search with no sales in the window is a legitimate empty answer —
        // for thin archive pieces it is the common one — and not a fault in the
        // source. The other searches still stand.
        if (Number(body?.total) === 0) { totalPages += pages + 1; break; }
        failures.push(`${query}: response had no itemSales`);
        break;
      }

      for (const sale of sales) {
        const listing = toSale(sale);
        if (listing) listings.push(listing);
      }
      pages++;
      if (total == null) total = Number(body.total ?? sales.length);

      offset += sales.length;
      if (sales.length < PAGE_SIZE || offset >= total) break;
    }

    totalPages += pages;
  }

  // Nothing collected, and something went wrong: a failure, not an empty
  // success.
  //
  // The test used to be "every search failed", which a rate limit slips
  // through — it BREAKS the loop, so the searches it prevented are never
  // attempted and never counted as failures. One 429 on the first of three
  // queries therefore reported ok with an empty result set, which is
  // indistinguishable from a genuine "nothing matched" and would have been read
  // as one. Reporting the failure is what makes the poll change nothing.
  if (!listings.length && failures.length) {
    return failed(
      failures.length === queries.length
        ? `all ${queries.length} searches failed — first: ${failures[0]}`
        : `no sales collected — ${failures[0]}${rateLimited ? ' (stopped on a rate limit)' : ''}`,
    );
  }

  return succeeded(listings, {
    // NEVER complete, on any run, however well it went.
    //
    // This is a ranked sample of sales over a window, not an enumeration of a
    // catalogue. Claiming completeness would let pollRunner conclude that a
    // sale which merely aged past ninety days had disappeared — turning the
    // strongest evidence tier the platform has into a phantom delisting.
    complete: false,
    pages: totalPages,
    note:
      `${listings.length} completed sales across ${queries.length - failures.length} of ` +
      `${queries.length} searches` +
      (failures.length ? `; ${failures.length} failed (${failures[0]})` : '') +
      (rateLimited ? '; stopped on a rate limit' : ''),
  });
}

/**
 * One completed sale.
 *
 * `soldAt` is the sale's own date. Dating it to the poll instead would let a
 * three-month-old sale count as evidence gathered today, which is exactly what
 * the recency weighting exists to prevent — and the error would be invisible,
 * since a wrongly-dated comp produces a number rather than a complaint.
 */
export function toSale(sale) {
  const value = Number(sale?.lastSoldPrice?.value);
  const currency = sale?.lastSoldPrice?.currency;
  if (!sale?.itemId || !Number.isFinite(value) || !currency) return null;

  const soldAt = sale.lastSoldDate ? new Date(sale.lastSoldDate) : null;

  return {
    sourceItemId: String(sale.itemId),
    title: sale.title ?? '',
    brandRaw: sale.brand ?? null,
    price: value,
    currency,
    sizeRaw: null,
    conditionRaw: sale.condition ?? null,
    url: sale.itemWebUrl ?? null,
    imageUrl: sale.image?.imageUrl ?? sale.thumbnailImages?.[0]?.imageUrl ?? null,
    sellerId: sale.seller?.username ?? null,
    available: false,
    // What separates this adapter from every other one. The pipeline decides
    // status from observations and refuses to infer a sale — this is not an
    // inference, it is the source stating the outcome, which is the single case
    // the schema allows `sold_confirmed` to represent.
    evidence: 'confirmed_sale',
    soldAt: soldAt && Number.isFinite(soldAt.getTime()) ? soldAt : null,
    extra: {
      marketplace: sale.listingMarketplaceId ?? null,
      itemLocation: sale.itemLocation?.country ?? null,
      soldDataAvailable: true,
    },
  };
}
