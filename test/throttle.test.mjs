import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  throttleFor, afterFailure, MAX_FAILURES, LOCKOUT_MS, RESET_AFTER_MS,
} from '../src/lib/throttle.mjs';

const T0 = Date.UTC(2026, 8, 5, 12, 0, 0);

test('the first attempt is barely slowed', () => {
  const { locked, delayMs } = throttleFor(null, T0);
  assert.equal(locked, false);
  assert.ok(delayMs <= 250, `${delayMs}ms is too much for someone typing their own password`);
});

test('each failure costs more than the last', () => {
  let state = null;
  const delays = [];
  for (let i = 0; i < 6; i++) {
    delays.push(throttleFor(state, T0).delayMs);
    state = afterFailure(state, T0);
  }
  // Doubling, so the sixth guess is 32 times more expensive than the first.
  assert.deepEqual(delays, [250, 500, 1000, 2000, 4000, 8000]);
});

test('the delay is capped, so a wrong password is never a hung page', () => {
  let state = null;
  for (let i = 0; i < 9; i++) state = afterFailure(state, T0);
  assert.equal(throttleFor(state, T0).delayMs, 8000);
});

test('ten failures shut the door', () => {
  let state = null;
  for (let i = 0; i < MAX_FAILURES; i++) state = afterFailure(state, T0);

  const decision = throttleFor(state, T0 + 1000);
  assert.equal(decision.locked, true);
  assert.ok(decision.retryAfterMs > 0);
  // And being locked costs nothing to serve: no delay is paid while refusing.
  assert.equal(decision.delayMs, 0);
});

test('a lockout ends, and does not immediately re-lock', () => {
  // The bug this guards: expiring the lockout while keeping the count means
  // the first attempt after waiting fifteen minutes trips the cap again, and
  // the door never opens for anyone — the owner included.
  let state = null;
  for (let i = 0; i < MAX_FAILURES; i++) state = afterFailure(state, T0);

  const after = throttleFor(state, T0 + LOCKOUT_MS + 1000);
  assert.equal(after.locked, false);
  assert.equal(after.failures, 0);
  assert.equal(after.delayMs, 250);
});

test('the count fades after a long quiet period', () => {
  let state = null;
  for (let i = 0; i < 4; i++) state = afterFailure(state, T0);
  assert.equal(throttleFor(state, T0 + 1000).failures, 4);
  assert.equal(throttleFor(state, T0 + RESET_AFTER_MS + 1000).failures, 0);
});

test('failures spread out just under the reset window still accumulate', () => {
  // Otherwise the whole throttle is defeated by sleeping between guesses.
  let state = null;
  let now = T0;
  for (let i = 0; i < MAX_FAILURES; i++) {
    now += RESET_AFTER_MS - 60_000;
    state = afterFailure(state, now);
  }
  assert.equal(throttleFor(state, now + 1000).locked, true);
});

test('the first failure time is kept, not overwritten on every attempt', () => {
  const first = afterFailure(null, T0);
  const second = afterFailure(first, T0 + 5000);
  assert.equal(second.first_failure_at.getTime(), T0);
  assert.equal(second.last_failure_at.getTime(), T0 + 5000);
});

test('a corrupt or absent row is treated as no failures, never as a lockout', () => {
  // A throttle that can lock the owner out on bad data is worse than none.
  for (const state of [null, {}, { failures: -3 }, { failures: 'x' }, { locked_until: 'nonsense' }]) {
    const d = throttleFor(state, T0);
    assert.equal(d.locked, false, JSON.stringify(state));
    assert.equal(d.failures, 0);
  }
});

// --- which counter an attempt lands in --------------------------------------

import { clientKey } from '../src/lib/unlockAttempts.mjs';

const headers = (obj = {}) => ({ get: (k) => obj[k.toLowerCase()] ?? null });

test('a rotating x-forwarded-for cannot buy a fresh counter', () => {
  // The whole lockout rests on an attempt landing in the same row as the one
  // before it. Believing a client-supplied header meant every request could
  // ask for a clean row — ten failures, forever, at no cost. `next start`
  // behind an nginx that appends rather than overwrites is enough for that.
  const keys = new Set(
    ['198.51.100.1', '203.0.113.7', '192.0.2.55'].map((ip) =>
      clientKey(headers({ 'x-forwarded-for': ip }), { bind: '0.0.0.0', trustProxy: null }),
    ),
  );
  assert.equal(keys.size, 1, 'every forged address must land in the same bucket');
});

test('bound to loopback, there is one guesser and the header is irrelevant', () => {
  const key = clientKey(headers({ 'x-forwarded-for': '198.51.100.1' }), { bind: '127.0.0.1' });
  assert.equal(key, 'local');
  assert.equal(clientKey(headers({}), { bind: '127.0.0.1' }), 'local');
});

test('a declared trusted proxy is believed, because it overwrites the header', () => {
  // Vercel and Cloudflare replace x-forwarded-for rather than appending to it,
  // so there the first hop is a fact rather than a wish — and per-client
  // counting is better than one shared bucket.
  const a = clientKey(headers({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1' }), {
    bind: '0.0.0.0', trustProxy: 'true',
  });
  const b = clientKey(headers({ 'x-forwarded-for': '203.0.113.7' }), {
    bind: '0.0.0.0', trustProxy: 'true',
  });
  assert.equal(a, 'fwd:198.51.100.1');
  assert.notEqual(a, b);
});

test('only an explicit declaration counts as trust', () => {
  for (const value of [undefined, null, '', 'no', 'false', '0', 'maybe', 'nginx']) {
    assert.equal(
      clientKey(headers({ 'x-forwarded-for': '198.51.100.1' }), { bind: '0.0.0.0', trustProxy: value }),
      'all',
      String(value),
    );
  }
});

test('an absurdly long header value cannot be used to grow the table', () => {
  const key = clientKey(headers({ 'x-forwarded-for': 'a'.repeat(5000) }), {
    bind: '0.0.0.0', trustProxy: 'yes',
  });
  assert.ok(key.length <= 105, key.length);
});
