// Record what a piece actually sold for.
//
//   node scripts/record-sale.mjs --brand cdg --venue grailed \
//     --price 700 --currency EUR --estimated 1150 --date 2026-08-31
//
// This is ground truth, and it does two separate jobs.
//
// CALIBRATION, per brand and venue: how this platform's estimates relate to
// what pieces actually fetch. The estimate is recorded as it stood at the time
// rather than recomputed later — the number that mattered is the one that was
// on screen when the decision was made, and re-deriving it against today's
// comps would measure something else entirely.
//
// A COMP, when you say which item sold. This was missing, and its absence was
// the reason the strongest evidence tier sat unreachable: a recorded sale went
// into `realised_sales` and nothing else, so it moved a per-brand ratio and
// never touched the pool the median is drawn from. The platform could hold the
// sentence "this exact coat fetched €700 on Grailed" and still price that coat
// entirely from what other people were asking for it.
//
// That also answers the question of where sold prices come from. Not one API:
// this works for any venue you actually sell on — Grailed, Vestiaire, a shop,
// in person — needs no credentials and no approval, and is the only route that
// exists for the venues whose terms rule out collecting from them at all.
//
//   --item <uuid> is what turns a sale into a comp. Without it the sale is
//   still recorded and still calibrates, because a brand-level ratio does not
//   need to know which piece it was; a comp does, and guessing would pool a
//   price into some other garment's evidence.

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
  --item <uuid>         the item that sold. This is what makes the sale a COMP
                        as well as a calibration point — the strongest evidence
                        the platform can hold about what that piece fetches.
                        --venue must name a configured source for it, since a
                        comp has to come from somewhere.
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

const itemId = flag('item');
const priceBase = Number((price * rate).toFixed(2));

await client.query('begin');

const sale = await client.query(
  `insert into realised_sales
     (item_id, brand_id, venue, sold_price, currency, sold_price_base,
      fx_rate_at_sale, sold_at, estimated_base, condition_tier, notes)
   values ($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10::condition_tier,$11)
   returning id`,
  [
    itemId, brand, venue, price, currency,
    priceBase, rate, soldAt,
    estimated, flag('tier'), flag('notes'),
  ],
);

// The same sale, as a comp on the item that sold.
//
// `listings` is the observation log every valuation reads, and a sale you made
// yourself is the most direct observation there is of what that piece fetches.
// Recording it only in `realised_sales` left it moving a per-brand ratio while
// the item's own median stayed built from what other people were asking.
let comped = false;
if (itemId) {
  const { rows: known } = await client.query(`select id from sources where id = $1`, [venue]);
  if (!known.length) {
    await client.query('rollback');
    console.error(`
  "${venue}" is not a configured source, so the sale cannot be recorded as a comp
  on that item — a comp has to come from somewhere, and the venue is what says
  where. Configure it (npm run add-source, add-feed, add-ebay) and run this
  again, or drop --item to record the sale for calibration only.

  Nothing was written.
`);
    process.exit(1);
  }

  await client.query(
    `insert into listings (
       item_id, source_id, source_item_id, title_raw, price, currency, price_base,
       fx_rate_at_snapshot, condition_tier, status, evidence,
       entered_manually, last_verified_at, date_seen, first_seen_at, notes
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9::condition_tier,
       -- The one status that means a sale, tied to its evidence class by a
       -- database constraint. Reachable here because you were there.
       'sold_confirmed', 'confirmed_sale',
       -- Hand-entered, and verified by the fact that you are the one who sold
       -- it. The schema requires a verification timestamp on a manual row
       -- because the staleness decay is computed from it.
       true, $10::date, $10::date,
       -- No first sighting. A sale says what a piece fetched and never says
       -- when it was listed; inventing one would give it a span running from
       -- today back to the sale, and the venue would read as one where
       -- everything sells the instant it appears.
       null, $11
     )`,
    [
      itemId, venue, `sale:${sale.rows[0].id}`,
      // Named for what it is rather than borrowed from a listing title: this
      // row is a transaction, not a piece of someone's copy.
      `Recorded sale — ${brand} on ${venue}`,
      price, currency, priceBase, rate, flag('tier'),
      soldAt, flag('notes'),
    ],
  );
  comped = true;
}

await client.query('commit');

const { rows } = await client.query(
  `select observations, ratio from calibration where brand_id = $1 and venue = $2`,
  [brand, venue],
);
const c = rows[0];

console.log(`\nRecorded: ${brand} sold on ${venue} for ${price} ${currency}.`);
if (comped) {
  console.log('  Added as a confirmed-sale comp on that item — the strongest evidence there is.');
} else {
  console.log(
    '  Calibration only. Pass --item <uuid> to make it a comp on the piece that sold,\n' +
    '  which is what lifts that item out of resting on asking prices.',
  );
}
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
