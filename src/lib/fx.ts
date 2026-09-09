import { query, one } from './db';

export const BASE_CURRENCY = (process.env.BASE_CURRENCY ?? 'EUR').toUpperCase();

type RateRow = { rate: number; as_of: Date; source: string | null };

/**
 * Look up the rate to convert `from` into the base currency.
 *
 * Returns the rate AND the timestamp it was recorded at, because a converted
 * price is only meaningful alongside the rate that produced it. Callers must
 * store both on the listing row — never reconvert historical rows at today's
 * rate, which would turn FX drift into what looks like a price movement.
 */
export async function rateToBase(
  from: string,
): Promise<{ rate: number; asOf: Date; source: string | null } | null> {
  const currency = from.toUpperCase();
  if (currency === BASE_CURRENCY) {
    return { rate: 1, asOf: new Date(), source: 'identity' };
  }

  const row = await one<RateRow>(
    `select rate, as_of, source
       from fx_rates
      where base_currency = $1 and quote_currency = $2
      order by as_of desc
      limit 1`,
    [currency, BASE_CURRENCY],
  );

  return row ? { rate: Number(row.rate), asOf: row.as_of, source: row.source } : null;
}

/**
 * Convert to base currency, returning the rate used alongside the amount.
 * A missing rate yields nulls rather than an unconverted number, so a price
 * can never be silently treated as if it were already in the base currency.
 */
export async function toBase(amount: number, currency: string) {
  const fx = await rateToBase(currency);
  if (!fx) return { priceBase: null, rate: null, asOf: null, source: null };
  return {
    priceBase: Number((amount * fx.rate).toFixed(2)),
    rate: fx.rate,
    asOf: fx.asOf,
    source: fx.source,
  };
}

export async function listRates() {
  return query<{ quote: string; base: string; rate: number; as_of: Date; source: string | null }>(
    `select distinct on (base_currency)
            base_currency as base, quote_currency as quote, rate, as_of, source
       from fx_rates
      where quote_currency = $1
      order by base_currency, as_of desc`,
    [BASE_CURRENCY],
  );
}

/**
 * Is the conversion layer trustworthy right now?
 *
 * Every comparison this platform makes crosses a currency, so an unnoticed FX
 * problem is the one failure that corrupts every number at once while looking
 * completely normal. Two things make a rate untrustworthy:
 *
 *   * It is a placeholder from the seed, never observed from a publisher.
 *   * It is a real fixing that has gone stale because the refresh stopped.
 *
 * The ECB fixes on working days only, so up to four days old is healthy, not
 * stale — a Friday rate read on a Monday morning is the normal case.
 */
export async function fxHealth() {
  const rates = await listRates();
  const now = Date.now();

  const aged = rates.map((r) => ({
    ...r,
    rate: Number(r.rate),
    ageDays: (now - new Date(r.as_of).getTime()) / 86_400_000,
    placeholder: r.source === 'placeholder_seed',
  }));

  const placeholders = aged.filter((r) => r.placeholder);
  const stale = aged.filter((r) => !r.placeholder && r.ageDays > 4);

  // Which currencies are priced in the log but have no rate at all? Those
  // listings carry a null price_base and drop out of every comparison — a
  // silent absence, which is why it is named here rather than left to be
  // noticed as a lower count.
  const uncovered = await query<{ currency: string }>(
    `select distinct l.currency
       from listings l
      where l.currency <> $1
        and not exists (
          select 1 from fx_rates f
           where f.base_currency = l.currency and f.quote_currency = $1
        )
      order by 1`,
    [BASE_CURRENCY],
  );

  return {
    base: BASE_CURRENCY,
    rates: aged,
    placeholders,
    stale,
    uncovered: uncovered.map((r) => r.currency),
    healthy: placeholders.length === 0 && stale.length === 0 && uncovered.length === 0,
  };
}
