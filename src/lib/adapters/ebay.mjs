// eBay Browse API — item_summary/search.
//
// Active listings only. This endpoint returns asks — what sellers hope for —
// and every listing it produces says `soldDataAvailable: false` so nothing
// downstream can mistake one for a sale.
//
// Sold prices come from a different endpoint with a different scope:
// `ebayInsights.mjs` reads Marketplace Insights, which returns completed sales.
// The two are one venue observed two ways, which is what `sources.venue_id`
// exists to say — an item's eBay comps must never scope to one of them and drop
// the other. The sold-listings *page* remains off limits under the project's
// constraints; the API is the sanctioned route to the same fact.
//
// Access caveat from phase 0: production access to the Buy APIs appears to
// require eBay's manual Application Growth Check. That is a gate on your
// credentials, not something this code can route around — a 403 here says so
// plainly rather than retrying.

import { succeeded, failed } from './contract.mjs';

export const id = 'ebay';

// eBay runs two entirely separate worlds on two hostnames, and a keyset is
// bound to one of them: a Sandbox keyset authenticates ONLY against
// api.sandbox.ebay.com, a Production keyset ONLY against api.ebay.com. Sent to
// the wrong host either one fails with `invalid_client`, which reads as a typo
// and sends you back to re-copy a secret that was never wrong.
//
// So the host is derived from the keyset rather than configured beside it. The
// two are then incapable of disagreeing.
export const PRODUCTION = 'https://api.ebay.com';
export const SANDBOX = 'https://api.sandbox.ebay.com';

/** Which eBay a keyset belongs to. eBay stamps it into the App ID itself. */
export function isSandboxKey(clientId) {
  return /-SBX-/i.test(String(clientId ?? ''));
}

/** The host that will accept this keyset. */
export function hostFor(clientId) {
  return isSandboxKey(clientId) ? SANDBOX : PRODUCTION;
}

// The overrides stay, for pointing a test at a local server. When they are
// unset the host comes from the key.
const searchUrl = (clientId) =>
  process.env.EBAY_SEARCH_URL ?? `${hostFor(clientId)}/buy/browse/v1/item_summary/search`;
const tokenUrl = (clientId) =>
  process.env.EBAY_TOKEN_URL ?? `${hostFor(clientId)}/identity/v1/oauth2/token`;

// The OAuth scope is per-world too.
const scopeFor = (clientId) => `${hostFor(clientId)}/oauth/api_scope`;
const PAGE_SIZE = 200;  // API maximum
export const MIN_INTERVAL_MS = 250;

/**
 * Client-credentials token. Cached by the caller between runs if it wants to;
 * this fetches one per invocation, which is well inside eBay's limits for a
 * personal poll.
 */
export async function fetchToken({ clientId, clientSecret, scope, fetchImpl = fetch }) {
  if (!clientId || !clientSecret) return { ok: false, error: 'no eBay client credentials configured' };

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  let res;
  try {
    res = await fetchImpl(tokenUrl(clientId), {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: scope ?? scopeFor(clientId),
      }).toString(),
    });
  } catch (err) {
    return { ok: false, error: `token request failed: ${err?.message ?? err}` };
  }

  if (!res.ok) return { ok: false, error: `token endpoint returned HTTP ${res.status}` };
  try {
    const body = JSON.parse(await res.text());
    if (!body?.access_token) return { ok: false, error: 'token response carried no access_token' };
    return { ok: true, token: body.access_token, expiresIn: body.expires_in };
  } catch {
    return { ok: false, error: 'token response was not JSON' };
  }
}

