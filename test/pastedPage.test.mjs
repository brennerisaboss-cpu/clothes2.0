import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePastedPage, splitAtPrices, fieldsFromBlock, looksLikePastedPage, linesWithLinks,
} from '../src/lib/pastedPage.mjs';

// What a copied search-results page actually looks like: a flat run of lines
// with the structure gone, ordered differently by every site, and no links.

const TRR = `
Comme des Garçons Homme Plus
Wool Blend Blazer
$1,150.00
$2,300.00
Size: M
Yohji Yamamoto Pour Homme
Wool Gabardine Long Coat
$1,490.00
Size: 3
Guidi
Horse Leather Derby
$720.00
$980.00
Size: 42
`;

const GRAILED = `
Comme des Garcons Homme Plus
AD2002 Wool Tailored Jacket
$850
46
Rick Owens
DRKSHDW Cotton Jacket
$430
M
Carol Christian Poell
Scarstitch Leather Jacket
$2,400
48
`;

const VESTIAIRE = `
Comme des Garçons
Wool jacket
€980.00
€1,400.00
M
Ann Demeulemeester
Wool coat
€1,250.00
S
Boris Bidjian Saberi
Leather jacket
€2,100.00
48
`;

test('a copied RealReal page yields one record per piece', () => {
  const { blocks } = parsePastedPage(TRR);
  assert.equal(blocks.length, 3);
  assert.match(blocks[0].title, /Comme des Garçons Homme Plus/);
  assert.match(blocks[0].title, /Wool Blend Blazer/);
  assert.equal(blocks[0].size, 'M');
});

test('a struck-through original price does not become a phantom listing', () => {
  // Every resale site shows the old price beside a reduced one. Cutting a new
  // record at it would invent a listing with a price and no title — and it
  // would look plausible in a table.
  const { blocks } = parsePastedPage(TRR);
  assert.equal(blocks.length, 3, 'three pieces, not five');
  assert.match(blocks[0].price, /1,150/);
  assert.match(blocks[0].wasPrice, /2,300/);
});

test('the price kept is the one you would pay', () => {
  const { blocks } = parsePastedPage(TRR);
  const derby = blocks[2];
  assert.match(derby.price, /720/, 'the current price, not the original');
  assert.match(derby.wasPrice, /980/);
});

test('a Grailed page parses, with sizes that are bare numbers', () => {
  const { blocks } = parsePastedPage(GRAILED);
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].size, '46');
  assert.match(blocks[0].title, /AD2002/);
  assert.ok(!/46/.test(blocks[0].title), 'the size must not end up in the title');
});

test('a Vestiaire page parses, in euros', () => {
  const { blocks } = parsePastedPage(VESTIAIRE);
  assert.equal(blocks.length, 3);
  assert.match(blocks[0].price, /980/);
  assert.equal(blocks[1].size, 'S');
});

test('page furniture is dropped, not read as a listing', () => {
  const withChrome = `
Sort
Showing 24 results
Comme des Garcons Homme Plus
Wool Jacket
$850
Size M
Add to Bag
Sold
Yohji Yamamoto
Wool Coat
$1,200
Size 3
Load more
`;
  const { blocks } = parsePastedPage(withChrome);
  assert.equal(blocks.length, 2);
  assert.ok(!blocks.some((b) => /Add to Bag|Showing/i.test(b.title)));
});

test('an alert email is left to the parser that handles it better', () => {
  // Anything with links is the existing bulk-paste shape; claiming it here
  // would throw away the URLs, which are the most reliable field it has.
  assert.equal(looksLikePastedPage('CDG jacket $850 https://example.invalid/x'), false);
  assert.equal(looksLikePastedPage('brand\ttitle\tprice'), false);
});

test('a page with too few prices is not claimed either', () => {
  assert.equal(looksLikePastedPage('just some notes\nand a thought'), false);
  assert.equal(looksLikePastedPage(GRAILED), true);
});

test('a block with no title is dropped rather than half-guessed', () => {
  const fields = fieldsFromBlock(['$850']);
  assert.equal(fields.title, null);
  const { blocks } = parsePastedPage('$100\n$200\n$300\n');
  assert.equal(blocks.length, 0);
});

test('splitting is stable on an odd number of trailing lines', () => {
  const blocks = splitAtPrices('Brand\nTitle\n$100\nleftover footer text');
  assert.equal(blocks.length, 1, 'trailing unpriced lines are not a listing');
});

