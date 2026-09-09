// Parsing a listing page you copied off your own screen.
//
// This is the route into venues that publish no feed and permit no crawler.
// You are looking at a page of search results; you select all, copy, and paste
// it here. Nothing is fetched, nothing is crawled, no access control is
// touched — it is the same act as writing the listings down, done at the speed
// of a keystroke instead of a minute each.
//
// What arrives is not tidy. A copied page is a flat run of lines with the
// structure stripped out, and every site orders them differently:
//
//     Comme des Garçons Homme Plus        Comme des Garcons
//     Wool Blend Blazer                   AD2002 Wool Tailored Jacket
//     $1,150.00                           $850
//     $2,300.00                           Size 46
//     Size: M
//
// The one dependable landmark is the price: every listing has exactly one
// current price, and nothing else on the page looks like money. So records are
// cut at price boundaries rather than at blank lines, which a copied page
// mostly does not have.
//
// The text is not all that was copied, though — and the first version of this
// threw the rest away. A browser puts TWO flavours on the clipboard: the plain
// text a textarea receives, and `text/html`, which still has the anchors and
// the images, with every relative URL rewritten to an absolute one. Dropping
// that made every pasted listing unreachable: to look one up again you had to
// find it by name on the site you took it from, and at a hundred rows a paste
// that is not a workflow.
//
// So a line here is a small object rather than a string — its text, and the
// link and image the browser had for it. Everything else works exactly as it
// did; a plain-text paste simply has nulls in those slots.

import { resolveBrand } from './resolve.mjs';

const SYMBOL_CURRENCY = { '¥': 'JPY', '￥': 'JPY', '€': 'EUR', '£': 'GBP', '$': 'USD' };
const CODE_PATTERN = /\b(JPY|EUR|GBP|USD|CHF|SEK|DKK|NOK|CAD|AUD)\b/i;

/**
 * Parse a money-ish fragment.
 *
 * European and Anglo conventions collide here: "1.234,56" and "1,234.56" are
 * the same amount written two ways, and "48,000" is either 48000 or 48.0
 * depending on locale. Where a string is genuinely ambiguous we return the
 * amount but flag it, rather than picking a convention and being quietly wrong
 * on a whole pasted batch.
 */
export function parseMoney(text) {
  if (!text) return { amount: null, currency: null, ambiguous: false };

  let currency = null;
  for (const [symbol, code] of Object.entries(SYMBOL_CURRENCY)) {
    if (text.includes(symbol)) {
      currency = code;
      break;
    }
  }
  const codeMatch = text.match(CODE_PATTERN);
  if (codeMatch) currency = codeMatch[1].toUpperCase();

  const numMatch = text.match(/\d[\d.,\s ]*\d|\d/);
  if (!numMatch) return { amount: null, currency, ambiguous: false };

  const rawNum = numMatch[0].replace(/[\s ]/g, '');
  let amount = null;
  let ambiguous = false;

  const lastComma = rawNum.lastIndexOf(',');
  const lastDot = rawNum.lastIndexOf('.');

  if (lastComma === -1 && lastDot === -1) {
    amount = Number(rawNum);
  } else if (lastComma > -1 && lastDot > -1) {
    // Both present: the rightmost separator is the decimal point.
    const decimalAt = Math.max(lastComma, lastDot);
    const intPart = rawNum.slice(0, decimalAt).replace(/[.,]/g, '');
    const fracPart = rawNum.slice(decimalAt + 1);
    amount = Number(`${intPart}.${fracPart}`);
  } else {
    const sepAt = Math.max(lastComma, lastDot);
    const tail = rawNum.slice(sepAt + 1);
    if (tail.length === 3) {
      // Three trailing digits: almost certainly a thousands separator.
      amount = Number(rawNum.replace(/[.,]/g, ''));
      // "1,000" could still be one thousand or 1.000 in some notations, but
      // three-digit grouping is overwhelmingly thousands. Not flagged.
    } else if (tail.length === 2) {
      amount = Number(`${rawNum.slice(0, sepAt).replace(/[.,]/g, '')}.${tail}`);
    } else {
      amount = Number(rawNum.replace(/[.,]/g, ''));
      ambiguous = true;
    }
  }

  if (!Number.isFinite(amount)) return { amount: null, currency, ambiguous: true };

  // JPY has no minor unit, so a decimal fraction means we misread the string.
  if (currency === 'JPY' && !Number.isInteger(amount)) ambiguous = true;

  return { amount, currency, ambiguous };
}

