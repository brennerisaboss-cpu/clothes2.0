import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchRates, ageInDays, isFresh } from '../src/lib/adapters/fx.mjs';

const OK = (body) => async () =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

test('inverts publisher rates into the base currency', async () => {
  const res = await fetchRates(
    { baseCurrency: 'EUR', currencies: ['JPY', 'USD'] },
    { fetchImpl: OK({ base: 'EUR', date: '2026-09-03', rates: { JPY: 172.5, USD: 1.16 } }) },
  );
  assert.equal(res.ok, true);
  assert.equal(res.complete, true);

  const jpy = res.listings.find((r) => r.from === 'JPY');
  // The publisher says 1 EUR = 172.5 JPY; every price here runs the other way.
  assert.ok(Math.abs(jpy.rate - 1 / 172.5) < 1e-12);
  assert.equal(jpy.to, 'EUR');
  assert.equal(jpy.asOf, '2026-09-03');
});

test('every rate in one response carries the same fixing date', async () => {
  const res = await fetchRates(
    { baseCurrency: 'EUR', currencies: ['JPY', 'USD', 'GBP'] },
    { fetchImpl: OK({ date: '2026-09-03', rates: { JPY: 172.5, USD: 1.16, GBP: 0.85 } }) },
  );
  assert.equal(new Set(res.listings.map((r) => r.asOf)).size, 1);
});

test('a missing currency is named, and marks the table incomplete', async () => {
  const res = await fetchRates(
    { baseCurrency: 'EUR', currencies: ['JPY', 'XXX'] },
    { fetchImpl: OK({ date: '2026-09-03', rates: { JPY: 172.5 } }) },
  );
  assert.equal(res.ok, true);
  assert.equal(res.complete, false);
  assert.match(res.note, /XXX/);
  assert.equal(res.listings.length, 1);
});

test('a zero or nonsense rate is dropped, never inverted into infinity', async () => {
  // 1/0 is Infinity, which would price a Japanese listing at nothing and put
  // it top of every opportunity table. This is the failure worth a test.
  for (const bad of [0, -3, 'abc', null]) {
    const res = await fetchRates(
      { baseCurrency: 'EUR', currencies: ['JPY'] },
      { fetchImpl: OK({ date: '2026-09-03', rates: { JPY: bad } }) },
    );
    assert.equal(res.listings.length, 0, `rate ${bad} should have been dropped`);
    assert.equal(res.complete, false);
  }
});

test('a dateless response is refused rather than stamped with today', async () => {
  const res = await fetchRates(
    { baseCurrency: 'EUR', currencies: ['JPY'] },
    { fetchImpl: OK({ rates: { JPY: 172.5 } }) },
  );
  assert.equal(res.ok, false);
});

test('an HTTP error leaves existing rates alone', async () => {
  const res = await fetchRates(
    { baseCurrency: 'EUR', currencies: ['JPY'] },
    { fetchImpl: async () => new Response('nope', { status: 503 }) },
  );
  assert.equal(res.ok, false);
  assert.match(res.error, /503/);
  assert.equal(res.listings.length, 0);
});

test('the base currency is never requested against itself', async () => {
  let asked;
  await fetchRates(
    { baseCurrency: 'EUR', currencies: ['EUR', 'JPY', 'eur'] },
    {
      fetchImpl: async (url) => {
        asked = url;
        return new Response(JSON.stringify({ date: '2026-09-03', rates: { JPY: 172.5 } }), { status: 200 });
      },
    },
  );
  assert.match(asked, /symbols=JPY$/);
});

test('nothing to convert is a success, not an error', async () => {
  const res = await fetchRates(
    { baseCurrency: 'EUR', currencies: [] },
    { fetchImpl: async () => assert.fail('should not have called out') },
  );
  assert.equal(res.ok, true);
  assert.equal(res.complete, true);
});

test('staleness follows the working-day calendar, not 24 hours', async () => {
  const monday = new Date('2026-09-07T09:00:00Z');
  // Friday's fixing read on Monday morning is the normal case, not a fault.
  assert.equal(isFresh('2026-09-04', monday), true);
  // A fortnight means the refresh stopped running.
  assert.equal(isFresh('2026-08-24', monday), false);
  assert.equal(Math.floor(ageInDays('2026-09-04', monday)), 3);
  assert.equal(ageInDays('not a date'), Infinity);
});