export async function fetchListings(config, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const limiter = deps.limiter ?? { wait: async () => {} };

  // One source may carry several searches.
  //
  // eBay ranks and truncates, so a single broad query returns whatever it
  // favours rather than the roster. Per-house searches fix that — but making
  // each its own SOURCE would multiply routes by the number of houses and
  // score every listing against all of them. So the searches live inside one
  // source, and the exit venue stays one venue, which is what it is.
  const queries = config.queries ?? (config.query ? [config.query] : []);
  if (!queries.length) return failed('an eBay source needs a search query');
  if (limiter.setMinInterval) limiter.setMinInterval(MIN_INTERVAL_MS);

  const clientId = config.clientId ?? process.env.EBAY_CLIENT_ID;

  let token = config.token;
  if (!token) {
    const auth = await fetchToken({
      clientId,
      clientSecret: config.clientSecret ?? process.env.EBAY_CLIENT_SECRET,
      fetchImpl,
    });
    if (!auth.ok) return failed(auth.error);
    token = auth.token;
  }

  const marketplace = config.marketplaceId ?? 'EBAY_GB';
  const listings = [];
  let allComplete = true;
  let totalPages = 0;

  // One search failing must not discard the others.
  //
  // A source carries a search per house, so a transient error on the fortieth
  // throws away thirty-nine searches' worth of real data — and the next run
  // starts from nothing again. A failed search is skipped and the poll is
  // marked INCOMPLETE instead, which is the property that actually matters:
  // an incomplete enumeration may never be used to conclude a listing is gone.
  //
  // Two exceptions, because they mean nothing further will work: a bad token,
  // and a rate limit. On a rate limit this stops asking altogether rather than
  // spending the remaining searches collecting 429s.
  const failures = [];
  let rateLimited = false;

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
    if (config.filter) url.searchParams.set('filter', config.filter);
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
      // Stop asking. Continuing would spend every remaining search on 429s and
      // is exactly the behaviour a rate limit exists to prevent.
      failures.push(`${query}: rate limited`);
      rateLimited = true;
      break;
    }
    // A bad token will fail every remaining search identically, so this is
    // still a whole-source failure.
    if (res.status === 401) return failed('eBay returned 401 — the token is invalid or expired');
    if (res.status === 403) {
      // The Application Growth Check gate. Not a transient error, and not
      // something to retry around.
      return failed(
        'eBay returned 403 — the Buy APIs likely need an Application Growth Check on this keyset',
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

    const summaries = body?.itemSummaries;
    // eBay omits itemSummaries entirely on a zero-result search, which is a
    // legitimate empty answer rather than a malformed one.
    if (!Array.isArray(summaries)) {
      // A zero-result search for one house is a legitimate empty answer, not
      // a failure of the source: the other searches still stand.
      if (Number(body?.total) === 0) { totalPages += pages + 1; break; }
      failures.push(`${query}: response had no itemSummaries`);
      break;
    }

    for (const summary of summaries) {
      const listing = toListing(summary);
      if (listing) listings.push(listing);
    }
    pages++;
    if (total == null) total = Number(body.total ?? summaries.length);

    offset += summaries.length;
    if (summaries.length < PAGE_SIZE || offset >= total) break;
  }

  totalPages += pages;
  // Hitting the page cap means this search was truncated, and a truncated
  // enumeration may never be used to conclude anything is gone.
  if (pages >= (config.maxPages ?? 5) && total != null && offset < total) allComplete = false;
  }

  // Every search failed: there is no data and no reason to think the source is
  // healthy, so this is a failure rather than an empty success.
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
        : `no listings collected — ${failures[0]}${rateLimited ? ' (stopped on a rate limit)' : ''}`,
      undefined,
      { rateLimited: rateLimited || undefined },
    );
  }

  // Some failed. Real data, partial view — and the poll must be marked
  // incomplete so nothing is concluded to have disappeared from what is
  // missing here rather than gone from eBay.
  if (failures.length) allComplete = false;

  return succeeded(listings, {
    complete: allComplete,
    // A limit reached mid-run is why this stopped, and the runner turns it into
    // a cooldown rather than asking again on the next tick.
    rateLimited: rateLimited || undefined,
    pages: totalPages,
    note:
      `${listings.length} across ${queries.length - failures.length} of ${queries.length} searches` +
      (failures.length ? `; ${failures.length} failed (${failures[0]})` : '') +
      (rateLimited ? '; stopped on a rate limit' : ''),
  });
}

// eBay's condition vocabulary, mapped where it is unambiguous. Anything else is
// left raw for the shared condition mapping rather than guessed at here.
function toListing(summary) {
  const value = Number(summary?.price?.value);
  const currency = summary?.price?.currency;
  if (!summary?.itemId || !Number.isFinite(value) || !currency) return null;

  return {
    sourceItemId: String(summary.itemId),
    title: summary.title ?? '',
    brandRaw: summary.brand ?? null,
    price: value,
    // eBay states the currency per item, so it is never inferred.
    currency,
    sizeRaw: null,
    conditionRaw: summary.condition ?? null,
    url: summary.itemWebUrl ?? null,
    imageUrl: summary.image?.imageUrl ?? summary.thumbnailImages?.[0]?.imageUrl ?? null,
    sellerId: summary.seller?.username ?? null,
    // Browse returns active listings only, so anything present is available.
    available: true,
    extra: {
      marketplace: summary.listingMarketplaceId ?? null,
      buyingOptions: summary.buyingOptions ?? [],
      itemLocation: summary.itemLocation?.country ?? null,
      // Stated so nothing downstream mistakes an eBay comp for a sale.
      soldDataAvailable: false,
    },
  };
}
