import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walkParsedHtml } from '../src/lib/pastedHtml.mjs';

// The traversal, against a hand-built tree. Node has no DOM, and the walk
// deliberately takes a parsed document rather than a string so it can be
// exercised here without one — the only thing it needs of a node is its type,
// its name, its children and two attributes.

const txt = (text) => ({ nodeType: 3, textContent: text });
const el = (nodeName, attrs = {}, children = []) => ({
  nodeType: 1,
  nodeName: nodeName.toUpperCase(),
  childNodes: children,
  getAttribute: (name) => attrs[name] ?? null,
});

/** One listing card as these sites build them: an anchor around everything. */
const card = (href, img, ...lines) =>
  el('a', { href }, [
    el('img', { src: img }),
    ...lines.map((l) => el('div', {}, [txt(l)])),
  ]);

test('every line of a card carries the link back to the listing', () => {
  const { lines, links } = walkParsedHtml(
    el('div', {}, [
      card(
        'https://www.therealreal.com/products/88213-cdg',
        'https://cdn.invalid/88213.jpg',
        'Comme des Garçons Homme Plus',
        'Wool Blend Blazer',
        '$1,150.00',
      ),
    ]),
  );

  assert.deepEqual(lines, [
    'Comme des Garçons Homme Plus',
    'Wool Blend Blazer',
    '$1,150.00',
  ]);
  assert.equal(links.length, 3);
  for (const [, url, image] of links) {
    assert.equal(url, 'https://www.therealreal.com/products/88213-cdg');
    assert.equal(image, 'https://cdn.invalid/88213.jpg');
  }
});

test('links are indexed to lines, so two cards do not blur together', () => {
  // The whole mechanism: the textarea is filled from `lines`, so the index of
  // a link IS the index of a line. Matching on text instead would misfile
  // every page that repeats a title, which a resale grid does constantly.
  const { lines, links } = walkParsedHtml(
    el('div', {}, [
      card('https://example.invalid/a', 'https://cdn.invalid/a.jpg', 'Guidi', '$720.00'),
      card('https://example.invalid/b', 'https://cdn.invalid/b.jpg', 'Guidi', '$980.00'),
    ]),
  );

  assert.deepEqual(lines, ['Guidi', '$720.00', 'Guidi', '$980.00']);
  assert.equal(links[0][1], 'https://example.invalid/a');
  assert.equal(links[1][1], 'https://example.invalid/a');
  assert.equal(links[2][1], 'https://example.invalid/b');
  assert.equal(links[3][1], 'https://example.invalid/b');
});

test('inline markup inside a line does not split it', () => {
  // `<div>Size: <span>M</span></div>` is how half of these grids are built. A
  // flat text-node walk cuts it into "Size:" and "M", and the size stops being
  // recognised as a size — the text parser's rules are per line.
  const { lines } = walkParsedHtml(
    el('div', {}, [
      el('div', {}, [txt('Size: '), el('span', {}, [txt('M')])]),
      el('div', {}, [el('b', {}, [txt('$1,150')]), txt('.00')]),
    ]),
  );
  assert.deepEqual(lines, ['Size: M', '$1,150.00']);
});

test('an image after the text still belongs to the card', () => {
  // Document order is not layout order: plenty of grids put the picture last.
  const { links } = walkParsedHtml(
    el('a', { href: 'https://example.invalid/p' }, [
      el('div', {}, [txt('Rick Owens')]),
      el('div', {}, [txt('$430')]),
      el('img', { src: 'https://cdn.invalid/p.jpg' }),
    ]),
  );
  assert.equal(links.length, 2);
  assert.equal(links[0][2], 'https://cdn.invalid/p.jpg');
});

test('a lazy-loading placeholder is not mistaken for the picture', () => {
  const { links } = walkParsedHtml(
    el('a', { href: 'https://example.invalid/p' }, [
      el('img', {
        src: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==',
        'data-src': 'https://cdn.invalid/real.jpg',
      }),
      el('div', {}, [txt('Yohji Yamamoto')]),
      el('div', {}, [txt('$1,490')]),
    ]),
  );
  assert.equal(links[0][2], 'https://cdn.invalid/real.jpg');
});

test('links that go nowhere useful are never stored', () => {
  // A relative href cannot be resolved — the clipboard carries no base — and a
  // stored one would open the wrong site rather than none. Every browser
  // absolutises on copy, so this is a floor, not a common case.
  const { links } = walkParsedHtml(
    el('div', {}, [
      el('a', { href: '/products/88213' }, [el('div', {}, [txt('Relative')])]),
      el('a', { href: '#' }, [el('div', {}, [txt('Fragment')])]),
      el('a', { href: 'javascript:void(0)' }, [el('div', {}, [txt('Script')])]),
      el('a', { href: 'https://example.invalid/real' }, [el('div', {}, [txt('Real')])]),
    ]),
  );
  // Whatever is stored is the one real link — the unusable three are not
  // written anywhere. The lines beside it inherit it because their container
  // holds exactly one listing, which is the same rule that finds an overlay
  // link, and the price-per-block cut is what keeps that honest downstream.
  assert.ok(links.length >= 1);
  for (const [, url] of links) assert.equal(url, 'https://example.invalid/real');
});

