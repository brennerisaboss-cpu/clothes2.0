import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import {
  fetchListings, parsePrice, splitItems, decodeEntities,
} from '../src/lib/adapters/merchantFeed.mjs';

const serve = (body, status = 200) => async () => new Response(body, { status });

// A Google Merchant / RSS feed, the shape Rakuten Advertising, Impact, CJ and
// Awin all publish — and therefore how The RealReal's catalogue arrives.
const XML = `<?xml version="1.0"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel>
 <item>
  <g:id>TRR-88213</g:id>
  <g:title>Comme des Garcons Homme Plus AD2002 wool tailored jacket</g:title>
  <g:brand>Comme des Garcons</g:brand>
  <g:price>1250.00 EUR</g:price>
  <g:condition>used</g:condition>
  <g:size>M</g:size>
  <g:link>https://example.invalid/p/88213</g:link>
  <g:image_link>https://example.invalid/i/88213.jpg</g:image_link>
  <g:availability>in stock</g:availability>
 </item>
 <item>
  <g:id>TRR-88214</g:id>
  <g:title><![CDATA[Yohji Yamamoto Pour Homme wool coat & scarf]]></g:title>
  <g:brand>Yohji Yamamoto</g:brand>
  <g:price>890.50 EUR</g:price>
  <g:sale_price>720.00 EUR</g:sale_price>
  <g:availability>out of stock</g:availability>
 </item>
</channel></rss>`;

test('reads a Google Merchant feed, which is how affiliate networks publish', async () => {
  const res = await fetchListings({ url: 'https://feed.invalid/f.xml' }, { fetchImpl: serve(XML) });
  assert.equal(res.ok, true);
  assert.equal(res.listings.length, 2);

  const jacket = res.listings[0];
  assert.equal(jacket.sourceItemId, 'TRR-88213');
  assert.equal(jacket.price, 1250);
  assert.equal(jacket.currency, 'EUR');
  assert.equal(jacket.brandRaw, 'Comme des Garcons');
  assert.equal(jacket.conditionRaw, 'used');
  assert.equal(jacket.available, true);
});

test('a sale price wins over the list price, since it is what you would pay', async () => {
  const res = await fetchListings({ url: 'https://feed.invalid/f.xml' }, { fetchImpl: serve(XML) });
  assert.equal(res.listings[1].price, 720);
});

test('CDATA and entities survive, so a title stays matchable', async () => {
  const res = await fetchListings({ url: 'https://feed.invalid/f.xml' }, { fetchImpl: serve(XML) });
  assert.equal(res.listings[1].title, 'Yohji Yamamoto Pour Homme wool coat & scarf');
});

test('out of stock is reported as unavailable, never as sold', async () => {
  const res = await fetchListings({ url: 'https://feed.invalid/f.xml' }, { fetchImpl: serve(XML) });
  // A withdrawn, reserved and sold piece are indistinguishable in a feed.
  assert.equal(res.listings[1].available, false);
  assert.ok(!('status' in res.listings[1]), 'an adapter must never conclude a status');
});

const CSV = [
  'id,title,brand,price,link,condition,availability',
  'A1,"Guidi 788Z horse leather derby, black",Guidi,"640,00 EUR",https://example.invalid/a1,used,in stock',
  'A2,"Carol Christian Poell ""Scarstitch"" jacket",Carol Christian Poell,1890.00 EUR,https://example.invalid/a2,used,in stock',
  'A3,Broken row with too few cells',
].join('\n');

test('reads a delimited feed, including quoted commas and escaped quotes', async () => {
  const res = await fetchListings({ url: 'https://feed.invalid/f.csv' }, { fetchImpl: serve(CSV) });
  assert.equal(res.ok, true);
  assert.equal(res.listings.length, 2, 'the malformed row must be dropped, not misaligned');
  assert.equal(res.listings[0].title, 'Guidi 788Z horse leather derby, black');
  assert.equal(res.listings[0].price, 640);
  assert.equal(res.listings[1].title, 'Carol Christian Poell "Scarstitch" jacket');
});

test('European and Anglo decimals are told apart, not guessed', () => {
  // Getting this wrong moves a price by three orders of magnitude.
  assert.equal(parsePrice('1.234,56 EUR').amount, 1234.56);
  assert.equal(parsePrice('1,234.56 USD').amount, 1234.56);
  assert.equal(parsePrice('640,00').amount, 640);
  assert.equal(parsePrice('1,250').amount, 1250);     // thousands, not 1.25
  assert.equal(parsePrice('128000').amount, 128000);
  assert.equal(parsePrice('JPY 128000').currency, 'JPY');
});

test('the currency in the feed beats the configured one', async () => {
  const res = await fetchListings(
    { url: 'https://feed.invalid/f.xml', currency: 'USD' },
    { fetchImpl: serve(XML) },
  );
  assert.equal(res.listings[0].currency, 'EUR');
});

test('a feed whose columns do not map says so instead of returning nothing', async () => {
  const res = await fetchListings(
    { url: 'https://feed.invalid/f.csv' },
    { fetchImpl: serve('foo,bar\n1,2') },
  );
  assert.equal(res.ok, false);
  assert.match(res.error, /column mapping/);
});

test('an HTTP error changes nothing', async () => {
  const res = await fetchListings({ url: 'https://feed.invalid/f.csv' }, { fetchImpl: serve('nope', 503) });
  assert.equal(res.ok, false);
  assert.equal(res.complete, false);
});

test('a whole-catalogue feed may conclude completeness, unlike a crawl', async () => {
  const res = await fetchListings({ url: 'https://feed.invalid/f.xml' }, { fetchImpl: serve(XML) });
  assert.equal(res.complete, true);
});

