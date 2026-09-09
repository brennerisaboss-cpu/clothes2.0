// The other half of the clipboard.
//
// When you select a page and copy it, the browser puts two things on the
// clipboard: the plain text, which is what a textarea receives, and
// `text/html`, which is the selected DOM with the anchors and images still in
// it and — importantly — every relative URL already rewritten to an absolute
// one. The first version of the paste importer read only the text, so every
// listing arrived with no way back to the page it came from. Finding one again
// meant searching the site by name, which at a hundred rows an evening is not
// a workflow.
//
// This walks that HTML and produces exactly two things:
//
//   lines  the text, laid out the way the plain-text flavour would have been
//   links  [lineIndex, url, image] for the lines that had either
//
// The line layout has to be reproduced rather than borrowed, because the
// alignment between the two is the whole mechanism: the paste handler puts
// THESE lines in the textarea, so the index of a link is the index of a line,
// with no text-matching heuristic that could pair a row with another row's
// listing.
//
// Runs in the browser, where DOMParser exists. The traversal takes the parsed
// document rather than the string so it can be tested against a hand-built
// tree in node, which has no DOM.

/**
 * Elements that end the current line.
 *
 * The distinction is the reason this is not a flat text-node walk: a copied
 * card is full of `<div>Size: <span>M</span></div>`, and treating every text
 * node as a line would cut that into "Size:" and "M" — which stops matching
 * the size rules the text parser depends on. Inline elements accumulate;
 * block-level ones flush.
 */
const BLOCK = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BR', 'DD', 'DIV', 'DL', 'DT',
  'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4',
  'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION',
  'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
]);

/** Elements whose contents are not text on the page. */
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'HEAD']);

const ELEMENT = 1;
const TEXT = 3;