const MONEY = /(?:[¥￥€£$]|\b(?:JPY|EUR|GBP|USD|CHF|SEK|DKK|NOK|CAD|AUD)\b)\s*[\d][\d.,\s]*|\d[\d.,]*\s*(?:JPY|EUR|GBP|USD|CHF)\b/i;

// Lines that are page furniture rather than anything about a garment. Kept
// short deliberately: over-filtering silently drops real titles, and a stray
// "Add to cart" in a title is a cosmetic problem, not a wrong price.
const FURNITURE =
  /^(?:add to (?:cart|bag)|sold(?: out)?|sale|free shipping|shipping|ships? (?:from|to|within)\b.*|est\.? delivery.*|delivery.*|quick (?:add|view)|favou?rite|save|wish ?list|follow|share|filter|sort(?: by)?:?|load more|see more|next|previous|showing[\s\d,]*(?:of[\s\d,]*)?(?:results?|items?)?|[\d,]+\s*(?:results?|items?|listings?)|page \d+|seller|verified|authenticated|related searches|sign up.*|log ?in.*|menswear|womenswear|sell|vintage|sneakers|staff pick(?:s)?|collections|editorial|grails|hype|core|designer|japanese brand|not specified)$/i;

/**
 * A line from a filter rail rather than from a listing.
 *
 * A copied Grailed page brings its whole left-hand rail with it — every
 * category, size, colour and condition, each with its count run onto the end of
 * the word: "Long Sleeve T-Shirts91", "Boots279", "Black1k+", "S/44-46243". A
 * few hundred of them, all before the first price.
 */
const FILTER_LINE = new RegExp(
  [
    // A facet with its count run onto the end of the word, which is how every
    // one of them is copied: "Boots279", "Black1k+", "Staff Pick4". The count
    // is GLUED — no space — and that is the whole tell. A real title puts a
    // space before a number ("Guidi 992", "M.A+ B7"), so requiring the digits
    // to touch a letter is what keeps a model code out of this.
    "^[\\p{L}\\d][\\p{L}\\d&'’.\\-()/ ]*[\\p{L})]\\d[\\d,]*(?:k\\+)?$",
    // A size facet with its count: "XXS/4046", "S/44-46243", "26/2/3883".
    // Three digits at the end, because a real size ends in one or two.
    '^[\\p{L}\\d][\\p{L}\\d/.\\-]*/[\\p{L}\\d/.\\-]*\\d{3,}$',
    // Vestiaire brackets its counts instead of gluing them: "Clothing (1,204)",
    // "Never worn (52)", "Leather (233)". A count, not a year — three digits at
    // most unless it is grouped — so "Guidi 992 (2019)" is left alone.
    "^[\\p{L}\\d][\\p{L}\\d&'’.\\-/ ]*\\((?:\\d{1,3}|\\d{1,3}(?:[.,]\\d{3})+|\\d+k\\+?)\\)$",
  ].join('|'),
  'u',
);

/**
 * A price BOUND from the filter rail, not a price anything is for sale at.
 *
 * "Under €100", "€100 - €500", "€1,000+". These are the one thing on a rail
 * that looks like money, and because records are cut at money they opened a
 * phantom listing whose name was the rest of the rail — the "general page
 * details" that kept arriving as a row.
 */
const PRICE_FACET = new RegExp(
  [
    // "Under €100", "up to ¥50,000". Not anchored to the start of the line:
    // a rail built from inline spans copies as ONE line, so the bound arrives
    // with the rest of the rail in front of it ("Category Outerwear (14)
    // Under €200") — and that line is then read as a price, at whichever
    // number happens to come first in it.
    '\\b(?:under|over|up to|above|below|less than|more than)\\s*[¥￥€£$]?\\s*\\d',
    // "€100 - €500", "100–500"
    '^\\s*[¥￥€£$]?\\s*\\d[\\d.,]*\\s*(?:\\+|-|–|—|to)\\s*[¥￥€£$]?\\s*\\d[\\d.,]*\\s*$',
    // "€1,000+"
    '^[¥￥€£$]\\d[\\d.,]*\\s*\\+$',
  ].join('|'),
  'i',
);