// --- what a real copied page carries besides the essentials -----------------

test('condition is pulled out, not left in the title', () => {
  // It decides which comps a piece may be valued against, so losing it into
  // the title costs a tier rather than a word.
  const { blocks } = parsePastedPage(
    ['Comme des Garçons Homme Plus', 'AD2002 Wool Tailored Jacket', 'Excellent condition',
     '$1,150.00', 'Size M',
     'Yohji Yamamoto', 'Pour Homme Wool Coat', 'Pre-owned', '$1,490.00', 'Size 3'].join('\n'),
  );
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].condition, 'Excellent condition');
  assert.equal(blocks[1].condition, 'Pre-owned');
  assert.ok(!/condition|Pre-owned/i.test(blocks[0].title), 'the title stays a title');
});

test('shipping and seller chrome does not leak into the next listing', () => {
  const { blocks } = parsePastedPage(
    ['Guidi', '992 Leather Boot', '$780.00', 'Size 42', 'Ships from Italy', 'Verified',
     'Rick Owens', 'DRKSHDW Jacket', '$430.00', 'Size M', 'Free shipping'].join('\n'),
  );
  assert.equal(blocks.length, 2);
  assert.ok(!/Ships|Verified/i.test(blocks[1].title), `leaked: ${blocks[1].title}`);
  assert.equal(blocks[1].title, 'Rick Owens DRKSHDW Jacket');
});

test('a condition printed after the price belongs to the piece above it', () => {
  const { blocks } = parsePastedPage(
    ['Guidi', 'Leather Boot', '$780.00', 'Excellent',
     'Rick Owens', 'Jacket', '$430.00', 'Good'].join('\n'),
  );
  assert.equal(blocks[0].condition, 'Excellent');
  assert.equal(blocks[1].condition, 'Good');
});

// --- the link back to the listing -------------------------------------------

test('a link survives the trip from the clipboard to the draft', () => {
  // The lines are what the textarea holds; the links are indexed against them,
  // which is what lets a row keep its own listing rather than a neighbour's.
  const text = [
    'Comme des Garçons Homme Plus', 'Wool Blend Blazer', '$1,150.00', 'Size: M',
    'Guidi', 'Horse Leather Derby', '$720.00', 'Size: 42',
  ].join('\n');
  const links = [
    [0, 'https://www.therealreal.com/products/1-cdg', 'https://cdn.invalid/1.jpg'],
    [1, 'https://www.therealreal.com/products/1-cdg', 'https://cdn.invalid/1.jpg'],
    [2, 'https://www.therealreal.com/products/1-cdg', 'https://cdn.invalid/1.jpg'],
    [4, 'https://www.therealreal.com/products/2-guidi', 'https://cdn.invalid/2.jpg'],
    [5, 'https://www.therealreal.com/products/2-guidi', 'https://cdn.invalid/2.jpg'],
    [6, 'https://www.therealreal.com/products/2-guidi', 'https://cdn.invalid/2.jpg'],
  ];

  const { blocks } = parsePastedPage(linesWithLinks(text, links));
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].url, 'https://www.therealreal.com/products/1-cdg');
  assert.equal(blocks[0].image, 'https://cdn.invalid/1.jpg');
  assert.equal(blocks[1].url, 'https://www.therealreal.com/products/2-guidi');
});

test('a plain-text paste still parses, with nothing invented for the link', () => {
  const { blocks, note } = parsePastedPage(TRR);
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].url, null);
  assert.equal(blocks[0].image, null);
  // And it says so, rather than leaving you to notice later that none of the
  // rows can be opened.
  assert.match(note, /without a link back to the listing/);
});

test('the piece wins over the designer index it sits under', () => {
  // Cards often link the brand name to the brand's page and the name to the
  // product. Taking the first link in document order would file every row
  // under a designer index instead of the piece — so on a tie the link nearest
  // the price wins, the price being what closes a card.
  const lines = [
    { text: 'Guidi', url: 'https://example.invalid/designers/guidi', image: null },
    { text: 'Horse Leather Derby', url: 'https://example.invalid/products/992', image: null },
    { text: '$720.00', url: null, image: null },
  ];
  const [block] = parsePastedPage(lines).blocks;
  assert.equal(block.url, 'https://example.invalid/products/992');
  // Both lines are still the garment's name: they disagree about the link, but
  // neither is page furniture, so nothing is trimmed.
  assert.equal(block.title, 'Guidi Horse Leather Derby');
});

