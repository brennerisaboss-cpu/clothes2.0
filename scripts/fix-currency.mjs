// Correct a source's currency, and repair the prices it already stored.
//
//   node scripts/fix-currency.mjs --source archive_store --currency EUR
//   node scripts/fix-currency.mjs --check
//
// A wrong currency is not a display problem. price_base is computed once, at
// insert, from the currency believed at the time — so every listing that source
// ever wrote is wrong by the ratio between the two currencies, and stays wrong,
// because a listing whose price never changes is never re-inserted.
//
// Correcting the source alone would therefore fix nothing visible. This
// recomputes every affected snapshot as well, using the rate nearest each
// snapshot's own date rather than today's: converting an old price at a new
// rate would fold FX drift into what looks like a price movement, and price
// movement is the signal this platform reads.

import pg from 'pg';
import { assessCatalogue } from '../src/lib/plausibility.mjs';

const argv = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

const BASE = (process.env.BASE_CURRENCY ?? 'EUR').toUpperCase();
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

// --- --check: which sources look wrong? -------------------------------------
if (argv.includes('--check') || (!flag('source') && !flag('currency'))) {
  const { rows } = await client.query(
    `select s.id, s.display_name, s.config->>'currency' as currency,
            count(l.id)::int as listings,
            array_agg(l.price_base) filter (where l.price_base is not null) as prices
       from sources s
       left join listings l on l.source_id = s.id and l.status = 'active'
      where s.tier = 'feed'
      group by s.id, s.display_name, s.config->>'currency'
      order by s.id`,
  );

  console.log('');
  let suspect = 0;
  for (const r of rows) {
    const check = assessCatalogue((r.prices ?? []).map(Number), { currency: r.currency });
    const label = `${r.id} (${r.currency ?? '?'})`.padEnd(34);
    if (check.verdict === 'implausible') {
      suspect++;
      console.log(`  SUSPECT ${label} median ${BASE} ${check.median?.toFixed(2)} — ${check.reason}`);
    } else if (check.verdict === 'unknown') {
      console.log(`  ?       ${label} ${check.reason}`);
    } else {
      console.log(`  ok      ${label} median ${BASE} ${check.median?.toFixed(2)} across ${check.sample}`);
    }
  }
  console.log(
    suspect
      ? `\n  ${suspect} source${suspect === 1 ? '' : 's'} look wrong. Fix one with:\n` +
        `      npm run fix-currency -- --source <id> --currency XXX\n`
      : `\n  Nothing looks mis-denominated.\n`,
  );
  await client.end();
  process.exit(0);
}

// --- correcting one source ---------------------------------------------------
const sourceId = flag('source');
const currency = flag('currency')?.toUpperCase();

if (!sourceId || !currency || !/^[A-Z]{3}$/.test(currency)) {
  console.error(`
Usage: node scripts/fix-currency.mjs --source <id> --currency EUR
       node scripts/fix-currency.mjs --check     (list sources whose prices look wrong)
`);
  process.exit(1);
}

const { rows: found } = await client.query(
  `select id, display_name, config->>'currency' as currency from sources where id = $1`,
  [sourceId],
);
if (!found[0]) {
  console.error(`No source "${sourceId}".`);
  process.exit(1);
}
const was = found[0].currency;

await client.query(
  `update sources set config = jsonb_set(config, '{currency}', to_jsonb($2::text)) where id = $1`,
  [sourceId, currency],
);

// Re-denominate and re-convert every snapshot this source wrote. The stored
// `price` was always correct — only the currency attached to it was wrong.
const { rowCount } = await client.query(
  `with picked as (
     select l.id, l.price,
            (select x.rate from fx_rates x
              where x.base_currency = $2 and x.quote_currency = $3
              -- The rate nearest this snapshot, preferring one at or before it.
              order by (x.as_of > l.date_seen), abs(extract(epoch from (x.as_of - l.date_seen)))
              limit 1) as rate
       from listings l
      where l.source_id = $1
   )
   update listings l
      set currency = $2,
          price_base = case when $2 = $3 then round(l.price, 2)
                            else round(l.price * picked.rate, 2) end,
          fx_rate_at_snapshot = case when $2 = $3 then 1 else picked.rate end
     from picked
    where picked.id = l.id
      and ($2 = $3 or picked.rate is not null)`,
  [sourceId, currency, BASE],
);

const { rows: after } = await client.query(
  `select array_agg(price_base) as prices from listings
    where source_id = $1 and status = 'active' and price_base is not null`,
  [sourceId],
);
const check = assessCatalogue((after[0]?.prices ?? []).map(Number), { currency });

console.log(
  `\n${found[0].display_name}: ${was ?? 'unset'} → ${currency}\n` +
    `  ${rowCount} listing${rowCount === 1 ? '' : 's'} re-converted.\n` +
    (check.median != null ? `  Median now ${BASE} ${check.median.toFixed(2)} — ${check.verdict}.\n` : ''),
);
if (check.verdict === 'implausible') {
  console.log(`  Still implausible: ${check.reason}\n`);
}
await client.end();
