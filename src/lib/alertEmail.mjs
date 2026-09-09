// Reading a saved-search alert email.
//
// The venues that publish no feed and permit no crawler will nonetheless send
// you their listings, by email, on their own schedule, through a channel they
// built for exactly this. Forwarding those to a mailbox and reading them there
// is not scraping: nothing is fetched from the site, and the site chose what to
// send. It is the same act as reading the email yourself, done on a timer.
//
// Why this is not the page parser
// -------------------------------
// A copied page is cut at prices, because a page has no other reliable
// boundary. An email does: every listing in one is a link, and the lines that
// belong to it are the lines inside that link. Cutting at prices instead
// produced eight fragments from a two-listing email, with the prices detached
// from the titles — measured, not assumed.
//
// So blocks here are runs of lines that share a URL, and lines belonging to no
// link — the greeting, the footer, "you are receiving this because" — are
// dropped rather than glued onto whichever listing they happen to sit beside.

import { parseHtml } from './html.mjs';
import { walkParsedHtml, usableUrl, imageWithin } from './pastedHtml.mjs';
import { fieldsFromBlock } from './pastedPage.mjs';

/**
 * Links that are in every one of these emails and are never a listing.
 *
 * Matched on the URL rather than the words around it, so it works whatever
 * language the mail is in.
 */
const NOT_A_LISTING =
  /\/(?:unsubscribe|preferences|settings|account|help|support|privacy|terms|about|app|download|login|signin|feedback|manage|orders?|order-status|track(?:ing)?|receipts?|invoices?|returns?)\b|mailto:|\/(?:facebook|instagram|twitter|x|pinterest|tiktok|youtube)\.com/i;

/**
 * The listings in one alert email.
 *
 * @param {string} html the message's text/html part
 * @returns {{ blocks: object[], note: string }}
 */
export function blocksFromEmail(html) {
  const root = parseHtml(html);
  const { lines, links } = walkParsedHtml(root);
  const byLine = new Map(links.map(([at, url, image]) => [at, { url, image }]));

  // Runs of consecutive lines sharing one URL. A listing's brand, name, price
  // and size are contiguous in every one of these layouts, because they are
  // the contents of one anchor or one table cell.
  const runs = [];
  let current = null;

  // Every picture the mail carries, by the listing it points at. Collected
  // separately because the image and the words are usually in DIFFERENT cells
  // linking to the same piece — and the picture's cell has no price, so it
  // never survives to become a block of its own.
  //
  // Taken from the tree rather than from the walked lines, because the cell
  // holding the picture usually contains NO text — so it produces no line, and
  // a picture that belongs to no line is invisible to everything downstream.
  const imageByUrl = imagesByLink(root);
  for (const [, url, image] of links) {
    if (url && image && !imageByUrl.has(url)) imageByUrl.set(url, image);
  }

  lines.forEach((text, at) => {
    const link = byLine.get(at) ?? { url: null, image: null };
    if (!link.url || NOT_A_LISTING.test(link.url)) {
      current = null;
      return;
    }
    if (!current || current.url !== link.url) {
      current = { url: link.url, image: link.image, lines: [] };
      runs.push(current);
    }
    if (!current.image && link.image) current.image = link.image;
    current.lines.push({ text, url: link.url, image: link.image });
  });

  // The same fields as a pasted page, from the same function: a title, the
  // price you would pay, the struck-through original, size and condition.
  const blocks = [];
  const seen = new Map();
  for (const run of runs) {
    const fields = fieldsFromBlock(run.lines);
    if (!fields.title || !fields.price) continue;    // a bare link is not a listing
    const url = fields.url ?? run.url;

    // One listing linked twice — from its picture and from its name — is one
    // listing. Whichever mention carried more of it wins.
    const already = seen.get(url);
    if (already) {
      if ((fields.lines ?? 0) > (already.lines ?? 0)) Object.assign(already, fields, { url });
      continue;
    }
    const block = {
      ...fields,
      url,
      image: fields.image ?? run.image ?? imageByUrl.get(url) ?? null,
    };
    seen.set(url, block);
    blocks.push(block);
  }

  return {
    blocks,
    note: `${blocks.length} listing${blocks.length === 1 ? '' : 's'} read from an alert email`,
  };
}

/**
 * Does this message look like a saved-search alert at all?
 *
 * Used to skip the rest of a mailbox rather than to trust anything: a receipt
 * or a newsletter parses to nothing useful anyway, and this only saves the
 * work and keeps the log honest about what was skipped.
 */
export function looksLikeAlert(html) {
  const { blocks } = blocksFromEmail(html);
  return blocks.length > 0;
}

/**
 * Every listing URL in the message, with the first picture inside its link.
 *
 * These emails are built as two cells per row — the picture in one, the words
 * in the other, both linking to the same piece — so neither cell alone is the
 * listing and the picture's cell has no text at all.
 */
function imagesByLink(node, into = new Map()) {
  if (!node || node.nodeType !== 1) return into;
  if (node.nodeName === 'A') {
    const href = usableUrl(node.getAttribute?.('href'));
    const image = href ? imageWithin(node) : null;
    if (href && image && !into.has(href)) into.set(href, image);
  }
  for (const child of node.childNodes ?? []) imagesByLink(child, into);
  return into;
}

/**
 * What the parser saw, when it saw nothing usable.
 *
 * An empty result used to print "the parser wants to see it" — which hands
 * the diagnosis straight back to the person who cannot make it, and is why
 * this path went three rounds without ever being run against a real message.
 * These are the intermediate signals, and each one distinguishes a different
 * failure: no links at all means the HTML part was stripped or the message was
 * plain text; links but no money means the prices are in images, which these
 * senders do sometimes; runs of one line each means the layout does not keep a
 * listing's fields under one anchor, which is the assumption this rests on.
 */
export function diagnoseEmail(html) {
  const root = parseHtml(html);
  const { lines, links } = walkParsedHtml(root);
  const urls = new Set(links.map(([, url]) => url).filter(Boolean));
  const listingUrls = [...urls].filter((u) => !NOT_A_LISTING.test(u));
  const moneyLines = lines.filter((l) => MONEY_HINT.test(l)).length;

  return {
    lines: lines.length,
    linkedLines: links.filter(([, url]) => url).length,
    urls: urls.size,
    listingUrls: listingUrls.length,
    moneyLines,
    images: links.filter(([, , image]) => image).length,
    sampleUrls: listingUrls.slice(0, 3),
    sampleLines: lines.filter((l) => l.trim()).slice(0, 8),
  };
}

// Only for the diagnostic above: a loose "does this look like a price" test.
// Deliberately looser than the parser's own, because its job is to tell the
// difference between "no prices in this mail" and "prices this could not read".
const MONEY_HINT = /[¥￥€£$]\s*\d|\d[\d.,]*\s*(?:JPY|EUR|GBP|USD|CHF)\b/i;