test('a nav link swept in by the cut does not become the row', () => {
  // The first card on a copied page always inherits whatever preceded the
  // grid, because blocks are cut at prices and the page has no price before
  // its first listing. The card's own anchor covers four lines; the nav item
  // covers one — and that is the tell.
  const lines = [
    { text: 'Menswear', url: 'https://example.invalid/menswear', image: null },
    { text: 'Comme des Garcons Homme Plus', url: 'https://example.invalid/products/1', image: 'https://cdn.invalid/1.jpg' },
    { text: 'AD2002 Wool Tailored Jacket', url: 'https://example.invalid/products/1', image: 'https://cdn.invalid/1.jpg' },
    { text: '$1,150.00', url: 'https://example.invalid/products/1', image: 'https://cdn.invalid/1.jpg' },
    { text: 'Size: M', url: 'https://example.invalid/products/1', image: 'https://cdn.invalid/1.jpg' },
  ];
  const [block] = parsePastedPage(lines).blocks;
  assert.equal(block.url, 'https://example.invalid/products/1');
  assert.equal(block.title, 'Comme des Garcons Homme Plus AD2002 Wool Tailored Jacket');
  assert.equal(block.size, 'M');
});

test('a size line does not donate its link to the block', () => {
  // Belt and braces on the ordering: descriptive lines are asked first, so a
  // "Size 42" chip that happens to be a filter link cannot become the row's
  // listing URL.
  const lines = [
    { text: 'Guidi', url: null, image: null },
    { text: 'Horse Leather Derby', url: 'https://example.invalid/products/992', image: null },
    { text: '$720.00', url: null, image: null },
    { text: 'Size: 42', url: 'https://example.invalid/search?size=42', image: null },
  ];
  const [block] = parsePastedPage(lines).blocks;
  assert.equal(block.url, 'https://example.invalid/products/992');
  assert.equal(block.size, '42');
});

test('a link index pointing nowhere is ignored rather than throwing', () => {
  const lines = linesWithLinks('Guidi\nBoot\n$720.00', [
    [99, 'https://example.invalid/x', null],
    [-1, 'https://example.invalid/y', null],
    [1, 'https://example.invalid/992', null],
  ]);
  const [block] = parsePastedPage(lines).blocks;
  assert.equal(block.url, 'https://example.invalid/992');
});

test('a page with two listings on it is still a page', () => {
  // A narrow search returns one or two results, and the three-price rule sent
  // those to the record splitter — a draft per LINE, no prices, no links. The
  // links are proof a browser copied a page, so the count stops mattering.
  const twoItems = 'Guidi\n992 Derby\n¥98,000\nCarol Christian Poell\nJacket\n¥480,000';
  assert.equal(looksLikePastedPage(twoItems), false, 'no links: the old rule stands');
  assert.equal(looksLikePastedPage(twoItems, [[0, 'https://shop.invalid/1', null]]), true);
});

test('links do not turn an alert email into a page', () => {
  // An email's URLs are in its text, where the record parser can see them —
  // and it uses them better than this would.
  const email = 'CDG jacket $850\nhttps://shop.invalid/x\nGuidi boot $700\nhttps://shop.invalid/y';
  assert.equal(looksLikePastedPage(email, [[0, 'https://shop.invalid/x', null]]), false);
});

test('a line that is only a URL is a link, never part of the name', () => {
  // Some alert emails print the address under the piece. Joined into the title
  // it reaches brand resolution as "Guidi 992 derby https://www.grailed.com/…"
  // and matches nothing — the address swamps the words that identify it.
  const lines = [
    { text: 'Guidi', url: null, image: null },
    { text: '992 horse leather derby', url: null, image: null },
    { text: '$700', url: null, image: null },
    { text: 'https://www.grailed.com/listings/222-guidi-992', url: null, image: null },
  ];
  const [block] = parsePastedPage(lines).blocks;
  assert.equal(block.title, 'Guidi 992 horse leather derby');
  // And it is not thrown away: with no anchor in the markup, it is the link.
  assert.equal(block.url, 'https://www.grailed.com/listings/222-guidi-992');
});

