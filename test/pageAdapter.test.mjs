import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fetchListings } from '../src/lib/adapters/page.mjs';

const UA = 'clothes/1.0 (+mailto:someone@example.invalid)';

// A shop with no API of any kind: hand-built markup, one card per product,
// relative hrefs, and the price inside the card rather than beside it. There
// are far more shops like this than on all five supported platforms together,
// and none of them has a key to apply for.
const SHOP_PAGE = `<!doctype html>
<html><body>
  <nav><a href="/">Home</a><a href="/about">About</a></nav>
  <h1>Archive</h1>
  <ul class="grid">
    <li><a href="/product/cdg-blazer">
      <img src="/img/1.jpg">
      <div>Comme des Garçons Homme Plus</div>
      <div>AD2002 wool tailored jacket</div>
      <div>€780.00</div>
      <div>Size M</div>
    </a></li>
    <li><a href="/product/yohji-coat">
      <img src="/img/2.jpg">
      <div>Yohji Yamamoto Pour Homme</div>
      <div>Wool gabardine long coat</div>
      <div>€1,240.00</div>
      <div>Size 3</div>
    </a></li>
  </ul>
  <footer>© 2026</footer>
</body></html>`;

/** A fetch that answers from a table, and records what was asked for. */
function stubFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers ?? {} });
    const route = routes[String(url)] ?? routes.default;
    if (!route) return { ok: false, status: 404, headers: new Headers(), text: async () => '' };
    if (route.throws) throw new Error(route.throws);
    return {
      ok: route.status ? route.status < 400 : true,
      status: route.status ?? 200,
      headers: new Headers(route.headers ?? { 'content-type': 'text/html' }),
      text: async () => route.body ?? '',
    };
  };
  return { impl, calls };
}

test('a shop with no API at all is read the way copying it reads it', async () => {
  const { impl } = stubFetch({
    'https://shop.invalid/robots.txt': { body: 'User-agent: *\nAllow: /\n', headers: { 'content-type': 'text/plain' } },
    'https://shop.invalid/collections/all': { body: SHOP_PAGE },
  });

  const result = await fetchListings(
    { url: 'https://shop.invalid/collections/all', userAgent: UA },
    { fetchImpl: impl },
  );

  assert.equal(result.ok, true, result.error);
  assert.equal(result.listings.length, 2);

  const [first, second] = result.listings;
  assert.equal(first.title, 'Comme des Garçons Homme Plus AD2002 wool tailored jacket');
  assert.equal(first.price, 780);
  assert.equal(first.currency, 'EUR');
  assert.equal(first.sizeRaw, 'M');
  // Relative hrefs resolved against the page. A browser does this on copy;
  // nothing has here, so the adapter has to, or every row is unreachable.
  assert.equal(first.url, 'https://shop.invalid/product/cdg-blazer');
  assert.equal(first.imageUrl, 'https://shop.invalid/img/1.jpg');
  assert.equal(second.price, 1240);
});

test('one page of results is never a complete catalogue', async () => {
  // The contract's most important field. This reads one page and cannot know
  // how many there are, so nothing it returns may be used to conclude a piece
  // has gone — which is exactly what `complete: true` would license.
  const { impl } = stubFetch({
    'https://shop.invalid/robots.txt': { body: '', headers: { 'content-type': 'text/plain' } },
    'https://shop.invalid/collections/all': { body: SHOP_PAGE },
  });
  const result = await fetchListings(
    { url: 'https://shop.invalid/collections/all', userAgent: UA },
    { fetchImpl: impl },
  );
  assert.equal(result.complete, false);
});

test('robots.txt is read first, every run, and decides', async () => {
  const { impl, calls } = stubFetch({
    'https://shop.invalid/robots.txt': {
      body: 'User-agent: *\nDisallow: /collections/\n',
      headers: { 'content-type': 'text/plain' },
    },
    'https://shop.invalid/collections/all': { body: SHOP_PAGE },
  });

  const result = await fetchListings(
    { url: 'https://shop.invalid/collections/all', userAgent: UA },
    { fetchImpl: impl },
  );

  assert.equal(result.ok, false);
  assert.match(result.error, /disallows/);
  // And the page itself was never requested. A refusal that fetches anyway is
  // not a refusal.
  assert.deepEqual(calls.map((c) => c.url), ['https://shop.invalid/robots.txt']);
});

