// Merchant product feeds.
//
// This is the sanctioned way into the venues that refuse crawlers, and it is
// how The RealReal becomes reachable without touching their site.
//
// Retailers publish their whole catalogue — id, title, brand, price, currency,
// condition, availability, link, image — to affiliate networks precisely so
// that it can be ingested and republished by other people. Joining the
// programme gives a feed URL. Reading it is the intended use, at the cadence
// the merchant sets, from a document the merchant generates. There is no
// crawling, no bot protection to get past, and no terms being bent: the feed
// exists to be read by exactly this kind of program.
//
// Two formats cover nearly every network:
//
//   * Google Merchant / RSS 2.0 with the g: namespace — Rakuten Advertising,
//     Impact, CJ, Awin and Google Shopping all speak it.
//   * Delimited text (CSV/TSV) with a header row, which the same networks
//     offer as an alternative and some offer exclusively.
//
// Nothing here is specific to one merchant. A feed URL and a column mapping is
// all a new one needs.

import { gunzipSync, inflateSync } from 'node:zlib';
import { succeeded, failed } from './contract.mjs';

export const id = 'merchant_feed';

/**
 * Decompress a feed body if it is compressed.
 *
 * Detected by magic bytes rather than by the URL or the content type, because
 * both lie: networks serve .gz files as text/plain and .txt files with a .gz
 * name. The bytes do not.
 */
function decompress(buffer) {
  if (buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    return gunzipSync(buffer).toString('utf8');           // gzip
  }
  if (buffer.length > 2 && buffer[0] === 0x78) {
    try { return inflateSync(buffer).toString('utf8'); } catch { /* not zlib */ }
  }
  return buffer.toString('utf8');
}

/** Which candidate actually divides this header into fields? */
function pickDelimiter(header) {
  let best = ',';
  let bestCount = 0;
  for (const d of ['|', '\t', ',', ';']) {
    const count = splitRow(header, d).length;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return bestCount > 1 ? best : ',';
}

/** Split one delimited line, honouring quoted fields containing the delimiter. */
function splitRow(line, delimiter) {
  const out = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; }  // an escaped quote
        else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { out.push(field); field = ''; }
    else field += ch;
  }
  out.push(field);
  return out;
}

/**
 * Undo XML escaping.
 *
 * `&amp;` is decoded LAST on purpose. A feed that escaped an already-escaped
 * string writes `&amp;lt;`, and decoding the ampersand first would turn that
 * into a `<` — inventing markup inside what is meant to be text.
 */
export function decodeEntities(text) {
  return String(text)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
    // Numeric entities, which is how every curly apostrophe and en dash in a
    // product title arrives. Left undecoded they reach brand resolution as
    // "Yohji Yamamoto&#8217;s", which matches nothing and quietly loses the
    // piece — a missing listing rather than a visible error.
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeChar(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeChar(Number(dec)))
    .replace(/&amp;/g, '&');
}

const safeChar = (code) =>
  Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';

/**
 * The spans of a document whose contents are text rather than markup.
 *
 * Scanned left to right, because which of the two opens first decides what the
 * other one is: `<!--` inside CDATA is four characters of a description, and
 * `<![CDATA[` inside a comment is nothing at all.
 */
function maskedRegions(body) {
  const out = [];
  let i = 0;
  while (i < body.length) {
    const cdata = body.indexOf('<![CDATA[', i);
    const comment = body.indexOf('<!--', i);
    if (cdata === -1 && comment === -1) break;

    const first = cdata === -1 ? comment : comment === -1 ? cdata : Math.min(cdata, comment);
    const [open, close] = first === cdata ? ['<![CDATA[', ']]>'] : ['<!--', '-->'];
    const end = body.indexOf(close, first + open.length);
    const stop = end === -1 ? body.length : end + close.length;
    out.push([first, stop]);
    i = stop;
  }
  return out;
}

/**
 * Where each `<item>` or `<entry>` element starts and ends.
 *
 * Done by scanning rather than by a non-greedy regex. A description is CDATA
 * more often than not, and product descriptions in these feeds contain HTML —
 * so a `</item>` inside a CDATA block would end the record early with the
 * regex, dropping every field after it and leaving a listing that looks
 * complete because nothing failed.
 */
