// The shop that has no API at all.
//
// Shopify, WooCommerce, Rakuten, Yahoo and eBay each have a documented feed or
// a key, and each needed an adapter written for it. The long tail does not: a
// one-person archive dealer on a hand-built site, a Squarespace shop, a
// Japanese store on a platform nobody outside Japan has heard of. There are
// far more of those than of the five, and applying for a key is not the
// obstacle — there is no key to apply for.
//
// What this does instead of a per-shop adapter or a selector recipe: it reads
// the page the same way COPYING it reads it.
//
// That is not a shortcut, it is the observation the whole paste importer is
// built on. A results page is a flat run of lines with one price per listing,
// and pastedPage.mjs already parses that shape across The RealReal, Grailed,
// Vestiaire and everything pasted into it so far — including the filter rails
// and page furniture, which is most of what a bespoke selector would have to
// be told about. walkParsedHtml already turns markup into exactly those lines,
// with each one's link and image attached. So the parser that survives a
// pasted page survives a fetched one, and a new shop needs no code and no
// configuration beyond its URL.
//
// The trade, stated plainly: this is less precise than an adapter written
// against a documented feed. It cannot page, so it sees one page of results,
// and it therefore reports `complete: false` ALWAYS — nothing it returns may
// ever be used to conclude that a piece is gone. Where a real feed exists, use
// the real feed.
//
// What it does not do, and will not be extended to do: it sends one plain
// request with an honest user agent and obeys what robots.txt says about the
// path. It does not rotate addresses, spoof a browser fingerprint, solve a
// challenge or route around bot protection. A page that answers a plain
// request is a page that permits one; a page that does not is a page to paste.

import { succeeded, failed } from './contract.mjs';
import { parseRobots, isAllowed } from '../robots.mjs';
import { parseHtml } from '../html.mjs';
import { walkParsedHtml } from '../pastedHtml.mjs';
import { parsePastedPage, parseMoney } from '../pastedPage.mjs';

export const id = 'page';

// A results page is big; a page this size is not one.
const MAX_BYTES = 4_000_000;

// Below this, the parse found so little that "the layout changed" and "the
// shop is empty" are indistinguishable, and reporting an empty catalogue is
// the more dangerous of the two readings.
const MIN_LISTINGS = 2;

/**
 * @param {object} config  { url, currency?, userAgent, sourceId? }
 * @param {object} deps    { fetchImpl, limiter }
 */
