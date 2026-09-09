import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRobots, isAllowed, selectGroup } from '../src/lib/robots.mjs';

const UA = 'resale-tracker-probe/0.1';

test('a bare Disallow: / blocks everything', () => {
  const g = parseRobots('User-agent: *\nDisallow: /');
  assert.equal(isAllowed(g, UA, '/products.json').allowed, false);
  assert.equal(isAllowed(g, UA, '/').allowed, false);
});

test('an empty Disallow is not a rule and allows everything', () => {
  const g = parseRobots('User-agent: *\nDisallow:');
  assert.equal(isAllowed(g, UA, '/products.json').allowed, true);
});

test('no robots rules at all means allowed', () => {
  assert.equal(isAllowed(parseRobots(''), UA, '/products.json').allowed, true);
});

test('the longest matching pattern wins', () => {
  const g = parseRobots('User-agent: *\nDisallow: /\nAllow: /products.json');
  assert.equal(isAllowed(g, UA, '/products.json').allowed, true);
  assert.equal(isAllowed(g, UA, '/cart').allowed, false);
});

test('Allow wins a same-length tie', () => {
  const g = parseRobots('User-agent: *\nDisallow: /abc\nAllow: /abc');
  assert.equal(isAllowed(g, UA, '/abc').allowed, true);
});

test('wildcards inside a pattern match', () => {
  const g = parseRobots('User-agent: *\nDisallow: /*.json');
  assert.equal(isAllowed(g, UA, '/products.json').allowed, false);
  assert.equal(isAllowed(g, UA, '/products.html').allowed, true);
});

test('a $ anchors the end of the path', () => {
  const g = parseRobots('User-agent: *\nDisallow: /products.json$');
  assert.equal(isAllowed(g, UA, '/products.json').allowed, false);
  // The anchored rule must not catch a query-bearing longer path.
  assert.equal(isAllowed(g, UA, '/products.json/extra').allowed, true);
});

test('a specific user-agent group beats the wildcard group', () => {
  const g = parseRobots(
    'User-agent: *\nDisallow:\n\nUser-agent: resale-tracker-probe\nDisallow: /products.json',
  );
  assert.equal(isAllowed(g, UA, '/products.json').allowed, false);
  assert.equal(isAllowed(g, 'SomeOtherBot', '/products.json').allowed, true);
});

test('consecutive User-agent lines share one rule group', () => {
  const g = parseRobots('User-agent: alpha\nUser-agent: beta\nDisallow: /x');
  assert.equal(isAllowed(g, 'alpha', '/x').allowed, false);
  assert.equal(isAllowed(g, 'beta', '/x').allowed, false);
  assert.equal(isAllowed(g, 'gamma', '/x').allowed, true);
});

test('Crawl-delay is read from the matching group', () => {
  const g = parseRobots('User-agent: *\nCrawl-delay: 10\nDisallow: /admin');
  assert.equal(isAllowed(g, UA, '/products.json').crawlDelay, 10);
});

test('comments and blank lines are ignored', () => {
  const g = parseRobots('# a comment\nUser-agent: *   # trailing\nDisallow: /cart\n\n');
  assert.equal(isAllowed(g, UA, '/cart').allowed, false);
  assert.equal(isAllowed(g, UA, '/products.json').allowed, true);
});

test('a realistic Shopify robots.txt permits the product feed', () => {
  // Shopify's default blocks carts, checkouts and search, not /products.json.
  const g = parseRobots(`User-agent: *
Disallow: /admin
Disallow: /cart
Disallow: /orders
Disallow: /checkouts/
Disallow: /checkout
Disallow: /search
Sitemap: https://example.com/sitemap.xml`);
  assert.equal(isAllowed(g, UA, '/products.json').allowed, true);
  assert.equal(isAllowed(g, UA, '/cart').allowed, false);
});

test('a shop that blocks the feed is respected, not worked around', () => {
  const g = parseRobots('User-agent: *\nDisallow: /products.json');
  const verdict = isAllowed(g, UA, '/products.json');
  assert.equal(verdict.allowed, false);
  assert.match(verdict.rule, /Disallow: \/products\.json/);
});

test('regex metacharacters in a path are treated literally', () => {
  const g = parseRobots('User-agent: *\nDisallow: /a+b(c)');
  assert.equal(isAllowed(g, UA, '/a+b(c)').allowed, false);
  assert.equal(isAllowed(g, UA, '/aaab').allowed, true);
});

test('rules before any User-agent line are ignored', () => {
  const g = parseRobots('Disallow: /everything\nUser-agent: *\nDisallow: /cart');
  assert.equal(isAllowed(g, UA, '/everything').allowed, true);
});

test('selectGroup falls back to the wildcard group', () => {
  const g = parseRobots('User-agent: *\nDisallow: /x');
  assert.ok(selectGroup(g, 'anything'));
});
