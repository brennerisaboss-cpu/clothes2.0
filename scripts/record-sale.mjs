// Record what a piece actually sold for.
//
//   node scripts/record-sale.mjs --brand cdg --venue grailed \
//     --price 700 --currency EUR --estimated 1150 --date 2026-08-31
//
// This is the ground truth the whole calibration rests on. Without it the
// platform can only tell you what pieces are ASKED for; with it, it learns how
// its own estimates relate to what they FETCH, per brand and venue.
//
// The estimate is recorded as it stood at the time rather than recomputed
// later: the number that mattered is the one that was on screen when the
// decision was made, and re-deriving it against today's comps would measure
// something else entirely.

import pg from 'pg';

const argv = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

const brand = flag('brand');
const venue = flag('venue');
const price = Number(flag('price'));
const currency = flag('currency', 'EUR')?.toUpperCase();
const estimated = flag('estimated') ? Number(flag('estimated')) : null;
const soldAt = flag('date') ?? new Date().toISOString().slice(0, 10);

if (!brand || !venue || !Number.isFinite(price) || price <= 0) {
  console.error(`
Usage: node scripts/record-sale.mjs --brand <id> --venue <source id> --price <n> [options]

  --currency EUR        default EUR
  --estimated 1150      what this platform predicted at the time, in base
                        currency. Without it the sale is stored but cannot
                        contribute to calibration — the ratio needs both halves.
  --date 2026-08-31     default today
  --item <uuid>         link it to an item, if you know which
  --tier excellent      condition tier
  --notes "..."

Three sales for a brand and venue are needed before anything is corrected.
`);
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const base = (process.env.BASE_CURRENCY ?? 'EUR').toUpperCase();
let rate = 1;
if (currency !== base) {
  const { rows } = await client.query(
    `select rate from fx_rates where base_currency = $1 and quote_currency = $2
      order by abs(extract(epoch from (as_of - $3::date))) limit 1`,
    [currency, base, soldAt],
  );
  if (!rows[0]) {
    console.error(`No ${currency}->${base} rate on file. Run npm run fx first.`);
    process.exit(1);
  }
  // The rate nearest the sale date, not today's: converting an old sale at a
  // new rate would fold FX drift into the calibration ratio.
  rate = Number(rows[0].rate);
}

await client.query(
  `insert into realised_sales
     (item_id, brand_id, venue, sold_price, currency, sold_price_base,
      fx_rate_at_sale, sold_at, estimated_base, condition_tier, notes)
   values ($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10::condition_tier,$11)`,
  [
    flag('item'), brand, venue, price, currency,
    Number((price * rate).toFixed(2)), rate, soldAt,
    estimated, flag('tier'), flag('notes'),
  ],
);

const { rows } = await client.query(
  `select observations, ratio from calibration where brand_id = $1 and venue = $2`,
  [brand, venue],
);
const c = rows[0];

console.log(`\nRecorded: ${brand} sold on ${venue} for ${price} ${currency}.`);
if (!c) {
  console.log(`  No calibration yet — an estimate must be recorded alongside the sale.\n`);
} else if (c.observations < 3) {
  console.log(`  ${c.observations} sale${c.observations === 1 ? '' : 's'} on file. Three are needed before estimates are corrected.\n`);
} else {
  console.log(
    `  ${c.observations} sales: this brand fetches ${Number(c.ratio).toFixed(2)}x its estimate on ${venue}.\n`,
  );
}

await client.end();