export async function fetchListings(config, deps = {}) {
  const { url, userAgent } = config;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const limiter = deps.limiter ?? { wait: async () => {} };

  if (!url) return failed('no url configured');

  let target;
  try {
    target = new URL(url);
  } catch {
    return failed(`not a URL: ${url}`);
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    return failed(`refusing to fetch ${target.protocol}`);
  }

  // robots.txt first, every run, and fail closed. A shop can add a Disallow at
  // any time and the answer has to be re-read rather than remembered.
  await limiter.wait();
  let groups;
  try {
    const res = await fetchImpl(`${target.origin}/robots.txt`, {
      headers: { 'user-agent': userAgent, accept: 'text/plain' },
    });
    if (res.status === 200) groups = parseRobots(await res.text());
    else if (res.status === 404) groups = [];
    else return failed(`robots.txt returned ${res.status} — treated as do-not-fetch`);
  } catch (err) {
    return failed(`robots.txt unreachable: ${err?.message ?? err}`);
  }

  const path = target.pathname + target.search;
  const verdict = isAllowed(groups, userAgent, path);
  if (!verdict.allowed) return failed(`robots.txt disallows ${path} (${verdict.rule})`);
  if (verdict.crawlDelay && limiter.setCrawlDelay) limiter.setCrawlDelay(verdict.crawlDelay);

  await limiter.wait();
  let res;
  try {
    res = await fetchImpl(target.href, {
      headers: { 'user-agent': userAgent, accept: 'text/html' },
      redirect: 'follow',
    });
  } catch (err) {
    return failed(`request failed: ${err?.message ?? err}`);
  }

  if (res.status === 429) {
    const retryAfter = res.headers?.get?.('retry-after');
    return failed('rate limited', retryAfter ? `Retry-After: ${retryAfter}` : undefined);
  }
  // 403 and 401 here mean the shop declined to serve this request. That is an
  // answer, and the answer is no — it is not a signal to try again wearing
  // something else.
  if (res.status === 403 || res.status === 401) {
    return failed(
      `the site refused this request (HTTP ${res.status})`,
      'Nothing here works around that by design. Paste the page instead.',
    );
  }
  if (!res.ok) return failed(`HTTP ${res.status}`);

  const type = res.headers?.get?.('content-type') ?? '';
  if (type && !/text\/html|application\/xhtml/i.test(type)) {
    return failed(`served ${type.split(';')[0]}, not a web page`);
  }

  let html;
  try {
    html = await res.text();
  } catch (err) {
    return failed(`could not read the response: ${err?.message ?? err}`);
  }
  if (html.length > MAX_BYTES) return failed(`page is ${html.length} bytes — refusing to parse`);

  // Same two steps the clipboard takes, in the same order, with the page's own
  // address as the base so relative links resolve. A browser absolutises on
  // copy; here nothing has, so this is where it happens.
  const { lines, links } = walkParsedHtml(parseHtml(html), { base: target.href });
  if (!lines.length) return failed('the page had no readable text');

  const { blocks } = parsePastedPage(
    lines.map((text, i) => {
      const entry = links.find(([at]) => at === i);
      return { text, url: entry?.[1] ?? null, image: entry?.[2] ?? null };
    }),
  );

  if (blocks.length < MIN_LISTINGS) {
    return failed(
      `read ${blocks.length} listing${blocks.length === 1 ? '' : 's'} from the page`,
      'Either the layout is one this cannot read or the results are rendered by script ' +
        'after load. Both look identical from here, so neither is reported as an empty shop.',
    );
  }

  const listings = [];
  for (const block of blocks) {
    const listing = toListing(block, config);
    if (listing) listings.push(listing);
  }

  return succeeded(listings, {
    // ALWAYS false, and not a placeholder waiting to be improved. This reads
    // one page of results with no way to know how many there are, so nothing
    // it returns may be used to conclude a piece has gone — which is exactly
    // what `complete: true` would license.
    complete: false,
    pages: 1,
    note:
      `${listings.length} read from one page. Never complete: this sees one page of results, ` +
      'so an absence here is not evidence of anything.',
  });
}

/**
 * One parsed block as a raw listing.
 *
 * Currency comes from the price when the page wrote a symbol or a code, and
 * from configuration otherwise. It is never inferred from the domain: a
 * Japanese shop quoting USD is common, and a wrong currency is a wrong price
 * by a factor of a hundred and fifty.
 */
function toListing(block, config) {
  const { amount, currency, ambiguous } = parseMoney(block.price);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const resolved = currency ?? config.currency ?? null;
  if (!resolved) return null;

  // The listing's own URL is its id where it has one, because a page gives no
  // stable identifier of its own and a title changes when the seller edits it.
  const sourceItemId = block.url ?? `title:${block.title}`;

  return {
    sourceItemId,
    title: block.title,
    price: amount,
    currency: resolved,
    sizeRaw: block.size ?? undefined,
    conditionRaw: block.condition ?? undefined,
    url: block.url ?? undefined,
    imageUrl: block.image ?? undefined,
    // No page states whether a piece is still for sale in a way this can read,
    // and guessing is how a shop gets mass-marked. Left unstated.
    available: undefined,
    extra: {
      wasPrice: block.wasPrice ?? undefined,
      discount: block.discount ?? undefined,
      // A price this could not read unambiguously is reported as read, with the
      // doubt attached, rather than dropped or silently rounded.
      priceAmbiguous: ambiguous || undefined,
    },
  };
}
