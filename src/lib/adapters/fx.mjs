// Foreign exchange rates.
//
// This is the quietest way for the whole system to be wrong. Every route in
// the platform crosses a currency — a Japanese shop bought in JPY and exited
// in EUR, a US consignor exited in GBP — so the margin is a difference of two
// numbers that were each multiplied by a rate. A rate that is six months stale
// does not fail loudly. It just moves every score by a few per cent in the
// same direction, which is exactly the size of the edge being looked for.
//
// So: real rates, dated, from a source that says when it published them.
//
// Frankfurter serves the European Central Bank's daily reference rates. No key,
// no account, no terms that prohibit programmatic access — it exists to be
// called this way. The ECB fixes once per working day around 16:00 CET, so a
// rate is expected to be up to three days old over a weekend, and that is
// normal rather than stale. Anything older means the refresh stopped running.
//
// Like every other adapter here, this returns observations. It does not write
// to the database, decide a rate is good enough, or fill a gap by guessing.

import { succeeded, failed } from './contract.mjs';

export const id = 'fx';

/** ECB publishes on TARGET working days; a long weekend is three days. */
export const EXPECTED_MAX_AGE_DAYS = 4;

const DEFAULT_ENDPOINT = process.env.FX_ENDPOINT ?? 'https://api.frankfurter.dev/v1/latest';

/**
 * @typedef {object} RawRate
 * @property {string} from   ISO code of the priced currency.
 * @property {string} to     ISO code of the base currency being converted to.
 * @property {number} rate   Multiply a `from` amount by this to get `to`.
 * @property {string} asOf   ISO date the publisher stamped on the fixing.
 */

/**
 * Fetch rates INTO `baseCurrency` for each of `currencies`.
 *
 * One request, not one per pair: every rate then carries the same fixing date,
 * so a set of prices converted together cannot silently mix two days.
 *
 * @param {object} config { baseCurrency, currencies, userAgent, endpoint? }
 * @param {object} deps   { fetchImpl }
 */
export async function fetchRates(config, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const base = String(config.baseCurrency ?? '').toUpperCase();
  const wanted = [...new Set((config.currencies ?? []).map((c) => String(c).toUpperCase()))]
    .filter((c) => /^[A-Z]{3}$/.test(c) && c !== base);

  if (!/^[A-Z]{3}$/.test(base)) return failed(`base currency "${config.baseCurrency}" is not an ISO code`);
  if (!wanted.length) return succeeded([], { complete: true, note: 'nothing to convert' });

  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
  const url = `${endpoint}?base=${base}&symbols=${wanted.join(',')}`;

  let body;
  try {
    const res = await fetchImpl(url, {
      headers: { 'user-agent': config.userAgent ?? 'resale-tracker/0.1', accept: 'application/json' },
    });
    if (!res.ok) return failed(`fx endpoint returned ${res.status}`);
    body = await res.json();
  } catch (err) {
    return failed(`fx endpoint unreachable: ${err?.message ?? err}`);
  }

  const asOf = body?.date;
  const quoted = body?.rates;
  if (!asOf || !quoted || typeof quoted !== 'object') {
    return failed('fx response carried no dated rate table');
  }

  // The response gives base -> X. Every price in this system runs the other
  // way, X -> base, so invert. Guard the reciprocal: a zero or a string that
  // parsed to NaN would otherwise become Infinity and price an item at nothing.
  const rates = [];
  const missing = [];
  for (const currency of wanted) {
    const perBase = Number(quoted[currency]);
    if (!Number.isFinite(perBase) || perBase <= 0) {
      missing.push(currency);
      continue;
    }
    rates.push({ from: currency, to: base, rate: 1 / perBase, asOf });
  }

  // A partial table is usable — the pairs that came back are still correct —
  // but it is not complete, and the caller is told which ones are absent so a
  // missing currency surfaces as a named gap rather than as absent listings.
  return succeeded(rates, {
    complete: missing.length === 0,
    note: missing.length ? `no rate published for ${missing.join(', ')}` : undefined,
  });
}

/**
 * How stale is a fixing, in days? Pure, so the UI and the scorer agree.
 * @param {Date|string} asOf
 * @param {Date} now
 */
export function ageInDays(asOf, now = new Date()) {
  const then = asOf instanceof Date ? asOf : new Date(asOf);
  if (!Number.isFinite(then.getTime())) return Infinity;
  return (now.getTime() - then.getTime()) / 86_400_000;
}

/** Is a fixing recent enough that a score may rest on it? */
export function isFresh(asOf, now = new Date(), maxAgeDays = EXPECTED_MAX_AGE_DAYS) {
  return ageInDays(asOf, now) <= maxAgeDays;
}