const isFilterLine = (text) =>
  PRICE_FACET.test(text) ||
  (FILTER_LINE.test(text) && !hasMoney(text) && !SIZE_LINE.test(text));

// A size, in the forms these sites print it.
//
// The region tag is not decoration: Vestiaire prints "Size 38 FR" on every
// card, and without it here that line failed to read as a size and was joined
// into the NAME instead. Every Vestiaire piece then carried its own size in
// its title, so two listings of one garment in two sizes were two items, which
// is the same pooling failure the discount badge caused.
const SIZE_LINE =
  /^(?:size[:\s]+)?(?:[a-z]{0,2}\d{1,3}(?:\.\d)?|x{0,3}[sml]|one size|os)(?:\s*\/?\s*(?:fr|it|uk|us|eu|jp|de|int))?$/i;

/**
 * Where a card's name begins.
 *
 * Records are cut at prices, so the first block of a copied page holds
 * everything that came before the first listing. On Grailed that is the header,
 * a list of related searches, and a filter rail of several hundred categories
 * and sizes — all of which became the first listing's title.
 *
 * The rail is recognisable by shape and dropped earlier. The related searches
 * are not: "Ann Demeulemeester Tops" is a line of words, exactly like a title.
 *
 * What separates them is that a CARD BEGINS AT ITS DESIGNER. Every one of these
 * layouts prints the brand and then the piece, so reading backwards from the
 * price and stopping at the first line that names a house takes the card and
 * leaves the page — without a list of the words any one site happens to use,
 * which would go stale the moment a site changed its header.
 *
 * The cap is the fallback for a card that never names its brand on a line of
 * its own; four is generous for "brand / name / a line of detail".
 */
const MAX_TITLE_LINES = 4;

function titleLines(descriptive) {
  const out = [];
  for (let i = descriptive.length - 1; i >= 0 && out.length < MAX_TITLE_LINES; i--) {
    out.unshift(descriptive[i]);
    if (namesADesigner(descriptive[i].text)) break;
  }
  return out;
}

/**
 * Is this line the card's designer line, rather than a line that merely
 * mentions something a designer is known for?
 *
 * The alias has to be most of the line. Some sub-line aliases are ordinary
 * garment words — "derby" resolves to Guidi's shoes — so "992 horse leather
 * derby" resolves to a house while plainly being a NAME, and stopping there
 * would drop the "Guidi" line above it and with it half the identity.
 */
function namesADesigner(text) {
  const { brandId, matchedAlias } = resolveBrand(text);
  if (!brandId || !matchedAlias) return false;
  const words = (str) => String(str).trim().split(/\s+/).filter(Boolean).length;
  // Strictly more than half, not half. On a two-word line like "DRKSHDW
  // Jacket" or "992 derby" the alias is exactly half, and stopping there drops
  // the "Rick Owens" or "Guidi" line above it — half the identity, quietly.
  return words(matchedAlias) / Math.max(words(text), 1) > 0.5;
}

/** A line that is only a web address. */
const BARE_URL = /^https?:\/\/\S+$/i;

/**
 * How long ago it was listed. Grailed prints this under every card.
 *
 * It follows the price, so it lands at the FRONT of the next listing's title —
 * and a title that carries "about 2 hours ago" is a different title every time
 * the page is looked at. Identity is derived from the title, so the same
 * garment becomes a new item on every paste, pools with nothing, and never
 * reaches the opportunities screen for want of comps.
 */
const LISTED_AGO =
  /^(?:bumped\s+)?(?:about\s+|almost\s+|over\s+|~)?(?:an?|\d+)\s*(?:second|sec|minute|min|hour|hr|day|week|month|year)s?\s*(?:ago)?$/i;

/**
 * A discount badge: Vestiaire prints one on every reduced piece.
 *
 * Same failure as the time — it follows the price and joins the next title.
 * Unlike the time it is worth keeping, as a note: it says the seller has
 * already moved on the price, which is a fact about how the piece is selling.
 */
const DISCOUNT =
  /^(?:[-−–]\s*\d{1,2}\s*%|\d{1,2}\s*%\s*(?:off|discount|reduced)|save\s+\d{1,2}\s*%|price\s+drop(?:ped)?)$/i;

/**
 * Lines that follow a price and still belong to the piece above them.
 *
 * Records are cut at prices because the price is the one dependable landmark,
 * and everything a listing states AFTER its price would otherwise land on the
 * next one — which is worse than losing it, since the size or the link shown
 * would belong to a different garment.
 */