export function splitItems(body) {
  const out = [];
  const masked = maskedRegions(body);
  const inMasked = (at) => masked.some(([from, to]) => at >= from && at < to);
  const open = /<(item|entry)(?=[\s/>])/gi;
  let m;

  while ((m = open.exec(body))) {
    // A commented-out or CDATA-quoted <item> is text about an item, not one.
    if (inMasked(m.index)) continue;
    const name = m[1].toLowerCase();
    let i = open.lastIndex;
    let depth = 1;

    while (i < body.length && depth > 0) {
      // Skip past anything whose contents are not markup, or the tags inside
      // it would be counted as nesting.
      if (body.startsWith('<![CDATA[', i)) {
        const end = body.indexOf(']]>', i);
        i = end === -1 ? body.length : end + 3;
        continue;
      }
      if (body.startsWith('<!--', i)) {
        const end = body.indexOf('-->', i);
        i = end === -1 ? body.length : end + 3;
        continue;
      }
      if (body[i] !== '<') { i++; continue; }

      const close = new RegExp(`^</${name}\\s*>`, 'i').exec(body.slice(i, i + name.length + 4));
      if (close) {
        depth--;
        i += close[0].length;
        continue;
      }
      const nested = new RegExp(`^<${name}(?=[\\s/>])`, 'i').exec(body.slice(i, i + name.length + 2));
      if (nested) {
        // A self-closing <item/> opens and closes at once.
        const tagEnd = body.indexOf('>', i);
        if (tagEnd > -1 && body[tagEnd - 1] !== '/') depth++;
        i = tagEnd === -1 ? body.length : tagEnd + 1;
        continue;
      }
      i++;
    }

    if (depth === 0) {
      out.push(body.slice(m.index, i));
      open.lastIndex = i;
    }
  }

  return out;
}

/**
 * Pull the value of one XML tag out of a fragment.
 *
 * Two shapes, because feeds use both: `<link>https://…</link>` and Atom's
 * `<link href="https://…"/>`. Reading only the first loses every URL in an
 * Atom feed — and a listing with no URL is one you cannot open, check or buy.
 */
export function tag(fragment, name) {
  const paired = fragment.match(
    new RegExp(`<(?:[a-zA-Z0-9]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[a-zA-Z0-9]+:)?${name}>`, 'i'),
  );
  if (paired) return decodeEntities(paired[1]).trim() || null;

  const selfClosing = fragment.match(
    new RegExp(`<(?:[a-zA-Z0-9]+:)?${name}(\\s[^>]*?)/?>`, 'i'),
  );
  if (!selfClosing) return null;

  const attrs = selfClosing[1] ?? '';
  for (const key of ['href', 'url', 'value', 'content']) {
    const found = attrs.match(new RegExp(`\\b${key}\\s*=\\s*"([^"]*)"|\\b${key}\\s*=\\s*'([^']*)'`, 'i'));
    const value = found?.[1] ?? found?.[2];
    if (value) return decodeEntities(value).trim() || null;
  }
  return null;
}

/**
 * A price field, which arrives as "1250.00 EUR", "EUR 1250.00", "1,250.00" or
 * a bare number depending on the network.
 *
 * The currency travels with the price wherever the feed states it. Reading the
 * number and dropping the code would leave the currency to be guessed later,
 * and a wrong currency is a 150x error rather than a small one.
 */
export function parsePrice(raw) {
  if (raw == null) return { amount: null, currency: null };
  const text = String(raw).trim();
  const currency = text.match(/\b([A-Z]{3})\b/)?.[1] ?? null;
  const numeric = text.replace(/[A-Z]{3}/g, '').replace(/[^0-9.,-]/g, '').trim();
  if (!numeric) return { amount: null, currency };

  // 1.234,56 (European) vs 1,234.56 (Anglo): whichever separator comes last is
  // the decimal one. Guessing wrongly moves the price by three orders of
  // magnitude, so it is decided rather than assumed.
  const lastComma = numeric.lastIndexOf(',');
  const lastDot = numeric.lastIndexOf('.');
  let normalised = numeric;
  if (lastComma > -1 && lastDot > -1) {
    normalised = lastComma > lastDot
      ? numeric.replace(/\./g, '').replace(',', '.')
      : numeric.replace(/,/g, '');
  } else if (lastComma > -1) {
    // A lone comma is a decimal separator only when it is followed by exactly
    // two digits at the end; otherwise it groups thousands.
    normalised = /,\d{2}$/.test(numeric) ? numeric.replace(',', '.') : numeric.replace(/,/g, '');
  }
  const amount = Number(normalised);
  return { amount: Number.isFinite(amount) ? amount : null, currency };
}

const DEFAULT_MAPPING = {
  sourceItemId: ['id', 'g:id', 'product_id', 'sku'],
  title: ['title', 'g:title', 'name', 'product_name'],
  brandRaw: ['brand', 'g:brand', 'manufacturer'],
  price: ['sale_price', 'g:sale_price', 'price', 'g:price'],
  url: ['link', 'g:link', 'product_url', 'url'],
  imageUrl: ['image_link', 'g:image_link', 'image_url', 'image'],
  conditionRaw: ['condition', 'g:condition', 'item_condition'],
  sizeRaw: ['size', 'g:size'],
  availability: ['availability', 'g:availability', 'in_stock'],
};