test('an unreadable robots.txt is a refusal, not permission', async () => {
  for (const route of [{ status: 500 }, { throws: 'ECONNREFUSED' }]) {
    const { impl, calls } = stubFetch({ 'https://shop.invalid/robots.txt': route });
    const result = await fetchListings(
      { url: 'https://shop.invalid/x', userAgent: UA },
      { fetchImpl: impl },
    );
    assert.equal(result.ok, false);
    assert.equal(calls.length, 1, 'the page must not be fetched');
  }
});

test('a site that declines the request is taken at its word', async () => {
  // 403 is an answer. Nothing here is allowed to interpret it as an invitation
  // to try again looking like something else.
  for (const status of [401, 403]) {
    const { impl } = stubFetch({
      'https://shop.invalid/robots.txt': { body: '', headers: { 'content-type': 'text/plain' } },
      'https://shop.invalid/x': { status },
    });
    const result = await fetchListings(
      { url: 'https://shop.invalid/x', userAgent: UA },
      { fetchImpl: impl },
    );
    assert.equal(result.ok, false);
    assert.match(result.error, /refused/);
    assert.match(result.note, /Paste the page/);
  }
});

test('a page that yields nothing is a failure, never an empty shop', async () => {
  // "The layout changed" and "everything sold" look identical from here, and
  // only one of them is safe to report. So neither is: ok:false means the
  // ingest layer may not touch a single existing listing's status.
  const { impl } = stubFetch({
    'https://shop.invalid/robots.txt': { body: '', headers: { 'content-type': 'text/plain' } },
    'https://shop.invalid/x': { body: '<html><body><p>Loading…</p></body></html>' },
  });
  const result = await fetchListings(
    { url: 'https://shop.invalid/x', userAgent: UA },
    { fetchImpl: impl },
  );
  assert.equal(result.ok, false);
  assert.equal(result.complete, false);
  assert.match(result.note, /rendered by script/);
});

test('the currency comes from the page, and is never inferred from the domain', async () => {
  const yen = SHOP_PAGE.replace('€780.00', '¥52,000').replace('€1,240.00', '¥98,000');
  const { impl } = stubFetch({
    'https://shop.invalid/robots.txt': { body: '', headers: { 'content-type': 'text/plain' } },
    'https://shop.invalid/x': { body: yen },
  });
  const result = await fetchListings(
    // A configured currency that the page contradicts must lose: a wrong
    // currency is a wrong price by a factor of a hundred and fifty.
    { url: 'https://shop.invalid/x', userAgent: UA, currency: 'EUR' },
    { fetchImpl: impl },
  );
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.listings.map((l) => l.currency), ['JPY', 'JPY']);
  assert.equal(result.listings[0].price, 52000);
});

test('a page quoting bare numbers uses the configured currency, and none means no row', async () => {
  const bare = SHOP_PAGE.replace('€780.00', '780 EUR').replace('€1,240.00', '1240 EUR');
  const { impl } = stubFetch({
    'https://shop.invalid/robots.txt': { body: '', headers: { 'content-type': 'text/plain' } },
    'https://shop.invalid/x': { body: bare },
  });
  const result = await fetchListings(
    { url: 'https://shop.invalid/x', userAgent: UA },
    { fetchImpl: impl },
  );
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.listings.map((l) => l.currency), ['EUR', 'EUR']);
});

test('something that is not a web page is not parsed as one', async () => {
  const { impl } = stubFetch({
    'https://shop.invalid/robots.txt': { body: '', headers: { 'content-type': 'text/plain' } },
    'https://shop.invalid/x': { body: '%PDF-1.4', headers: { 'content-type': 'application/pdf' } },
  });
  const result = await fetchListings(
    { url: 'https://shop.invalid/x', userAgent: UA },
    { fetchImpl: impl },
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /not a web page/);
});

test('a stated crawl delay is honoured rather than noted', async () => {
  let told = null;
  const { impl } = stubFetch({
    'https://shop.invalid/robots.txt': {
      body: 'User-agent: *\nCrawl-delay: 10\n',
      headers: { 'content-type': 'text/plain' },
    },
    'https://shop.invalid/x': { body: SHOP_PAGE },
  });
  await fetchListings(
    { url: 'https://shop.invalid/x', userAgent: UA },
    { fetchImpl: impl, limiter: { wait: async () => {}, setCrawlDelay: (d) => { told = d; } } },
  );
  assert.equal(told, 10);
});
