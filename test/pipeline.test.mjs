import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prefillFromUrl } from '../src/lib/urlPrefill.mjs';
import { parseBulk, parseMoney } from '../src/lib/bulkPaste.mjs';
import { freshnessWeight, freshnessState, FLOOR_WEIGHT } from '../src/lib/confidence.mjs';

test('Grailed URL yields source, id and title slug', () => {
  const r = prefillFromUrl('https://www.grailed.com/listings/12345678-comme-des-garcons-homme-plus-wool-jacket');
  assert.equal(r.sourceId, 'grailed');
  assert.equal(r.fields.sourceItemId, '12345678');
  assert.match(r.fields.titleRaw, /homme plus/);
});

test('Vestiaire URL yields id, brand and category', () => {
  const r = prefillFromUrl('https://www.vestiairecollective.com/women-clothing/jackets/comme-des-garcons/black-wool-jacket-12345678.shtml');
  assert.equal(r.sourceId, 'vestiaire');
  assert.equal(r.fields.sourceItemId, '12345678');
  assert.match(r.fields.brandRaw, /comme des garcons/);
});

test('The RealReal URL yields id and category path', () => {
  const r = prefillFromUrl('https://www.therealreal.com/products/women/clothing/jackets/cdg-wool-jacket-abc123');
  assert.equal(r.sourceId, 'therealreal');
  assert.match(r.fields.category, /clothing/);
});

test('tracking query strings are stripped so one listing has one URL', () => {
  const r = prefillFromUrl('https://www.grailed.com/listings/999-test?utm_source=email&ref=abc');
  assert.equal(r.url, 'https://www.grailed.com/listings/999-test');
});

test('price and currency are never invented from a URL', () => {
  const r = prefillFromUrl('https://www.grailed.com/listings/12345678-cdg-jacket');
  assert.equal(r.fields.price, undefined);
  assert.equal(r.fields.currency, undefined);
  assert.ok(r.unresolved.includes('price'));
  assert.ok(r.unresolved.includes('currency'));
});

test('an unknown host still returns a usable manual draft', () => {
  const r = prefillFromUrl('https://some-archive-shop.example/product/cdg-coat');
  assert.equal(r.ok, true);
  assert.equal(r.sourceId, 'manual_other');
});

test('invalid input is rejected rather than half-parsed', () => {
  assert.equal(prefillFromUrl('not a url').ok, false);
});

test('money parses Anglo and European conventions to the same amount', () => {
  assert.equal(parseMoney('$1,234.56').amount, 1234.56);
  assert.equal(parseMoney('1.234,56 EUR').amount, 1234.56);
  assert.equal(parseMoney('€295,00').amount, 295);
});

test('yen amounts parse as whole numbers', () => {
  const r = parseMoney('¥48,000');
  assert.equal(r.amount, 48000);
  assert.equal(r.currency, 'JPY');
  assert.equal(r.ambiguous, false);
});

test('an explicit currency code beats a bare symbol', () => {
  assert.equal(parseMoney('1000 JPY').currency, 'JPY');
});

test('bulk paste of alert-email blocks produces one draft per block', () => {
  const paste = `Comme des Garcons Homme Plus wool jacket AD2002
¥48,000
https://www.grailed.com/listings/111-cdg-hp-jacket

Junya Watanabe MAN denim
€320.00
https://www.grailed.com/listings/222-junya-denim`;
  const { drafts } = parseBulk(paste);
  assert.equal(drafts.length, 2);
  assert.equal(drafts[0].price, 48000);
  assert.equal(drafts[0].currency, 'JPY');
  assert.equal(drafts[0].sublineId, 'cdg-homme-plus');
  assert.equal(drafts[0].adYear, 2002);
  assert.equal(drafts[1].sublineId, 'junya-watanabe-man');
  assert.equal(drafts[1].price, 320);
});

test('a listing id in the URL is not mistaken for a price', () => {
  const { drafts } = parseBulk('CDG Shirt\nhttps://www.grailed.com/listings/98765432-cdg-shirt');
  assert.equal(drafts[0].price, null);
});

test('bulk paste warns instead of guessing a missing currency', () => {
  const { drafts } = parseBulk('Comme des Garcons Shirt striped\n4500');
  assert.ok(drafts[0].warnings.some((w) => /currency/i.test(w)) || drafts[0].price === null);
});

test('ambiguous CDG rows are flagged for manual resolution', () => {
  const { drafts } = parseBulk('CDG cargo trousers\n¥12000\nhttps://www.grailed.com/listings/333-cdg');
  assert.equal(drafts[0].needsManualResolution, true);
});