/** An href worth keeping: not a fragment, not a script, not a placeholder. */
export function usableUrl(raw, base = null) {
  if (!raw) return null;
  const value = String(raw).trim();
  if (!value || value.startsWith('#')) return null;
  if (/^(?:javascript|mailto|tel|data):/i.test(value)) return null;
  if (/^https?:\/\//i.test(value)) return value;

  // A relative URL needs a base, and there are two worlds here. A clipboard
  // carries none — every browser absolutises on copy, so a relative href in a
  // paste is a curiosity and guessing a base would produce links that go
  // somewhere WRONG rather than nowhere. Markup read straight off a page, as
  // the bookmarklet sends it, is the opposite: its hrefs are relative exactly
  // as the author wrote them, and the page's own address is the right base.
  if (!base) return null;
  try {
    const resolved = new URL(value, base);
    return /^https?:$/i.test(resolved.protocol) ? resolved.href : null;
  } catch {
    return null;
  }
}

/** The first real image inside an element, if it has one. */
export function imageWithin(node, depth = 0, base = null) {
  if (!node || depth > 12) return null;
  if (node.nodeType !== ELEMENT) return null;

  if (node.nodeName === 'IMG') {
    const src = node.getAttribute?.('src');
    // Lazy-loading placeholders are the usual content of `src` on a listing
    // grid; the real URL sits in a data attribute until it scrolls into view.
    const real =
      (src && !/^data:/i.test(src) ? src : null) ??
      node.getAttribute?.('data-src') ??
      node.getAttribute?.('data-original') ??
      null;
    return real ? usableUrl(real, base) : null;
  }

  for (const child of node.childNodes ?? []) {
    const found = imageWithin(child, depth + 1, base);
    if (found) return found;
  }
  return null;
}

/**
 * Every distinct listing URL inside an element, and its first image.
 *
 * Cached per element because the resolution below asks the same subtrees
 * repeatedly — once per line of a card.
 */
function subtreeLinks(node, cache, base = null) {
  if (node?.nodeType === TEXT) {
    return { hrefs: [], image: null, textLength: (node.textContent ?? '').trim().length };
  }
  if (!node || node.nodeType !== ELEMENT) return { hrefs: [], image: null, textLength: 0 };
  const hit = cache.get(node);
  if (hit) return hit;

  const hrefs = new Set();
  let image = null;
  let textLength = 0;

  if (node.nodeName === 'A') {
    const own = usableUrl(node.getAttribute?.('href'), base);
    if (own) hrefs.add(own);
  }
  if (node.nodeName === 'IMG') image = imageWithin(node, 0, base);

  if (!SKIP.has(node.nodeName)) {
    for (const child of node.childNodes ?? []) {
      const inner = subtreeLinks(child, cache, base);
      for (const href of inner.hrefs) hrefs.add(href);
      if (!image) image = inner.image;
      textLength += inner.textLength;
    }
  }

  const result = { hrefs: [...hrefs], image, textLength };
  cache.set(node, result);
  return result;
}

/**
 * How much text an element may hold and still be one listing's card.
 *
 * The climb below stops here as well as on a second link, and it is the guard
 * that matters when a page has ONE link in it: without a size limit, a whole
 * page of unlinked text would inherit that one link and every row would point
 * at the same wrong listing. A card is a brand, a name, a price and a size —
 * a few dozen characters, and the number here is deliberately loose because
 * the real guard is the one above it: a second distinct link. This only has to
 * catch the case of a page with exactly ONE link anywhere in it, so a card
 * carrying a long condition note or a seller blurb has room to spare.
 */
const CARD_TEXT_LIMIT = 1200;

/**
 * Walk a parsed clipboard document into lines and their links.
 *
 * The association between a line and a listing is the part that had to be
 * rewritten: the first version only looked for an anchor ABOVE the text, which
 * is one of at least three shapes these grids are built in.
 *
 *   <a><img><div>brand</div><div>$1,150</div></a>     text inside the anchor
 *   <div><a class="overlay"></a><div>brand</div>…</div>   an empty overlay link
 *   <div><a><img></a><div>brand</div>…</div>          the link on the image
 *
 * Only the first has an anchor above the text. In the other two the anchor is
 * a SIBLING of it, so the old walk found nothing, returned nothing, and the
 * paste quietly fell back to plain text with no links at all — which is
 * exactly the failure that was reported.
 *
 * So the rule is now about the card rather than about ancestry: a line takes
 * the nearest enclosing element whose whole subtree points at ONE listing.
 * That element is the card, whichever shape it is built in, and the climb
 * stops on its own at the grid — where several cards mean several distinct
 * links and no single answer.
 *
 * @param {{ childNodes?: ArrayLike<any> }} root the body (or fragment) to walk
 * @returns {{ lines: string[], links: Array<[number, string|null, string|null]>,
 *             anchors: number }}
 */
export function walkParsedHtml(root, options = {}) {
  const base = options.base ?? null;
  const lines = [];
  const links = [];
  const cache = new Map();

  let buffer = '';
  let stack = [];               // ancestors of whatever is being buffered
  let lineStack = null;         // the stack as it was when the line began

  const flush = () => {
    const text = buffer.replace(/\s+/g, ' ').trim();
    const ancestors = lineStack ?? stack;
    buffer = '';
    lineStack = null;
    if (!text) return;

    // Innermost first: an anchor directly around the text wins, then the
    // nearest ancestor that resolves to a single listing.
    let url = null;
    let image = null;
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const node = ancestors[i];
      const { hrefs, image: found } = subtreeLinks(node, cache, base);
      if (node.nodeName === 'A') {
        const own = usableUrl(node.getAttribute?.('href'), base);
        if (own) { url = own; image = found; break; }
      }
      // More than one listing in view means this is the grid, not a card.
      if (hrefs.length > 1) break;
      // Too much text means the same: we have climbed past the card.
      if (subtreeLinks(node, cache, base).textLength > CARD_TEXT_LIMIT) break;
      if (hrefs.length === 1) { url = hrefs[0]; image = found; break; }
    }

    lines.push(text);
    if (url || image) links.push([lines.length - 1, url, image]);
  };

  const visit = (node) => {
    if (!node) return;

    if (node.nodeType === TEXT) {
      if (!buffer) lineStack = stack.slice();
      buffer += node.textContent ?? '';
      return;
    }
    if (node.nodeType !== ELEMENT) return;
    if (SKIP.has(node.nodeName)) return;

    const block = BLOCK.has(node.nodeName);
    if (block) flush();

    stack.push(node);
    for (const child of node.childNodes ?? []) visit(child);
    stack.pop();

    if (block) flush();
  };

  visit(root);
  flush();

  const anchors = subtreeLinks(root, cache, base).hrefs.length;
  return { lines, links, anchors };
}