const TRAILS_A_LISTING = (text) =>
  SIZE_LINE.test(text) ||
  CONDITION_LINE.test(text) ||
  BARE_URL.test(text) ||
  LISTED_AGO.test(text) ||
  DISCOUNT.test(text);

// A condition line, in the wording these sites use. Worth pulling out rather
// than leaving in the title: condition decides which comps a piece may be
// valued against, so losing it into the title costs a tier, not a word.
const CONDITION_LINE =
  /^(?:condition[:\s]+)?(?:(?:like )?new(?: with(?:out)? tags?)?|nwt|nwot|pristine|mint|excellent|very good|good|fair|gently used|pre-?owned|used|worn|vintage)(?: condition)?$/i;

/**
 * One line of a copied page: what it said, and where it pointed.
 *
 * Accepts a bare string so every caller that has only text — a pasted note, a
 * test — keeps working without knowing this exists.
 */
export function asLine(line) {
  if (typeof line === 'string') return { text: line, url: null, image: null };
  return {
    text: String(line?.text ?? ''),
    url: line?.url ?? null,
    image: line?.image ?? null,
  };
}

const toLines = (input) =>
  (Array.isArray(input) ? input : String(input ?? '').split(/\r?\n/)).map(asLine);

/** Does this line carry a price? */
export function hasMoney(line) {
  return MONEY.test(line);
}

/**
 * Cut a copied page into one block per listing.
 *
 * A block runs from just after the previous price to and including the next
 * one, because on every layout worth supporting the descriptive lines come
 * before the price they describe.
 */
export function splitAtPrices(input) {
  const lines = toLines(input)
    .map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() }))
    .filter((l) => l.text && !FURNITURE.test(l.text) && !isFilterLine(l.text));

  const blocks = [];
  let buffer = [];

  for (const line of lines) {
    buffer.push(line);
    if (!hasMoney(line.text)) continue;

    // A second price with nothing describing a garment between it and the
    // first is the struck-through original, not a new listing — every resale
    // site shows both on a reduced piece, and treating it as a new record
    // invents a listing with no title.
    //
    // "Directly after" was too strict for Vestiaire, which prints the discount
    // badge BETWEEN the two prices. So the test is that nothing in between
    // names a garment: a badge, a size, a condition or a timestamp all still
    // belong to the card above.
    const prev = blocks[blocks.length - 1];
    if (prev && buffer.slice(0, -1).every((l) => TRAILS_A_LISTING(l.text))) {
      prev.push(...buffer);
      buffer = [];
      continue;
    }

    blocks.push(buffer);
    buffer = [];
  }

  // The last listing's size sits in the leftover buffer, after its price, with
  // no following price to close a block. Dropping it silently loses one size
  // per pasted page — always the same one, always the last, which is the kind
  // of gap that looks like the site simply did not state it.
  if (blocks.length) {
    const last = blocks[blocks.length - 1];
    while (buffer.length && TRAILS_A_LISTING(buffer[0].text)) {
      last.push(buffer.shift());
    }
  }

  // Anything still left over has no price and is not a listing — usually a footer.
  //
  // One correction before returning. Cutting at prices assumes every line
  // describing a piece comes BEFORE its price, and that is wrong for the size:
  // every one of these sites prints it after. Left alone it lands on the next
  // listing, which is worse than losing it — the size shown would belong to a
  // different garment.
  //
  // So a block that OPENS with size-like lines gives them back to the block
  // before it. Only leading ones, and only where a previous block exists, so a
  // page that genuinely leads with a size is unaffected.
  for (let i = 1; i < blocks.length; i++) {
    while (blocks[i].length > 1 && TRAILS_A_LISTING(blocks[i][0].text)) {
      blocks[i - 1].push(blocks[i].shift());
    }
  }

  return blocks;
}

/**
 * The link most likely to be this listing's own. See fieldsFromBlock.
 */