test('an anchor still beats a printed address when both are there', () => {
  const lines = [
    { text: 'Guidi', url: 'https://www.grailed.com/listings/222-guidi-992', image: null },
    { text: '992 derby', url: 'https://www.grailed.com/listings/222-guidi-992', image: null },
    { text: '$700', url: 'https://www.grailed.com/listings/222-guidi-992', image: null },
    { text: 'https://www.grailed.com/click?redirect=222', url: null, image: null },
  ];
  const [block] = parsePastedPage(lines).blocks;
  assert.equal(block.url, 'https://www.grailed.com/listings/222-guidi-992');
  assert.equal(block.title, 'Guidi 992 derby');
});

// --- the page around the listings -------------------------------------------
//
// Everything below this line was written from real text the operator copied,
// not from a guess at the shape. Selecting a search-results page selects the
// whole page: the nav, the SEO block of related searches, the entire filter
// rail with its facet counts, the sort control. Those lines sit above the
// first price, so the record-cutting rule handed all of them to the first
// listing as its name — a 400-character title that resolved to no brand,
// matched no item, and pooled with nothing.

const GRAILED_PREAMBLE = `
SELL
VINTAGE
SNEAKERS
STAFF PICKS
COLLECTIONS
EDITORIAL
Ann Demeulemeester
Related Searches
Ann Demulemeester
Ann Demeulemeester Boots
Ann Demeulemeester Shirt
7,099 listings
Sort:
Category
Tops312
Bottoms188
Outerwear1k+
Footwear279
Accessories94
Size
XXS/4046
S/44-46243
M/48243
26/2/3883
Condition
New/Never Worn1k+
Gently Used2k+
Used1k+
Staff Pick4
Hype1
Ann Demeulemeester
Wool blazer with silver hardware
$450
3 days ago
Ann Demeulemeester
Leather biker jacket
$1,200
about 17 hours ago
Ann Demeulemeester
Distressed wool coat
$780
a day ago
`;

test('the page around the listings is not part of the first listing', () => {
  const { blocks } = parsePastedPage(linesWithLinks(GRAILED_PREAMBLE, []));
  assert.deepEqual(
    blocks.map((b) => b.title),
    [
      'Ann Demeulemeester Wool blazer with silver hardware',
      'Ann Demeulemeester Leather biker jacket',
      'Ann Demeulemeester Distressed wool coat',
    ],
  );
  // The specific regression: no fragment of the nav, the SEO block or the
  // filter rail may survive anywhere in a name.
  for (const b of blocks) {
    for (const noise of ['SELL', 'STAFF PICKS', 'Related Searches', 'listings', 'Sort', 'Condition']) {
      assert.ok(!b.title.includes(noise), `"${noise}" leaked into "${b.title}"`);
    }
    assert.ok(!/\bago\b/.test(b.title), `a timestamp leaked into "${b.title}"`);
  }
});

test('a facet count glued to its word is what marks a filter line', () => {
  // The whole tell, and the reason this is not a keyword list: a real title
  // puts a space before a number ("Guidi 992", "M.A+ B7"), a facet does not
  // ("Boots279", "New/Never Worn1k+"). Three earlier versions of this rule
  // used keywords instead and either ate prices and sizes — parsing zero
  // listings — or leaked "Staff Pick4" and "Shirts (Button Ups)312".
  const withCounts = [
    'Tops312', 'Outerwear1k+', 'Staff Pick4', 'Hype1', 'New/Never Worn1k+',
    'Shirts (Button Ups)312', 'XXS/4046', 'S/44-46243', '26/2/3883',
  ];
  for (const line of withCounts) {
    const { blocks } = parsePastedPage(linesWithLinks(
      `${line}\nAnn Demeulemeester\nWool blazer\n$450\n`, [],
    ));
    assert.equal(blocks.length, 1, line);
    assert.equal(blocks[0].title, 'Ann Demeulemeester Wool blazer', `"${line}" survived`);
  }
});

test('a real name that happens to contain digits is not a filter line', () => {
  // The cost of getting the rule above wrong in the other direction: these are
  // the pieces the operator actually buys.
  const keep = [
    ['Guidi', '992 horse leather derby'],
    ['M.A+', 'B7 leather bag'],
    ['Comme des Garçons', 'Wool jacket'],
    ['Yohji Yamamoto Pour Homme', 'SS97 wool gabardine coat'],
  ];
  for (const [brand, rest] of keep) {
    const { blocks } = parsePastedPage(linesWithLinks(`${brand}\n${rest}\n$700\n`, []));
    assert.equal(blocks[0].title, `${brand} ${rest}`);
  }
});