/**
 * Parse and walk one `text/html` clipboard flavour.
 *
 * Browser-only: DOMParser does the parsing, so nothing here has to be a
 * hand-written HTML parser, and the document it produces is inert — it is
 * never attached, so no script in it runs and no resource is fetched.
 */
export function walkPastedHtml(html) {
  if (!html || typeof DOMParser === 'undefined') {
    return { lines: [], links: [], anchors: 0, why: 'the clipboard carried no HTML' };
  }
  try {
    const doc = new DOMParser().parseFromString(String(html), 'text/html');
    const walked = walkParsedHtml(doc.body);
    return {
      ...walked,
      // Said rather than left to be inferred from an empty result. Every one of
      // these was a silent fallback to plain text before, which is why a paste
      // that carried nothing looked identical to one that worked.
      why: !walked.lines.length
        ? 'the clipboard HTML held no text'
        : !walked.anchors
          ? 'the copied HTML contains no links at all — copying from a text editor, ' +
            'a PDF or a screenshot loses them; copy from the page itself'
          : !walked.links.length
            ? 'links were present but none could be tied to a listing'
            : null,
    };
  } catch (err) {
    // A clipboard we cannot read is not an error worth stopping a paste for:
    // the plain-text path still works, just without the links.
    return { lines: [], links: [], anchors: 0, why: `the clipboard HTML could not be read: ${err?.message ?? err}` };
  }
}


/**
 * Should the paste handler take this paste over, or leave it to the browser?
 *
 * It must leave most of them alone. This textarea accepts three shapes, and
 * only one of them is a copied listing page:
 *
 *   a copied page      cut at prices; the links are the point
 *   an alert email     its URLs are in the text, and the record parser reads
 *                      them better than a DOM walk would
 *   a spreadsheet row  tab-delimited, and its columns are the structure
 *
 * The earlier version took over whenever the walk produced any lines at all,
 * which is nearly always — so an email or a spreadsheet was silently re-laid
 * out by DOM block rules instead of arriving as the browser's own plain-text
 * flattening. Both were still documented as supported, and nothing tested that
 * they still parsed the way they used to.
 *
 * So the rule is narrow: take over only for something that looks like a page
 * of listings AND carries links, and only when the browser's own text agrees
 * it is that shape. Anything else pastes natively and parses exactly as it did
 * before this feature existed.
 *
 * @param {{lines: string[], links: Array<[number, string|null, string|null]>}} walked
 * @param {string} nativeText what the browser would have pasted on its own
 */
export function shouldTakeOver(walked, nativeText, looksLikePage) {
  if (!walked?.links?.length) {
    return { takeOver: false, why: 'no links to add — the plain-text paste is unchanged' };
  }
  const walkedText = walked.lines.join('\n');
  if (!looksLikePage(walkedText, walked.links)) {
    return { takeOver: false, why: 'this does not read as a page of listings' };
  }
  if (nativeText && !looksLikePage(nativeText, walked.links)) {
    // The two disagree, which is what an alert email (URLs in its text) and a
    // spreadsheet (tabs) both look like. The browser's own text is the one the
    // other parsers were written against, so it wins.
    return { takeOver: false, why: 'the text pasted looks like an email or a spreadsheet, not a page' };
  }
  return { takeOver: true, why: null };
}