test('a card with no anchor still yields its text', () => {
  const { lines, links } = walkParsedHtml(
    el('div', {}, [el('div', {}, [txt('Boris Bidjian Saberi')]), el('div', {}, [txt('€2,100')])]),
  );
  assert.deepEqual(lines, ['Boris Bidjian Saberi', '€2,100']);
  assert.equal(links.length, 0, 'no link is better than a made-up one');
});

test('style and script contents are not read as listings', () => {
  const { lines } = walkParsedHtml(
    el('div', {}, [
      el('style', {}, [txt('.grid{display:grid}')]),
      el('script', {}, [txt('window.__DATA__ = {"price": 999}')]),
      el('div', {}, [txt('Ann Demeulemeester')]),
    ]),
  );
  assert.deepEqual(lines, ['Ann Demeulemeester']);
});

test('the surrounding page does not leak a link onto the next card', () => {
  // Nav and breadcrumb links sit outside the grid. Their scope must close.
  const { lines, links } = walkParsedHtml(
    el('div', {}, [
      el('a', { href: 'https://example.invalid/nav' }, [el('div', {}, [txt('Menswear')])]),
      el('div', {}, [txt('Showing 24 results')]),
      card('https://example.invalid/p', 'https://cdn.invalid/p.jpg', 'Guidi', '$720.00'),
    ]),
  );
  assert.deepEqual(lines, ['Menswear', 'Showing 24 results', 'Guidi', '$720.00']);
  const byLine = Object.fromEntries(links.map(([i, url]) => [i, url]));
  assert.equal(byLine[0], 'https://example.invalid/nav');
  assert.equal(byLine[1], undefined, 'the line between the two belongs to neither');
  assert.equal(byLine[2], 'https://example.invalid/p');
});

// --- the shapes real grids are actually built in ----------------------------
//
// The first version of this walk only looked for an anchor ABOVE the text.
// That is one of at least three ways these cards are put together, and on the
// other two it found nothing, returned nothing, and the paste fell back to
// plain text with no links — silently, which is why it read as "still not
// fixed" rather than as an error.

test('an overlay link, sitting beside the text rather than around it', () => {
  // <a class="overlay"> stretched across the card, with no text of its own.
  const { lines, links } = walkParsedHtml(
    el('div', {}, [
      el('div', { class: 'card' }, [
        el('a', { href: 'https://example.invalid/products/1' }, []),
        el('img', { src: 'https://cdn.invalid/1.jpg' }),
        el('div', {}, [txt('Comme des Garçons Homme Plus')]),
        el('div', {}, [txt('AD2002 Wool Tailored Jacket')]),
        el('div', {}, [txt('$1,150.00')]),
      ]),
    ]),
  );
  assert.equal(lines.length, 3);
  assert.equal(links.length, 3, 'every line of the card must find the overlay link');
  for (const [, url, image] of links) {
    assert.equal(url, 'https://example.invalid/products/1');
    assert.equal(image, 'https://cdn.invalid/1.jpg');
  }
});

test('a link on the image only, with the text as its sibling', () => {
  const { links } = walkParsedHtml(
    el('div', {}, [
      el('div', { class: 'card' }, [
        el('a', { href: 'https://example.invalid/products/2' }, [
          el('img', { src: 'https://cdn.invalid/2.jpg' }),
        ]),
        el('div', {}, [txt('Guidi')]),
        el('div', {}, [txt('992 Horse Leather Derby')]),
        el('div', {}, [txt('$720.00')]),
      ]),
    ]),
  );
  assert.equal(links.length, 3);
  for (const [, url] of links) assert.equal(url, 'https://example.invalid/products/2');
});

test('two overlay cards side by side do not swap links', () => {
  const overlayCard = (href, img, ...rows) =>
    el('div', { class: 'card' }, [
      el('a', { href }, []),
      el('img', { src: img }),
      ...rows.map((r) => el('div', {}, [txt(r)])),
    ]);

  const { lines, links } = walkParsedHtml(
    el('div', { class: 'grid' }, [
      overlayCard('https://example.invalid/a', 'https://cdn.invalid/a.jpg', 'Guidi', '$720.00'),
      overlayCard('https://example.invalid/b', 'https://cdn.invalid/b.jpg', 'Guidi', '$980.00'),
    ]),
  );
  assert.deepEqual(lines, ['Guidi', '$720.00', 'Guidi', '$980.00']);
  assert.deepEqual(
    links.map(([, url]) => url),
    [
      'https://example.invalid/a', 'https://example.invalid/a',
      'https://example.invalid/b', 'https://example.invalid/b',
    ],
  );
});