test('delimited paste with a header is parsed by column', () => {
  const paste = 'title\tprice\tcurrency\tsize\nComme des Garcons Homme Deux blazer\t250\tEUR\tM';
  const { drafts } = parseBulk(paste);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].price, 250);
  assert.equal(drafts[0].currency, 'EUR');
  assert.equal(drafts[0].sizeRaw, 'M');
  assert.equal(drafts[0].sublineId, 'cdg-homme-deux');
});

test('freshness is full weight inside the verify window', () => {
  const now = new Date('2026-09-04T00:00:00Z');
  assert.equal(freshnessWeight(new Date('2026-09-01T00:00:00Z'), now), 1);
  assert.equal(freshnessState(new Date('2026-09-01T00:00:00Z'), now), 'fresh');
});

test('freshness decays between the verify and stale thresholds', () => {
  const now = new Date('2026-09-04T00:00:00Z');
  const w = freshnessWeight(new Date('2026-08-14T00:00:00Z'), now); // ~21d
  assert.ok(w < 1 && w > FLOOR_WEIGHT, `expected decay, got ${w}`);
  assert.equal(freshnessState(new Date('2026-08-14T00:00:00Z'), now), 'due');
});

test('a never-verified entry sits at the floor, not at full confidence', () => {
  assert.equal(freshnessWeight(null), FLOOR_WEIGHT);
  assert.equal(freshnessState(null), 'stale');
});

// --- the venue comes from what you have configured ---------------------------

const CONFIGURED = [
  { id: 'grailed', base_url: 'https://www.grailed.com' },
  { id: 'therealreal', base_url: 'https://www.therealreal.com' },
  { id: 'archive_kyoto', base_url: 'https://archive-kyoto.example' },
  { id: 'broken', base_url: 'not a url at all' },
];

test('a shop you configured is recognised without a line of code here', () => {
  // The point of reading the venue from the database: `add-source` and
  // `discover` configure dozens of shops, and every one of them used to paste
  // in as "Other (manual)" — which files it as somewhere you buy and, if it is
  // actually an exit venue, quietly disqualifies it as a comp forever.
  const r = prefillFromUrl('https://archive-kyoto.example/item/cdg-ad2002-jacket', CONFIGURED);
  assert.equal(r.sourceId, 'archive_kyoto');
  assert.equal(r.ok, true);
  assert.match(r.note, /no id pattern known/);
});

test('a subdomain belongs to its shop, and a lookalike does not', () => {
  assert.equal(
    prefillFromUrl('https://shop.archive-kyoto.example/item/1', CONFIGURED).sourceId,
    'archive_kyoto',
  );
  // The mistake a plain "ends with" test makes, and it files rows under a
  // venue that has nothing to do with them.
  assert.equal(
    prefillFromUrl('https://notarchive-kyoto.example/item/1', CONFIGURED).sourceId,
    'manual_other',
  );
});

test('a base_url nobody can parse is skipped, not thrown on', () => {
  assert.equal(prefillFromUrl('https://elsewhere.example/x', CONFIGURED).sourceId, 'manual_other');
});

test('with no sources passed, the built-in hosts still answer', () => {
  // Every existing caller kept working while this was threaded through, and
  // the single-URL form still resolves the three big venues on its own.
  assert.equal(prefillFromUrl('https://www.grailed.com/listings/1-x').sourceId, 'grailed');
});

test('a listing id in the query survives; tracking noise does not', () => {
  // Stripping the whole query string collapsed every product on shops that key
  // by parameter onto one URL — one listing, endlessly superseding itself.
  const r = prefillFromUrl(
    'https://archive-kyoto.example/product?id=8821&variant=2&utm_source=mail&fbclid=xyz&ref=news',
    CONFIGURED,
  );
  assert.equal(r.url, 'https://archive-kyoto.example/product?id=8821&variant=2');
});

test('a URL shape that changed costs its fields, never its venue', () => {
  // The per-site path patterns are matched against shapes nobody promised us.
  // When one stops matching, what must NOT happen is the row moving venue or
  // losing the link.
  const r = prefillFromUrl('https://www.grailed.com/p/2026/12345678-cdg-jacket', CONFIGURED);
  assert.equal(r.sourceId, 'grailed');
  assert.equal(r.url, 'https://www.grailed.com/p/2026/12345678-cdg-jacket');
  assert.equal(r.fields.sourceItemId, undefined, 'the id is lost, and that is the whole cost');
});