test('a title is read back only as far as the line that names the house', () => {
  // Without this the cut is "everything since the last price", which on a
  // results page is the whole preamble. With it, a title is at most a handful
  // of lines ending at a designer name — which is how these pages are laid
  // out, brand first.
  const lines = linesWithLinks(
    ['Trending now', 'Recently viewed', 'Sponsored',
     'Rick Owens', 'DRKSHDW Jacket', '$900'].join('\n'), [],
  );
  const [block] = parsePastedPage(lines).blocks;
  assert.equal(block.title, 'Rick Owens DRKSHDW Jacket');
});

// Vestiaire brings a different page with it: a bracketed filter rail, a size
// line with its region on it, and — the one that costs money — the original
// price printed BEFORE the reduction rather than after.

const VESTIAIRE_PAGE = `
Women
Men
Sell now
Ann Demeulemeester
Ann Demeulemeester Women
2,341 items
Sort by
Relevance
Category
Clothing (1,204)
Shoes (412)
Condition
Never worn (52)
Very good condition (890)
Price
Under €100
Material
Leather (233)
Ann Demeulemeester
Leather biker jacket
Size 38 FR
€1,240
-20%
€992
Ann Demeulemeester
Wool blazer
Size 40 FR
€450
`;

test('a bracketed filter rail is a filter rail too', () => {
  const { blocks } = parsePastedPage(linesWithLinks(VESTIAIRE_PAGE, []));
  assert.deepEqual(
    blocks.map((b) => b.title),
    ['Ann Demeulemeester Leather biker jacket', 'Ann Demeulemeester Wool blazer'],
  );
});

test('a price bound in the rail does not open a listing', () => {
  // "Under €100" is the one thing on a filter rail that looks like money, and
  // records are cut at money — so it opened a phantom listing whose name was
  // the rest of the rail. That row is what arrived as "general page details".
  for (const bound of ['Under €100', '€100 - €500', '€1,000+', 'Over $500', 'up to ¥50,000']) {
    const { blocks } = parsePastedPage(linesWithLinks(
      `Price\n${bound}\nAnn Demeulemeester\nWool blazer\n€450\n`, [],
    ));
    assert.equal(blocks.length, 1, bound);
    assert.equal(blocks[0].price, '€450', bound);
  }
});

test('a size keeps its region and stays out of the name', () => {
  // Vestiaire prints "Size 38 FR". Read as part of the title, every piece
  // carried its own size in its name — so one garment in two sizes was two
  // items, pooling with nothing. The same failure the discount badge caused.
  const { blocks } = parsePastedPage(linesWithLinks(VESTIAIRE_PAGE, []));
  assert.equal(blocks[0].size, '38 FR');
  assert.equal(blocks[1].size, '40 FR');
  for (const b of blocks) assert.ok(!/size/i.test(b.title), b.title);
});

test('of two prices on a card, the asking price is the lower one', () => {
  // Not the first one. The RealReal prints current then original, Vestiaire
  // prints original, badge, reduced — so reading the order cost the discount
  // on every reduced Vestiaire piece, silently.
  const { blocks } = parsePastedPage(linesWithLinks(VESTIAIRE_PAGE, []));
  assert.equal(blocks[0].price, '€992');
  assert.equal(blocks[0].wasPrice, '€1,240');
  assert.equal(blocks[0].discount, '-20%');

  // And the other order gives the same answer, which is the point.
  const [trr] = parsePastedPage(linesWithLinks(
    'Comme des Garçons Homme Plus\nWool Blend Blazer\n$1,150.00\n$2,300.00\n', [],
  )).blocks;
  assert.equal(trr.price, '$1,150.00');
  assert.equal(trr.wasPrice, '$2,300.00');
});

test('two prices in different currencies are left in the order they were printed', () => {
  // Comparing them would be comparing numbers, not amounts.
  const [block] = parsePastedPage(linesWithLinks(
    'Guidi\n992 derby\n€700\n$900\n', [],
  )).blocks;
  assert.equal(block.price, '€700');
  assert.equal(block.wasPrice, '$900');
});

test('a bracketed number that is a year is not a facet count', () => {
  const [block] = parsePastedPage(linesWithLinks('Guidi\n992 derby (2019)\n$700\n', [])).blocks;
  assert.equal(block.title, 'Guidi 992 derby (2019)');
});