test('one link on a long page does not get attached to everything', () => {
  // The risk the card rule takes on. A container with a single link stops
  // being a card once it holds more text than one could — otherwise a page
  // with one link anywhere in it would stamp that link on every row.
  const filler = Array.from({ length: 40 }, (_, i) =>
    el('div', {}, [txt(`Some paragraph of page text number ${i}, going on for a while.`)]));
  const { links } = walkParsedHtml(
    el('div', {}, [
      el('a', { href: 'https://example.invalid/about' }, [el('span', {}, [txt('About us')])]),
      ...filler,
    ]),
  );
  assert.equal(links.length, 1, 'only the anchor’s own text');
  assert.equal(links[0][0], 0);
});

test('the walk says why it found nothing, instead of failing silently', () => {
  const noLinks = walkParsedHtml(el('div', {}, [el('div', {}, [txt('Guidi')])]));
  assert.equal(noLinks.anchors, 0);
});

// --- what the paste handler is allowed to touch -----------------------------
//
// This textarea takes three shapes and only one of them is a copied page. The
// handler took over whenever the walk produced any lines, which is nearly
// always — so an alert email and a spreadsheet row were being re-laid out by
// DOM block rules instead of arriving as the browser's own plain text. Both
// were still documented as supported and neither was tested through this path.

import { shouldTakeOver } from '../src/lib/pastedHtml.mjs';
import { looksLikePastedPage } from '../src/lib/pastedPage.mjs';

const decide = (lines, links, nativeText) =>
  shouldTakeOver({ lines, links }, nativeText ?? lines.join('\n'), looksLikePastedPage);

test('a copied listing page is taken over', () => {
  const lines = ['Guidi', '992 Derby', '$720.00', 'Rick Owens', 'Jacket', '$430.00'];
  const links = [[0, 'https://shop.invalid/1', null], [3, 'https://shop.invalid/2', null]];
  assert.equal(decide(lines, links).takeOver, true);
});

test('an alert email keeps the browser’s own plain text', () => {
  // Its URLs are in the text, where the record parser reads them — and that
  // parser is better at an email than a DOM walk is.
  const lines = [
    'New match: Comme des Garcons Homme Plus wool jacket',
    '$850',
    'https://www.grailed.com/listings/111-cdg-hp',
    'New match: Guidi 992 derby',
    '$700',
    'https://www.grailed.com/listings/222-guidi',
  ];
  const links = [[0, 'https://www.grailed.com/listings/111-cdg-hp', null]];
  const decision = decide(lines, links);
  assert.equal(decision.takeOver, false);
  assert.match(decision.why, /email|listings/);
});

test('a spreadsheet row keeps its tabs, which are its structure', () => {
  const native = 'brand\ttitle\tprice\tcurrency\nCDG\twool jacket\t850\tEUR';
  // A copied table flattens to something that has lost the tabs entirely.
  const lines = ['brand title price currency', 'CDG wool jacket 850 EUR'];
  const decision = decide(lines, [[0, 'https://shop.invalid/x', null]], native);
  assert.equal(decision.takeOver, false);
});

test('a page with links but no prices is not a page of listings', () => {
  const lines = ['About us', 'Contact', 'Shipping and returns'];
  assert.equal(decide(lines, [[0, 'https://shop.invalid/about', null]]).takeOver, false);
});

test('a paste with no links is left alone, whatever it is', () => {
  const lines = ['Guidi', '992 Derby', '$720.00'];
  const decision = decide(lines, []);
  assert.equal(decision.takeOver, false);
  assert.match(decision.why, /plain-text paste is unchanged/);
});

test('markup read off a page resolves its relative links against the page', () => {
  // The bookmarklet's case. A clipboard absolutises on the way out; markup read
  // straight from the DOM does not, so every href in it is relative exactly as
  // the author wrote it — and without a base every one of them is dropped,
  // which is the whole point of the capture gone.
  const tree = el('div', {}, [
    el('a', { href: '/products/88213-cdg' }, [
      el('img', { src: '/i/88213.jpg' }),
      el('div', {}, [txt('Comme des Garçons')]),
      el('div', {}, [txt('$1,150.00')]),
    ]),
  ]);

  const withoutBase = walkParsedHtml(tree);
  assert.equal(withoutBase.links.length, 0, 'no base means no guess');

  const withBase = walkParsedHtml(tree, { base: 'https://www.therealreal.com/shop/men?q=cdg' });
  assert.equal(withBase.links[0][1], 'https://www.therealreal.com/products/88213-cdg');
  assert.equal(withBase.links[0][2], 'https://www.therealreal.com/i/88213.jpg');
});

test('a base cannot turn a javascript: or mailto: href into a link', () => {
  const tree = el('div', {}, [
    el('a', { href: 'javascript:void(0)' }, [el('div', {}, [txt('Quick view')])]),
    el('a', { href: 'mailto:seller@example.invalid' }, [el('div', {}, [txt('Contact')])]),
  ]);
  assert.equal(walkParsedHtml(tree, { base: 'https://shop.invalid/x' }).links.length, 0);
});
