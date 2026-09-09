// Integration test for the shop probe, against a local fixture server.
//
// Proves the behaviour that matters: robots.txt is read first, a disallowed
// path is never requested, an unreadable robots.txt fails closed, and a 429
// stops the host.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { writeFile, readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const requested = [];

const SHOPS = {
  // Open Shopify: robots allows the feed, feed returns products.
  open: {
    robots: 'User-agent: *\nDisallow: /cart\nDisallow: /checkout\n',
    products: JSON.stringify({ products: [{ id: 1, title: 'CDG Homme Plus jacket' }] }),
  },
  // Robots explicitly disallows the feed. The probe must NOT request it.
  blocked: {
    robots: 'User-agent: *\nDisallow: /products.json\n',
    products: JSON.stringify({ products: [{ id: 2 }] }),
  },
  // robots.txt itself is a 403: must fail closed.
  forbidden: { robotsStatus: 403, products: '{}' },
  // Feed turned off: serves HTML.
  nofeed: { robots: 'User-agent: *\n', products: '<!doctype html><html></html>' },
  // Rate limited.
  limited: { robots: 'User-agent: *\n', productsStatus: 429 },
};

function makeServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    // Route by first path segment so each fixture shop has its own "site":
    // /open/robots.txt, /blocked/products.json, and so on.
    const [, shopKey, ...rest] = url.pathname.split('/');
    const path = '/' + rest.join('/');
    const shop = SHOPS[shopKey] ?? SHOPS.open;
    requested.push({ shop: shopKey, path });

    if (path === '/robots.txt') {
      if (shop.robotsStatus) {
        res.writeHead(shop.robotsStatus).end('forbidden');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' }).end(shop.robots ?? '');
      return;
    }
    if (path === '/products.json') {
      if (shop.productsStatus === 429) {
        res.writeHead(429, { 'retry-after': '60' }).end('slow down');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(shop.products ?? '{}');
      return;
    }
    if (path === '/') {
      res.writeHead(200, { 'x-shopid': shopKey === 'nofeed' ? '' : '12345' }).end('');
      return;
    }
    res.writeHead(404).end('');
  });
}

test('probe honours robots.txt and fails closed', async (t) => {
  const server = makeServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const dir = await mkdtemp(join(tmpdir(), 'probe-'));
  t.after(async () => {
    server.close();
    await rm(dir, { recursive: true, force: true });
  });

  const config = {
    shops: [
      { name: 'Open',      domain: `open.test`,      base: `http://127.0.0.1:${port}/open`,      permission_status: 'not_asked' },
      { name: 'Blocked',   domain: `blocked.test`,   base: `http://127.0.0.1:${port}/blocked`,   permission_status: 'not_asked' },
      { name: 'Forbidden', domain: `forbidden.test`, base: `http://127.0.0.1:${port}/forbidden`, permission_status: 'not_asked' },
      { name: 'NoFeed',    domain: `nofeed.test`,    base: `http://127.0.0.1:${port}/nofeed`,    permission_status: 'not_asked' },
      { name: 'Limited',   domain: `limited.test`,   base: `http://127.0.0.1:${port}/limited`,   permission_status: 'not_asked' },
      { name: 'Declined',  domain: `declined.test`,  base: `http://127.0.0.1:${port}/declined`,  permission_status: 'declined' },
    ],
  };

  // The probe reads config/shops.json from the repo root, so point it at a copy.
  const original = await readFile('config/shops.json', 'utf8');
  await writeFile('config/shops.json', JSON.stringify(config));
  t.after(() => writeFile('config/shops.json', original));

  const { stdout } = await run('node', ['scripts/probe-shops.mjs', '--out', join(dir, 'out.md')], {
    env: { ...process.env, PROBE_CONTACT: 'test@example.invalid' },
  });

  const results = JSON.parse(await readFile('config/shop-probe-results.json', 'utf8'));
  const by = Object.fromEntries(results.map((r) => [r.name, r]));

  assert.match(by.Open.verdict, /usable/);
  assert.equal(by.Open.productsJson.productCount, 1);

  assert.match(by.Blocked.verdict, /manual-only/);
  assert.equal(by.Blocked.productsJson.allowed, false);
  assert.equal(by.Blocked.productsJson.checked, false, 'must not request a disallowed path');

  assert.match(by.Forbidden.verdict, /could not read robots/);
  assert.match(by.NoFeed.verdict, /manual-only/);
  assert.match(by.Limited.verdict, /rate limited/);
  assert.match(by.Declined.verdict, /permission declined/);

  // The decisive check: no request for the blocked shop's feed was ever made.
  const blockedFeedHits = requested.filter(
    (r) => r.shop === 'blocked' && r.path === '/products.json',
  );
  assert.equal(blockedFeedHits.length, 0, 'probe requested a robots-disallowed path');

  // And the declined shop was never contacted at all.
  assert.equal(requested.filter((r) => r.shop === 'declined').length, 0);
  assert.match(stdout, /usable/);
});