function chooseUrl(lines, descriptive) {
  const counts = new Map();
  for (const line of lines) {
    if (line.url) counts.set(line.url, (counts.get(line.url) ?? 0) + 1);
  }
  if (!counts.size) return null;

  const best = Math.max(...counts.values());
  const tied = [...counts.entries()].filter(([, n]) => n === best).map(([url]) => url);
  if (tied.length === 1) return tied[0];

  // Nearest the price, which closes the block — so the last descriptive line
  // carrying one of the tied links.
  for (let i = descriptive.length - 1; i >= 0; i--) {
    if (descriptive[i].url && tied.includes(descriptive[i].url)) return descriptive[i].url;
  }
  return tied[0];
}

/**
 * Which of a card's prices is the asking price, and which is the original.
 *
 * Only reorders where both parse to a comparable number in the same currency.
 * A pair this cannot read is left in the order the page printed it, because a
 * guess between two unreadable prices is worse than the status quo.
 */
function pickPrice(moneyLines) {
  const first = moneyLines[0]?.text ?? null;
  const second = moneyLines[1]?.text ?? null;
  if (!first || !second) return { price: first, wasPrice: second };

  const a = parseMoney(first);
  const b = parseMoney(second);
  const comparable =
    Number.isFinite(a.amount) && Number.isFinite(b.amount) &&
    !a.ambiguous && !b.ambiguous &&
    (a.currency ?? null) === (b.currency ?? null);
  if (!comparable) return { price: first, wasPrice: second };

  return a.amount <= b.amount
    ? { price: first, wasPrice: second }
    : { price: second, wasPrice: first };
}

/**
 * Turn one block into the fields a draft needs.
 *
 * Deliberately conservative about the title: the longest non-price, non-size
 * line is right far more often than any cleverer rule, and where it is wrong
 * it is wrong visibly, in a review step, rather than silently.
 */
export function fieldsFromBlock(block) {
  const lines = (block ?? []).map(asLine);
  const moneyLines = lines.filter((l) => hasMoney(l.text));
  const others = lines.filter((l) => !hasMoney(l.text));

  const sizeLine = others.find((l) => SIZE_LINE.test(l.text));
  const conditionLine = others.find((l) => l !== sizeLine && CONDITION_LINE.test(l.text));

  // A line that is nothing but a URL is an address, not a name. Some alert
  // emails print the link under the piece, and joined into the title it
  // reaches brand resolution as "Guidi 992 derby https://www.grailed.com/…",
  // which matches nothing — the address swamps the words that identify it.
  // It is still worth having as a link when the markup carried no anchor.
  const urlLine = others.find((l) => l !== sizeLine && l !== conditionLine && BARE_URL.test(l.text));

  // What the page says ABOUT the listing rather than about the garment. None
  // of it belongs in a name, and two of them change on their own: a time
  // reprints differently every hour, a discount every time the seller moves.
  const discountLine = others.find((l) => DISCOUNT.test(l.text));
  const descriptive = others.filter(
    (l) =>
      l !== sizeLine &&
      l !== conditionLine &&
      !BARE_URL.test(l.text) &&
      !LISTED_AGO.test(l.text) &&
      !DISCOUNT.test(l.text),
  );

  // Which link is the LISTING's?
  //
  // Most layouts wrap the whole card in one anchor, so every line carries the
  // same href and the question is moot. Where several appear, two rules settle
  // it, both learned from real pages:
  //
  //   1. The one on the most lines wins. A card's own anchor wraps its brand,
  //      its name, its price and its size; a stray nav or breadcrumb link that
  //      the cut swept into this block covers exactly one.
  //   2. On a tie, the one nearest the price. Cards that link the brand to a
  //      designer index and the name to the product produce a tie, and it is
  //      the piece you want to open, not the index.
  const url = chooseUrl(lines, descriptive) ?? urlLine?.text.trim() ?? null;

  // Where the block opens with lines belonging to a DIFFERENT link, they can be
  // page furniture the price-cut swept in: the first card of every copied page
  // inherits whatever preceded the grid, because there is no earlier price to
  // cut at. "Menswear AD2002 Wool Tailored Jacket" is the usual result.
  //
  // Trimmed only where one anchor demonstrably wraps this whole card — three
  // lines or more of it — because then anything before that anchor is, by
  // construction, outside the card. Where the links merely disagree (a brand
  // linking to a designer index, a name linking to the piece) nothing is
  // trimmed: dropping a brand from a title would cost the resolution of the
  // whole row, which is a far worse trade than a stray word.
  const wrapsWholeCard = url && lines.filter((l) => l.url === url).length >= 3;
  const startsAt = wrapsWholeCard ? descriptive.findIndex((l) => l.url === url) : 0;
  const trimmed = descriptive.slice(
    startsAt > 0 && descriptive.slice(0, startsAt).every((l) => l.url && l.url !== url)
      ? startsAt
      : 0,
  );

  // Brand first, title second, is the near-universal order — but only the
  // resolver can say which line is a brand, so both are handed on together and
  // it decides. Joining them also rescues the case where the brand and the
  // model are split across two lines.
  const own = titleLines(trimmed);
  const title = own.map((l) => l.text).join(' ').trim() || null;

  return {
    title,
    // Of two prices on a card, the one you would pay is the LOWER.
    //
    // This used to take whichever came first, which is a guess about layout
    // and the sites disagree: The RealReal prints the current price then the
    // original, Vestiaire prints the original, the discount badge, then the
    // reduced price. Reading the order wrong on Vestiaire meant every reduced
    // piece was recorded at its pre-discount price — an acquisition that looks
    // worse than it is, a comp that looks better, and no error anywhere.
    //
    // The relation is a fact rather than a layout: a struck-through price is
    // by definition the higher original. So compare the amounts.
    ...pickPrice(moneyLines),
    size: sizeLine ? sizeLine.text.replace(/^size[:\s]+/i, '').trim() : null,
    condition: conditionLine ? conditionLine.text.replace(/^condition[:\s]+/i, '').trim() : null,
    url,
    image: lines.find((l) => l.image)?.image ?? null,
    // Kept as a fact about the sale, not about the piece.
    discount: discountLine ? discountLine.text.trim() : null,
    lines: lines.length,
  };
}

