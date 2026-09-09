// Paste-a-URL prefill.
//
// Derives ONLY what the URL structure itself encodes. Anything a URL cannot
// tell us — price, currency, size, condition — is left blank rather than
// guessed, because a wrong prefill that looks authoritative is worse than an
// empty field you would have filled anyway.
//
// Two jobs, deliberately separated, because they age very differently:
//
//   WHICH VENUE this is. The host, matched against the base_url of the sources
//   you have configured. Hosts effectively never change, and this answer
//   matters: a source decides whether a row is something you might BUY or
//   evidence of what things SELL for. Getting it wrong files a Grailed comp as
//   a purchase candidate, and it can never serve as a comp again.
//
//   WHAT THE PATH ENCODES — the listing id, sometimes a brand or category. This
//   is per-site pattern matching against URL shapes that are not promised to
//   anyone and do change. So it is strictly additive: when a pattern stops
//   matching, the fields it filled go missing and nothing else moves. The venue
//   is still right, the URL still opens, the row still saves.
//
// Reading the venue from the database rather than from a list in this file is
// what stops it going stale: every shop `add-source` or `discover` configures
// is recognised the day it is added, with no code change here.

/** Turn a URL slug into something readable, without inventing capitalisation. */
function slugToText(slug) {
  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A hostname without the `www.` that means nothing. */
function bareHost(hostname) {
  return String(hostname ?? '').toLowerCase().replace(/^www\./, '');
}

/**
 * Which configured source does this host belong to?
 *
 * Exact host, or a subdomain of one — `shop.example.com` belongs to a source
 * registered as `example.com`, but `notexample.com` does not, which a plain
 * "ends with" test would get wrong and file under the wrong venue.
 */
export function sourceForHost(hostname, sources = []) {
  const host = bareHost(hostname);
  if (!host) return null;

  let best = null;
  for (const source of sources ?? []) {
    if (!source?.base_url || !source?.id) continue;
    let sourceHost;
    try {
      sourceHost = bareHost(new URL(source.base_url).hostname);
    } catch {
      continue;                       // a base_url nobody can parse tells us nothing
    }
    if (!sourceHost) continue;
    if (host !== sourceHost && !host.endsWith(`.${sourceHost}`)) continue;
    // The most specific match wins, so a shop on a subdomain of a marketplace
    // is not swallowed by the marketplace.
    if (!best || sourceHost.length > best.host.length) best = { id: source.id, host: sourceHost };
  }
  return best?.id ?? null;
}

/**
 * Query parameters that identify nothing and change per visit.
 *
 * Dropped so one listing has one URL: without this the same piece arriving
 * from an email and from a browser looks like two listings, and a re-visit
 * looks like a re-listing. Everything else is KEPT — plenty of shops put the
 * product id in the query, and stripping it would collapse a whole catalogue
 * onto one URL.
 */
const TRACKING_PARAM =
  /^(?:utm_\w+|gclid|fbclid|msclkid|mc_[ce]id|igshid|ref|referrer|source|campaign|_branch_match_id|epik|srsltid|yclid|_gl)$/i;

function cleanUrl(url) {
  const kept = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    if (!TRACKING_PARAM.test(key)) kept.append(key, value);
  }
  const query = kept.toString();
  return url.origin + url.pathname + (query ? `?${query}` : '');
}

const PATTERNS = [
  {
    sourceId: 'grailed',
    host: /(^|\.)grailed\.com$/i,
    parse(url) {
      // /listings/12345678-comme-des-garcons-homme-plus-wool-jacket
      const m = url.pathname.match(/\/listings\/(\d+)(?:-(.*))?$/);
      if (!m) return {};
      return {
        sourceItemId: m[1],
        titleRaw: m[2] ? slugToText(m[2]) : undefined,
      };
    },
  },
  {
    sourceId: 'vestiaire',
    host: /(^|\.)vestiairecollective\.com$/i,
    parse(url) {
      // /women-clothing/jackets/comme-des-garcons/black-wool-jacket-12345678.shtml
      const segments = url.pathname.split('/').filter(Boolean);
      const last = segments.at(-1) ?? '';
      const m = last.match(/^(.*?)-(\d+)\.shtml$/);
      const out = {};
      if (m) {
        out.sourceItemId = m[2];
        out.titleRaw = slugToText(m[1]);
      }
      // Vestiaire puts the brand in its own path segment; useful, and it is
      // structure rather than inference.
      if (segments.length >= 3) out.brandRaw = slugToText(segments[2]);
      if (segments.length >= 2) out.category = slugToText(segments[1]);
      return out;
    },
  },
  {
    sourceId: 'therealreal',
    host: /(^|\.)therealreal\.com$/i,
    parse(url) {
      // /products/women/clothing/jackets/comme-des-garcons-wool-jacket-abc123
      const segments = url.pathname.split('/').filter(Boolean);
      const idx = segments.indexOf('products');
      if (idx === -1) return {};
      const last = segments.at(-1) ?? '';
      const out = { sourceItemId: last || undefined, titleRaw: slugToText(last) };
      const category = segments.slice(idx + 1, -1);
      if (category.length) out.category = category.map(slugToText).join(' / ');
      return out;
    },
  },
];

/**
 * @returns {{
 *   ok: boolean,
 *   sourceId: string|null,
 *   url: string|null,
 *   fields: Record<string, string>,
 *   unresolved: string[],
 *   note: string,
 * }}
 */
export function prefillFromUrl(input, sources = []) {
  const raw = (input ?? '').trim();
  // Fields a URL structurally cannot carry. Named explicitly so the form can
  // show you what still needs filling instead of silently leaving gaps.
  const NEVER_IN_URL = ['price', 'currency', 'size_raw', 'condition_raw', 'image_url'];

  if (!raw) {
    return { ok: false, sourceId: null, url: null, fields: {}, unresolved: NEVER_IN_URL, note: 'no URL given' };
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, sourceId: null, url: null, fields: {}, unresolved: NEVER_IN_URL, note: 'not a valid URL' };
  }

  const matched = PATTERNS.find((p) => p.host.test(url.hostname));

  // The venue: whatever source is configured for this host, else the pattern's
  // own guess, else the catch-all. The configured source wins because it is
  // the one that reflects how YOU have this venue set up — including whether
  // it is somewhere you buy or somewhere you sell.
  const sourceId = sourceForHost(url.hostname, sources) ?? matched?.sourceId ?? 'manual_other';

  const parsed = matched?.parse(url) ?? {};
  const fields = Object.fromEntries(
    Object.entries(parsed).filter(([, v]) => v != null && v !== ''),
  );

  const note = matched
    ? Object.keys(fields).length
      ? `prefilled ${Object.keys(fields).length} field(s) from URL structure`
      : 'URL recognised but carried no usable fields'
    : sourceId !== 'manual_other'
      ? `recognised ${url.hostname} as ${sourceId} — no id pattern known, enter fields by hand`
      : `no URL pattern known for ${url.hostname} — enter fields by hand`;

  return {
    ok: true,
    sourceId,
    url: cleanUrl(url),
    fields,
    unresolved: NEVER_IN_URL,
    note,
  };
}