function pick(record, names) {
  for (const n of names) {
    const v = record[n] ?? record[n.replace(/^g:/, '')] ?? record[`g:${n}`];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}

function toRawListing(record, config) {
  const mapping = { ...DEFAULT_MAPPING, ...(config.mapping ?? {}) };
  const get = (field) => pick(record, [].concat(mapping[field] ?? []));

  const { amount, currency } = parsePrice(get('price'));
  const title = get('title');
  if (!title || amount == null) return null;

  const availability = (get('availability') ?? '').toLowerCase();

  return {
    sourceItemId: get('sourceItemId') ?? get('url') ?? title,
    title,
    brandRaw: get('brandRaw') ?? undefined,
    price: amount,
    // The feed's own currency wins; the configured one is the fallback for
    // feeds that state it once in a header rather than per row.
    currency: currency ?? config.currency,
    sizeRaw: get('sizeRaw') ?? undefined,
    conditionRaw: get('conditionRaw') ?? undefined,
    url: get('url') ?? undefined,
    imageUrl: get('imageUrl') ?? undefined,
    // "out of stock" in a feed means the merchant is not selling it now. It
    // does not mean it sold — a withdrawn or reserved piece looks identical —
    // so this reports availability and never a sale.
    available: availability ? !/out.?of.?stock|unavailable|false|0/.test(availability) : undefined,
  };
}

/**
 * @param {object} config { url, format?, currency, mapping?, delimiter? }
 * @param {object} deps   { fetchImpl }
 */
export async function fetchListings(config, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  if (!config.url) return failed('no feed url configured');

  let body;
  try {
    const res = await fetchImpl(config.url, {
      headers: { 'user-agent': config.userAgent ?? 'resale-tracker/0.1', accept: '*/*' },
      signal: AbortSignal.timeout(config.timeoutMs ?? 300_000),
    });
    if (!res.ok) return failed(`feed returned ${res.status}`);

    // Affiliate feeds are nearly always compressed FILES, not compressed
    // responses. A .txt.gz served as application/gzip is not decompressed by
    // fetch — Content-Encoding is about the transfer, and this is the body —
    // so reading it as text yields binary and the parser reports "no rows",
    // which is a true statement about entirely the wrong problem. This was the
    // reason a real Rakuten or Awin feed could not be read at all.
    const buffer = Buffer.from(await res.arrayBuffer());
    body = decompress(buffer);
  } catch (err) {
    return failed(`feed unreachable: ${err?.message ?? err}`);
  }

  if (!body.trim()) return failed('feed was empty');

  const format = config.format ?? (/^\s*<\?xml|<rss|<feed/i.test(body) ? 'xml' : 'csv');
  const records = [];

  if (format === 'xml') {
    const items = splitItems(body);
    for (const item of items) {
      const record = {};
      for (const names of Object.values(DEFAULT_MAPPING)) {
        for (const n of names) {
          const bare = n.replace(/^g:/, '');
          const value = tag(item, bare);
          if (value != null && record[bare] == null) record[bare] = value;
        }
      }
      records.push(record);
    }
  } else {
    const lines = body.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return failed('feed had no rows under its header');
    // Rakuten Advertising delimits with a pipe, Awin and CJ with a comma or a
    // tab. Chosen by which one actually divides the header into fields, rather
    // than by preference: a comma inside a quoted product title would otherwise
    // beat a pipe that is the real delimiter.
    const delimiter = config.delimiter ?? pickDelimiter(lines[0]);
    const header = splitRow(lines[0], delimiter).map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase());
    for (const line of lines.slice(1)) {
      const cells = splitRow(line, delimiter);
      // A row with the wrong number of cells is a parse failure, not a product.
      // Keeping it would silently misalign every field on that row.
      if (cells.length !== header.length) continue;
      records.push(Object.fromEntries(header.map((h, i) => [h, cells[i]])));
    }
  }

  const listings = records.map((r) => toRawListing(r, config)).filter(Boolean);
  if (!listings.length) {
    return failed(
      `parsed ${records.length} rows but none had both a title and a price — check the column mapping`,
    );
  }

  // A merchant feed is the whole catalogue by definition: that is what it is
  // for. So a poll of it can legitimately conclude an item is gone, unlike a
  // paginated crawl that may simply have stopped early.
  return succeeded(listings, {
    complete: true,
    note: `${listings.length} of ${records.length} rows usable (${format})`,
  });
}