/**
 * Does this look like a copied page rather than notes or a spreadsheet?
 *
 * Visible URLs in the text mean an alert email, which the record parser
 * handles better than this would — its links are its most reliable field, and
 * they are in the text where that parser can see them. A tab means a
 * spreadsheet. Both are decided first and neither is negotiable.
 *
 * What is left is a judgement about price count, and it has two answers
 * depending on what else the clipboard carried:
 *
 *   With links from the HTML flavour, ONE price is enough. Those links only
 *   exist because a browser copied a page, so the question is already
 *   answered — and the three-price rule was quietly wrong for a page holding
 *   one or two results, which is exactly what a narrow search returns. It fell
 *   through to the record splitter and produced a draft per LINE: eight
 *   nonsense rows, no prices, no links, from a page with two pieces on it.
 *
 *   Without them there is nothing else to go on, so three stands: it is what
 *   separates a page from someone's two-line note.
 */
export function looksLikePastedPage(text, links = []) {
  const input = String(text ?? '');
  if (/https?:\/\//i.test(input)) return false;
  if (/\t/.test(input)) return false;
  const priced = input.split(/\r?\n/).filter(hasMoney).length;
  return priced >= (links?.length ? 1 : 3);
}

/**
 * Re-attach what the clipboard's HTML knew to the text a textarea received.
 *
 * `links` is sparse — one entry per line that had a link or an image, by index
 * into the raw split of the same text. Sparse because most lines have neither,
 * and because the pair travels from the browser to the server on every parse.
 *
 * Indexes rather than text matching: the two are aligned by construction (the
 * paste handler writes the text FROM the same walk that produced the links),
 * and matching on text would misfile every page that repeats a title.
 *
 * @param {string} text
 * @param {Array<[number, string|null, string|null]>} links
 */
export function linesWithLinks(text, links = []) {
  const lines = String(text ?? '').split(/\r?\n/).map(asLine);
  for (const entry of links ?? []) {
    const [at, url, image] = entry ?? [];
    if (!Number.isInteger(at) || at < 0 || at >= lines.length) continue;
    lines[at] = { ...lines[at], url: url ?? null, image: image ?? null };
  }
  return lines;
}

/** @returns {{ blocks: object[], note: string }} */
export function parsePastedPage(input) {
  const blocks = splitAtPrices(input).map(fieldsFromBlock).filter((b) => b.title && b.price);
  const withLinks = blocks.filter((b) => b.url).length;
  return {
    blocks,
    note:
      `${blocks.length} listing${blocks.length === 1 ? '' : 's'} read from a pasted page` +
      (blocks.length && withLinks < blocks.length
        ? ` — ${blocks.length - withLinks} without a link back to the listing`
        : ''),
  };
}