// --- how affiliate feeds actually arrive -------------------------------------

test('a gzipped feed is read, since that is how they are served', async () => {
  // Networks serve .txt.gz and .xml.gz files. Content-Encoding is about the
  // transfer, not the body, so fetch does not decompress these — reading them
  // as text gave binary and the parser reported "no rows", a true statement
  // about entirely the wrong problem. This was why a real Rakuten or Awin feed
  // could not be read at all.
  const gz = gzipSync(Buffer.from(XML, 'utf8'));
  const res = await fetchListings(
    { url: 'https://feed.invalid/f.xml.gz' },
    { fetchImpl: async () => new Response(gz, { status: 200 }) },
  );
  assert.equal(res.ok, true);
  assert.equal(res.listings.length, 2);
  assert.equal(res.listings[0].price, 1250);
});

test('a pipe-delimited feed is read — Rakuten Advertising uses one', async () => {
  const piped = [
    'id|title|brand|price|link|condition|availability',
    'R1|Yohji Yamamoto wool coat, long|Yohji Yamamoto|1490.00 USD|https://example.invalid/r1|used|in stock',
    'R2|Guidi 788Z derby|Guidi|640.00 USD|https://example.invalid/r2|used|in stock',
  ].join('\n');
  const res = await fetchListings(
    { url: 'https://feed.invalid/f.txt' },
    { fetchImpl: async () => new Response(piped, { status: 200 }) },
  );
  assert.equal(res.ok, true);
  assert.equal(res.listings.length, 2);
  // A comma inside the title must not win over the real delimiter.
  assert.equal(res.listings[0].title, 'Yohji Yamamoto wool coat, long');
});

test('a gzipped pipe-delimited feed — the common real case — is read', async () => {
  const piped = [
    'id|title|brand|price|link|availability',
    'T1|Comme des Garcons Homme Plus AD2002 wool jacket|Comme des Garcons|1150.00 USD|https://example.invalid/t1|in stock',
  ].join('\n');
  const res = await fetchListings(
    { url: 'https://feed.invalid/trr.txt.gz' },
    { fetchImpl: async () => new Response(gzipSync(Buffer.from(piped, 'utf8')), { status: 200 }) },
  );
  assert.equal(res.ok, true);
  assert.equal(res.listings[0].price, 1150);
  assert.equal(res.listings[0].currency, 'USD');
});

// --- the XML itself ---------------------------------------------------------
//
// A feed is read by a scanner rather than a non-greedy regex, because the
// failure mode of the regex is a record that looks complete: it ends early and
// every field after the cut is simply absent.

test('a description containing markup does not truncate the record', async () => {
  const body = `<?xml version="1.0"?><rss><channel>
 <item>
  <g:id>A-1</g:id>
  <g:title>Guidi horse leather derby</g:title>
  <description><![CDATA[<p>Ends the item</p></item> — as a shop's HTML sometimes does.]]></description>
  <g:price>720.00 EUR</g:price>
  <g:link>https://example.invalid/p/1</g:link>
  <g:availability>in stock</g:availability>
 </item>
</channel></rss>`;
  const res = await fetchListings({ url: 'https://feed.invalid/f.xml' }, { fetchImpl: serve(body) });
  assert.equal(res.ok, true);
  assert.equal(res.listings.length, 1);
  // The price sits AFTER the fake close tag: with the old cut it was lost, and
  // a listing with no price is dropped without anything failing.
  assert.equal(res.listings[0].price, 720);
  assert.equal(res.listings[0].url, 'https://example.invalid/p/1');
});

test("Atom's self-closing link is read, not silently lost", async () => {
  const body = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
 <entry>
  <id>B-2</id>
  <title>Carol Christian Poell scarstitch jacket</title>
  <link rel="alternate" href="https://example.invalid/p/2"/>
  <g:price>2400.00 EUR</g:price>
  <g:availability>in stock</g:availability>
 </entry>
</feed>`;
  const res = await fetchListings({ url: 'https://feed.invalid/f.xml' }, { fetchImpl: serve(body) });
  assert.equal(res.listings.length, 1);
  // A listing you cannot open is a listing you cannot check or buy.
  assert.equal(res.listings[0].url, 'https://example.invalid/p/2');
});

test('a curly apostrophe arrives as a character, not as "&#8217;"', async () => {
  const body = `<?xml version="1.0"?><rss><channel>
 <item>
  <g:id>C-3</g:id>
  <g:title>Yohji Yamamoto&#8217;s Pour Homme wool coat</g:title>
  <g:price>1490.00 EUR</g:price>
  <g:availability>in stock</g:availability>
 </item>
</channel></rss>`;
  const res = await fetchListings({ url: 'https://feed.invalid/f.xml' }, { fetchImpl: serve(body) });
  assert.equal(res.listings[0].title, 'Yohji Yamamoto’s Pour Homme wool coat');
});

test('an already-escaped ampersand does not become markup', () => {
  // `&amp;lt;` is a feed that escaped an escaped string. Decoding the ampersand
  // first would turn it into a `<` and invent a tag inside the title.
  assert.equal(decodeEntities('Comme des Gar&amp;#231;ons &amp;lt;3'), 'Comme des Gar&#231;ons &lt;3');
  assert.equal(decodeEntities('wool &amp; silk'), 'wool & silk');
});

test('a comment between items does not swallow one', () => {
  const items = splitItems(
    '<channel><item><id>1</id></item><!-- <item>not a product</item> --><item><id>2</id></item></channel>',
  );
  assert.equal(items.length, 2);
  assert.match(items[1], /<id>2<\/id>/);
});
