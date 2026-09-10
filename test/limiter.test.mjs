// Who is being asked, and how often.
//
// The limiter was built inside runPoll, so there was one per source. Within a
// shop's own catalogue it paced properly; between shops it did nothing, because
// each poll began with a fresh one whose clock read zero. Eight shops therefore
// went out back to back — and the ones polled last are the ones that came back
// 429, including on robots.txt, which is the first request a poll makes and the
// cheapest thing a host has to refuse.
//
// The other half: most of this roster is `something.myshopify.com`. Those are
// different shops and one platform behind one edge, where the limit is per
// CALLER rather than per shop — so pacing each of them separately paces
// nothing at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rateLimitHost, isSharedPlatform, LimiterPool, HostLimiter,
  DEFAULT_MIN_INTERVAL_MS, SHARED_PLATFORM_INTERVAL_MS,
} from '../src/lib/limiter.mjs';

test('shops on one platform are one host', () => {
  // The shop name is a subdomain the platform assigned, not a domain the shop
  // owns, and the rate limit belongs to the platform.
  const a = rateLimitHost({ domain: 'archivestore-official.myshopify.com' }, 'shopify');
  const b = rateLimitHost({ domain: 'jubilee-archive.myshopify.com' }, 'shopify');
  assert.equal(a, b);
  assert.equal(a, 'myshopify.com');
});

test('a shop on its own domain is its own host', () => {
  // Collapsing two unrelated shops would halve the rate of both for no reason.
  const a = rateLimitHost({ domain: 'endyma.com' }, 'shopify');
  const b = rateLimitHost({ url: 'https://lobscur.com/collections/all' }, 'page');
  assert.notEqual(a, b);
  assert.equal(a, 'endyma.com');
  assert.equal(b, 'lobscur.com');
  assert.equal(isSharedPlatform(a), false);
});

test('an API source is keyed on the credential, not on a shop', () => {
  // There is no shop host, and every source using that adapter shares one quota.
  assert.equal(rateLimitHost({ queries: ['x'] }, 'ebay'), 'adapter:ebay');
  assert.equal(
    rateLimitHost({ queries: ['x'] }, 'ebay'),
    rateLimitHost({ queries: ['y'] }, 'ebay'),
  );
});

test('www is not a different host', () => {
  assert.equal(rateLimitHost({ url: 'https://www.endyma.com/x' }), 'endyma.com');
});

test('one pool hands the same limiter to every shop on a platform', () => {
  const pool = new LimiterPool();
  const one = pool.for(rateLimitHost({ domain: 'a.myshopify.com' }, 'shopify'));
  const two = pool.for(rateLimitHost({ domain: 'b.myshopify.com' }, 'shopify'));
  assert.equal(one, two, 'the eighth shop must be paced against the seven before it');

  const other = pool.for(rateLimitHost({ domain: 'endyma.com' }, 'shopify'));
  assert.notEqual(one, other);
});

test('a shared platform is paced more slowly than one shop', () => {
  // The interval is being divided among every shop in the group rather than
  // spent on one.
  const pool = new LimiterPool();
  assert.equal(pool.for('myshopify.com').delayMs, SHARED_PLATFORM_INTERVAL_MS);
  assert.equal(pool.for('endyma.com').delayMs, DEFAULT_MIN_INTERVAL_MS);
  assert.ok(SHARED_PLATFORM_INTERVAL_MS > DEFAULT_MIN_INTERVAL_MS);
});

test('one refusal slows the whole group', () => {
  // Without this, every shop behind the same edge discovers the limit for
  // itself, one 429 at a time — which is what the failing screen showed.
  const limiter = new HostLimiter(1000);
  assert.equal(limiter.backOff(), 2000);
  assert.equal(limiter.backOff(), 4000);
  // Bounded: a run must not talk itself into minutes between requests.
  for (let i = 0; i < 20; i++) limiter.backOff();
  assert.ok(limiter.delayMs <= 60_000);
});

test('a shop that states a crawl delay is obeyed, and never sped up', () => {
  const limiter = new HostLimiter(1500);
  limiter.setCrawlDelay(10);
  assert.equal(limiter.delayMs, 10_000);
  // Nothing lowers it.
  limiter.setMinInterval(200);
  limiter.setCrawlDelay(1);
  assert.equal(limiter.delayMs, 10_000);
});

test('waiting actually spaces requests', async () => {
  const limiter = new HostLimiter(60);
  const started = Date.now();
  await limiter.wait();
  await limiter.wait();
  await limiter.wait();
  assert.ok(Date.now() - started >= 100, 'three requests cannot all leave at once');
});
