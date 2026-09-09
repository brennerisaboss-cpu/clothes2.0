import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchListings } from '../src/lib/adapters/woocommerce.mjs';

// WooCommerce is the second platform small dealers actually run on. Everything
// here is about the two ways this could quietly corrupt prices — the minor-unit
// exponent and the currency — plus the rule every adapter shares: never
// conclude a piece was sold.

const PRODUCTS = [
  {
    id: 8821,
    name: 'Comme des Gar&#231;ons Homme Plus AD2002 wool jacket',
    slug: 'cdg-hp-ad2002-wool-jacket',
    permalink: 'https://shop.invalid/product/cdg-hp-ad2002-wool-jacket',
    sku: 'CDG-8821',
    prices: {
      price: '115000', regular_price: '230000', sale_price: '115000',
      currency_code: 'EUR', currency_minor_unit: 2,
    },
    images: [{ src: 'https://cdn.invalid/8821.jpg' }],
    attributes: [
      { name: 'Brand', terms: [{ name: 'Comme des Gar&#231;ons' }] },
      { name: 'Size', terms: [{ name: 'M' }] },
    ],
    categories: [{ name: 'Jackets' }],
    is_in_stock: true,
    on_sale: true,
  },
  {
    id: 8822,
    name: 'Guidi 992 horse leather derby',
    permalink: 'https://shop.invalid/product/guidi-992',
    prices: { price: '72000', currency_code: 'EUR', currency_minor_unit: 2 },
    images: [],
    attributes: [{ name: 'Size', terms: [{ name: '42' }] }],
    is_in_stock: false,
  },
];

