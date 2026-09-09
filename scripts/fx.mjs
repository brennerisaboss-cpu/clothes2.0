// Refresh foreign exchange rates.
//
//   node scripts/fx.mjs
//
// Run this before any poll, and on a schedule. Every score in the platform is
// a difference between two converted prices; a stale rate moves them all the
// same way by about the size of the edge being looked for.
//
// Rates are appended, never overwritten: fx_rates is a log like listings are,
// so a score computed last month can still be explained with the rate that was
// current when it was computed.

import pg from 'pg';
import { collectingUserAgent, NO_CONTACT_WARNING } from '../src/lib/userAgent.mjs';
import { fetchRates, isFresh, ageInDays } from '../src/lib/adapters/fx.mjs';

const BASE = (process.env.BASE_CURRENCY ?? 'EUR').toUpperCase();
// The rates publisher is a public API that asks for no contact.
const { ua: UA, anonymous } = collectingUserAgent();
if (anonymous) console.warn(`\n${NO_CONTACT_WARNING}`);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

// Which currencies actually matter? The ones the configured sources price in,
// plus the ones already present in the listing log. Asking for a fixed list
// would miss a shop added yesterday and waste a request on one removed a year
// ago.
const { rows } = await client.query(
  `select distinct currency from (
     select upper(config->>'currency') as currency from sources where config ? 'currency'
     union
     select currency from listings
   ) c where currency is not null and currency <> $1`,
  [BASE],
);
const currencies = rows.map((r) => r.currency).filter(Boolean);

if (!currencies.length) {
  console.log(`Nothing priced outside ${BASE} yet — no rates needed.`);
  await client.end();
  process.exit(0);
}

/**
 * Repair listings that were recorded while no rate existed.
 *
 * A snapshot taken before the first FX refresh stored a null price_base, and
 * price_base is what every comparison reads — so those rows are invisible to
 * the platform rather than merely imprecise. They stay invisible forever,
 * because price_base is stamped once at insert and a listing whose price never
 * changes is never re-inserted.
 *
 * Runs whether or not the refresh above succeeded, and that is the point. It
 * converts using rates ALREADY IN THE DATABASE and needs no network at all, so
 * gating it behind a successful fetch meant a failed refresh left rows
 * unconverted that the rates on hand could have fixed. The visible symptom was
 * a screen of RealReal listings reading "no FX rate on file" with a perfectly
 * good rate sitting in fx_rates, and an empty opportunities page behind it,
 * because scoring refuses any listing with no base price.
 *
 * The rate chosen is the one fixed nearest the snapshot, preferring one at or
 * before it, rather than today's. Converting an old price at a new rate would
 * turn FX drift into what looks like a price movement, and price movement is
 * exactly the signal this platform reads. Whichever rate is used is written to
 * fx_rate_at_snapshot, so the conversion stays auditable after the fact.
 */
async function backfillUnconverted() {
  const backfill = await client.query(
    `with picked as (
       select l.id,
              (select x.rate
                 from fx_rates x
                where x.base_currency = l.currency and x.quote_currency = $1
                -- Prefer a fixing at or before the snapshot; among those, the
                -- closest. A later rate is used only when nothing earlier exists.
                order by (x.as_of > l.date_seen), abs(extract(epoch from (x.as_of - l.date_seen)))
                limit 1) as rate
         from listings l
        where l.price_base is null
          and l.currency <> $1
          and l.price is not null
     )
     update listings l
        set price_base = round(l.price * picked.rate, 2),
            fx_rate_at_snapshot = picked.rate
       from picked
      where picked.id = l.id
        and picked.rate is not null`,
    [BASE],
  );
  if (backfill.rowCount) {
    console.log(
      `  repaired ${backfill.rowCount} listing${backfill.rowCount === 1 ? '' : 's'} ` +
        `that had no convertible price`,
    );
  }

  // What is still unconvertible, and why. A row left here is invisible to every
  // screen in the platform — it cannot be scored, ranked or compared — and
  // nothing else says so.
  const { rows: stuck } = await client.query(
    `select l.currency, count(*)::int as n
       from listings l
      where l.price_base is null and l.currency <> $1 and l.price is not null
      group by l.currency order by n desc`,
    [BASE],
  );
  for (const row of stuck) {
    console.warn(
      `  ${row.n} listing${row.n === 1 ? '' : 's'} in ${row.currency} still ${row.n === 1 ? 'has' : 'have'} no base price ` +
        `— there is no ${row.currency}->${BASE} rate on file at all, so they cannot be scored.`,
    );
  }
}

const result = await fetchRates({ baseCurrency: BASE, currencies, userAgent: UA });

if (!result.ok) {
  // Failing loudly matters more here than anywhere else in the system. A poll
  // that fails leaves a source un-updated and visibly stale; an FX refresh that
  // fails silently leaves every number looking exactly as trustworthy as
  // before while being wrong.
  console.error(`FX refresh FAILED — ${result.error}`);
  console.error(`Rates in the database are unchanged. Do not trust scores until this succeeds.`);
  // Repair what the rates already on hand can repair, even so. This needs no
  // network, and skipping it left listings unconvertible — and therefore
  // unscoreable, and therefore absent from /opportunities — for want of a
  // fetch that had nothing to do with them.
  await backfillUnconverted();
  await client.end();
  process.exit(1);
}

for (const r of result.listings) {
  await client.query(
    `insert into fx_rates (base_currency, quote_currency, rate, as_of, source)
     values ($1, $2, $3, $4::date, 'ecb_via_frankfurter')
     on conflict (base_currency, quote_currency, as_of) do update set rate = excluded.rate`,
    [r.from, r.to, r.rate, r.asOf],
  );
}

const asOf = result.listings[0]?.asOf;
const age = asOf ? ageInDays(asOf) : Infinity;
console.log(
  `${result.listings.length} rate${result.listings.length === 1 ? '' : 's'} into ${BASE}, ` +
    `fixed ${asOf} (${age < 1 ? 'today' : `${Math.floor(age)}d ago`})`,
);
for (const r of result.listings) {
  console.log(`  1 ${r.from} = ${r.rate.toPrecision(6)} ${r.to}`);
}
if (result.note) console.warn(`  note: ${result.note}`);
if (asOf && !isFresh(asOf)) {
  console.warn(`  the publisher's own fixing is ${Math.floor(age)} days old — check for a market holiday`);
}

// Any placeholder rows still lying around are now superseded by dated, sourced
// ones. Leaving them in the log would mean a later query could pick one up.
const { rowCount } = await client.query(`delete from fx_rates where source = 'placeholder_seed'`);
if (rowCount) console.log(`  cleared ${rowCount} placeholder rate${rowCount === 1 ? '' : 's'}`);

await backfillUnconverted();

await client.end();
