// A small HTML parser, for the places there is no browser.
//
// The paste importer walks a DOM that DOMParser built. The same walk is worth
// far more on the server — an alert email is HTML, and its anchors are the
// links to the listings — but node has no DOM and pulling one in would be a
// large dependency for one file.
//
// So this builds a tree with exactly the shape walkParsedHtml already reads:
// nodeType, nodeName, childNodes, getAttribute, textContent. Nothing else. It
// is not a conforming HTML parser and does not try to be — no implied <tbody>,
// no adoption agency, no scripting. What it does handle is what email and
// listing markup actually contains: attributes in every quoting style, void
// and self-closing elements, comments, raw-text elements, entities, and close
// tags that do not match, which mail clients emit constantly.
//
// Deliberately a scanner rather than a regex. The last regex-based markup
// reader in this codebase truncated a record whenever a description contained
// something that looked like a closing tag, and the failure was invisible.

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);

/** Elements whose content is text, not markup, until their closing tag. */
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']);

/**
 * What an opening tag implicitly closes.
 *
 * Mail HTML is full of unclosed <p>, <td> and <tr>. Without this a message
 * becomes one deeply nested element: the second cell sits inside the first,
 * and every later line inherits the first listing's link — which is exactly
 * the mistake this whole path exists to avoid.
 *
 * Only the cases that occur in table-based email are handled. A row closes any
 * open cell before it closes the row itself, which is why the values are sets
 * popped in a loop rather than one tag each.
 */
const IMPLICIT_CLOSE = {
  p: new Set(['P']),
  li: new Set(['LI']),
  td: new Set(['TD', 'TH']),
  th: new Set(['TD', 'TH']),
  tr: new Set(['TD', 'TH', 'TR']),
  tbody: new Set(['TD', 'TH', 'TR', 'THEAD', 'TBODY']),
  thead: new Set(['TD', 'TH', 'TR']),
  tfoot: new Set(['TD', 'TH', 'TR']),
  option: new Set(['OPTION']),
  dd: new Set(['DD', 'DT']),
  dt: new Set(['DD', 'DT']),
};

const ELEMENT = 1;
const TEXT = 3;

export function decodeEntities(text) {
  return String(text)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&#160;/g, ' ')
    .replace(/&(?:mdash|ndash);/g, '—').replace(/&(?:lsquo|rsquo);/g, '’')
    .replace(/&(?:ldquo|rdquo);/g, '"').replace(/&hellip;/g, '…')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeChar(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeChar(Number(dec)))
    // Last, so an already-escaped string does not gain markup it never had.
    .replace(/&amp;/g, '&');
}

const safeChar = (code) =>
  Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';

function element(name, attrs) {
  const node = {
    nodeType: ELEMENT,
    nodeName: name.toUpperCase(),
    tagName: name.toUpperCase(),
    attrs,
    childNodes: [],
    getAttribute(key) {
      const value = attrs[String(key).toLowerCase()];
      return value === undefined ? null : value;
    },
    get textContent() {
      return node.childNodes.map((c) => c.textContent ?? '').join('');
    },
  };
  return node;
}

const textNode = (text) => ({ nodeType: TEXT, nodeName: '#text', textContent: text, childNodes: [] });

/** Read a tag's attributes, in any of the three quoting styles that occur. */
function readAttrs(source) {
  const attrs = {};
  const pattern = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g;
  let m;
  while ((m = pattern.exec(source))) {
    const name = m[1].toLowerCase();
    if (!name) continue;
    attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

/**
 * Parse a document into a tree walkParsedHtml can read.
 *
 * Returns a synthetic root; its childNodes are the document's top level. The
 * root is not <html> or <body>, because email fragments frequently have
 * neither and a parser that insists on them drops everything.
 */
export function parseHtml(html) {
  const source = String(html ?? '');
  const root = element('#root', {});
  const stack = [root];
  const open = () => stack[stack.length - 1];

  let i = 0;
  let text = '';

  const flushText = () => {
    if (!text) return;
    const decoded = decodeEntities(text);
    if (decoded.trim() || /\s/.test(decoded)) open().childNodes.push(textNode(decoded));
    text = '';
  };

  while (i < source.length) {
    const lt = source.indexOf('<', i);
    if (lt === -1) {
      text += source.slice(i);
      break;
    }
    text += source.slice(i, lt);

    // Comments, doctypes and CDATA carry no content worth keeping, and their
    // insides must never be read as markup — a commented-out card is not a card.
    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4);
      i = end === -1 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<!', lt) || source.startsWith('<?', lt)) {
      const end = source.indexOf('>', lt);
      i = end === -1 ? source.length : end + 1;
      continue;
    }

    const gt = source.indexOf('>', lt);
    if (gt === -1) {                       // an unterminated tag: the rest is text
      text += source.slice(lt);
      break;
    }
    const inner = source.slice(lt + 1, gt);

    if (inner.startsWith('/')) {
      flushText();
      const name = inner.slice(1).trim().toLowerCase();
      // Close the nearest matching ancestor, and nothing if there is none:
      // a stray </div> in an email must not unwind the whole document.
      for (let depth = stack.length - 1; depth > 0; depth--) {
        if (stack[depth].nodeName === name.toUpperCase()) {
          stack.length = depth;
          break;
        }
      }
      i = gt + 1;
      continue;
    }

    const match = inner.match(/^([a-zA-Z][^\s/>]*)/);
    if (!match) {                          // "< " and similar: literal text
      text += source.slice(lt, gt + 1);
      i = gt + 1;
      continue;
    }
    flushText();

    const name = match[1].toLowerCase();
    const attrs = readAttrs(inner.slice(match[1].length));
    const selfClosing = inner.trimEnd().endsWith('/');

    const closes = IMPLICIT_CLOSE[name];
    if (closes) {
      while (stack.length > 1 && closes.has(open().nodeName)) stack.pop();
    }

    const node = element(name, attrs);
    open().childNodes.push(node);
    i = gt + 1;

    if (VOID.has(name) || selfClosing) continue;

    if (RAW_TEXT.has(name)) {
      // Everything up to the matching close is text, markup-looking or not.
      const closeAt = source.toLowerCase().indexOf(`</${name}`, i);
      const raw = source.slice(i, closeAt === -1 ? source.length : closeAt);
      if (raw) node.childNodes.push(textNode(raw));
      if (closeAt === -1) break;
      const closeEnd = source.indexOf('>', closeAt);
      i = closeEnd === -1 ? source.length : closeEnd + 1;
      continue;
    }

    stack.push(node);
  }

  flushText();
  return root;
}