const serve = (body, { status = 200, headers = {} } = {}) =>
  async (url) => {
    if (String(url).endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /', { status: 200 });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
  };

const CONFIG = { domain: 'shop.invalid', userAgent: 'test/1.0 (+mailto:me@example.invalid)' };

test('a WooCommerce shop is read without any key or configuration', async () => {
  const res = await fetchListings(CONFIG, { fetchImpl: serve(PRODUCTS) });
  assert.equal(res.ok, true);
  assert.equal(res.listings.length, 2);
  assert.equal(res.complete, true);

  const jacket = res.listings[0];
  assert.equal(jacket.sourceItemId, '8821');
  assert.equal(jacket.url, 'https://shop.invalid/product/cdg-hp-ad2002-wool-jacket');
  assert.equal(jacket.imageUrl, 'https://cdn.invalid/8821.jpg');
  assert.equal(jacket.sizeRaw, 'M');
});

test('prices are read in the shop’s own minor units, not assumed to be cents', async () => {
  // The failure this prevents is silent and large: "115000" is €1,150.00 with
  // an exponent of 2 and ¥115,000 with an exponent of 0. Assuming cents would
  // price a Japanese shop's entire catalogue at a hundredth of its real value
  // and float every piece to the top of the opportunities table.
  const euro = await fetchListings(CONFIG, { fetchImpl: serve(PRODUCTS) });
  assert.equal(euro.listings[0].price, 1150);

  const yen = await fetchListings(CONFIG, {
    fetchImpl: serve([
      { ...PRODUCTS[0], prices: { price: '115000', currency_code: 'JPY', currency_minor_unit: 0 } },
    ]),
  });
  assert.equal(yen.listings[0].price, 115000);
  assert.equal(yen.listings[0].currency, 'JPY');
});

test('the sale price is what you would pay', async () => {
  const res = await fetchListings(CONFIG, { fetchImpl: serve(PRODUCTS) });
  assert.equal(res.listings[0].price, 1150, 'not the 2300 regular price');
  assert.equal(res.listings[0].extra.regularPrice, '230000');
});

test('the currency comes from the shop and is never guessed', async () => {
  const res = await fetchListings(CONFIG, { fetchImpl: serve(PRODUCTS) });
  // Per listing, because that is what the poll runner reads: it prefers the
  // currency a source states over anything configured for it.
  assert.equal(res.listings[0].currency, 'EUR');
  assert.equal(res.listings[1].currency, 'EUR');

  // A shop that states none, with none configured, is refused rather than
  // assigned one from its domain.
  const silent = await fetchListings(CONFIG, {
    fetchImpl: serve([{ ...PRODUCTS[1], prices: { price: '72000', currency_minor_unit: 2 } }]),
  });
  assert.equal(silent.ok, false);
  assert.match(silent.error, /refusing to guess/);
});

test('a catalogue quoting two currencies is refused, not half-priced', async () => {
  const res = await fetchListings(CONFIG, {
    fetchImpl: serve([
      PRODUCTS[0],
      { ...PRODUCTS[1], prices: { price: '72000', currency_code: 'GBP', currency_minor_unit: 2 } },
    ]),
  });
  assert.equal(res.ok, false);
  assert.match(res.error, /mixes currencies/);
});

test('a configured currency that contradicts the shop is an error, not a preference', async () => {
  const res = await fetchListings(
    { ...CONFIG, currency: 'USD' },
    { fetchImpl: serve(PRODUCTS) },
  );
  assert.equal(res.ok, false);
  assert.match(res.error, /USD.*EUR|EUR.*USD/);
});

test('out of stock is reported as unavailable, never as sold', async () => {
  const res = await fetchListings(CONFIG, { fetchImpl: serve(PRODUCTS) });
  assert.equal(res.listings[1].available, false);
  assert.equal('soldAt' in res.listings[1], false);
});

test('WordPress entity escaping does not reach brand resolution', async () => {
  const res = await fetchListings(CONFIG, { fetchImpl: serve(PRODUCTS) });
  assert.match(res.listings[0].title, /Comme des Garçons/);
  assert.equal(res.listings[0].brandRaw, 'Comme des Garçons');
});

test('a shop with no Store API says so instead of erroring vaguely', async () => {
  const res = await fetchListings(CONFIG, {
    fetchImpl: serve('<!doctype html><title>Not found</title>', { status: 404 }),
  });
  assert.equal(res.ok, false);
  assert.match(res.error, /no WooCommerce Store API/);
});

test('an HTML page where JSON belongs is a shop without a feed', async () => {
  const res = await fetchListings(CONFIG, {
    fetchImpl: serve('<!doctype html><title>Shop</title>'),
  });
  assert.equal(res.ok, false);
  assert.match(res.error, /not JSON/);
});

test('robots.txt is obeyed, and checked every run', async () => {
  const res = await fetchListings(CONFIG, {
    fetchImpl: async (url) =>
      String(url).endsWith('/robots.txt')
        ? new Response('User-agent: *\nDisallow: /wp-json/', { status: 200 })
        : new Response(JSON.stringify(PRODUCTS), { status: 200 }),
  });
  assert.equal(res.ok, false);
  assert.match(res.error, /robots\.txt disallows/);
});

test('rate limiting stops the run rather than reporting a partial catalogue', async () => {
  const res = await fetchListings(CONFIG, {
    fetchImpl: async (url) =>
      String(url).endsWith('/robots.txt')
        ? new Response('', { status: 404 })
        : new Response('', { status: 429, headers: { 'retry-after': '120' } }),
  });
  assert.equal(res.ok, false);
  assert.match(res.error, /rate limited/);
});

test('a full page is followed by another, and the header can end it', async () => {
  const page = Array.from({ length: 100 }, (_, i) => ({
    ...PRODUCTS[0], id: 9000 + i, permalink: `https://shop.invalid/product/p${i}`,
  }));
  let calls = 0;
  const res = await fetchListings(CONFIG, {
    fetchImpl: async (url) => {
      if (String(url).endsWith('/robots.txt')) return new Response('', { status: 404 });
      calls++;
      return new Response(JSON.stringify(page), {
        status: 200,
        headers: { 'x-wp-totalpages': '2' },
      });
    },
  });
  assert.equal(res.ok, true);
  assert.equal(calls, 2, 'stopped when the shop said there were two pages');
  assert.equal(res.listings.length, 200);
  assert.equal(res.complete, true);
});

test('against a real HTTP server, with the real fetch', async () => {
  // The stubs above prove the logic; this proves the request itself — the path,
  // the query, the headers and the pagination as an actual server sees them.
  const { createServer } = await import('node:http');
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({ url: req.url, ua: req.headers['user-agent'] });
    if (req.url === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('User-agent: *\nAllow: /\n');
    }
    if (req.url.startsWith('/wp-json/wc/store/v1/products')) {
      res.writeHead(200, { 'content-type': 'application/json', 'x-wp-totalpages': '1' });
      return res.end(JSON.stringify(PRODUCTS));
    }
    res.writeHead(404).end('nope');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();

  try {
    const res = await fetchListings({
      domain: `127.0.0.1:${port}`,
      base: `http://127.0.0.1:${port}`,
      userAgent: 'resale-tracker/0.1 (personal price tracker; test)',
    });
    assert.equal(res.ok, true, res.error);
    assert.equal(res.listings.length, 2);
    assert.equal(res.listings[0].price, 1150);
    assert.equal(res.listings[0].currency, 'EUR');

    assert.deepEqual(
      seen.map((s) => s.url),
      ['/robots.txt', '/wp-json/wc/store/v1/products?per_page=100&page=1'],
    );
    // Identifying the poller is how a shop owner can ask us to stop.
    assert.match(seen[1].ua, /resale-tracker/);
  } finally {
    server.close();
  }
});
