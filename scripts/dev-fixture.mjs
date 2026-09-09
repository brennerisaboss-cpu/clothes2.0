// Development fixture. Opt-in, never run by migrate or seed.
//
//   node scripts/dev-fixture.mjs
//
// Creates a spread of listings that exercises the phase-2 model: several comps
// in one condition tier for one item, a thinner tier that must report
// "insufficient data", a superseded re-price, a delisting, and an ambiguous
// title that must stay unmatched.

import pg from 'pg';
import { planMatch } from '../src/lib/matching.mjs';

const HP = 'Comme des Garcons Homme Plus AD2002 wool tailored jacket';

const days = (n) => new Date(Date.now() - n * 86_400_000);

// Acquisition side: venues the operator BUYS from. Under the real pipeline
// that is The RealReal and Japanese sites (via the proxy catch-all), never
// Grailed or Vestiaire — those are where pieces are sold.
const ROWS = [
  // Japan, cheap: the route where the proxy/VAT stack decides whether it works.
  { title: HP, price: 52000, cur: 'JPY', tier: 'excellent', raw: null, src: 'manual_other', age: 3, size: 'M' },
  { title: HP, price: 61000, cur: 'JPY', tier: 'excellent', raw: null, src: 'manual_other', age: 12, size: 'L' },
  // The RealReal: domestic-ish, no proxy leg.
  { title: HP, price: 480, cur: 'EUR', tier: 'excellent', raw: 'Excellent', src: 'therealreal', age: 21, size: 'M' },
  { title: HP, price: 545, cur: 'EUR', tier: 'excellent', raw: 'Excellent', src: 'therealreal', age: 40, size: 'M' },
  // A 'good' piece: must be valued against 'good' exit comps, never 'excellent'.
  { title: HP, price: 390, cur: 'EUR', tier: 'good', raw: 'Very Good', src: 'therealreal', age: 8, size: 'M' },
  // A different AD year: a separate item by design, never pooled with above.
  { title: 'Comme des Garcons Homme Plus AD1995 wool tailored jacket', price: 890, cur: 'EUR', tier: 'excellent', raw: 'Excellent', src: 'therealreal', age: 6, size: 'M' },
  // Ambiguous by name — stays unmatched for manual resolution.
  { title: 'CDG wool trousers black', price: 18000, cur: 'JPY', tier: 'good', raw: null, src: 'manual_other', age: 2, size: '3' },
  // Excluded sub-line — recognised, deliberately not monitored.
  { title: 'Comme des Garcons Play red heart cardigan', price: 210, cur: 'EUR', tier: 'good', raw: 'Good', src: 'therealreal', age: 4, size: 'M' },
];

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

// Idempotent, so `npm run setup:demo` twice is not a trap.
//
// Every fixture row carries an example.invalid URL. That TLD is reserved by
// RFC 2606 and can never resolve, so this identifies fixture rows exactly and
// cannot match anything genuinely observed or hand-entered. Without it a
// second run doubles every listing, and a doubled listing becomes a duplicate
// opportunity card and a doubled comp — the comp set is what resale value is
// computed from, so the fixture would quietly corrupt its own valuations.
const cleared = await client.query(
  `delete from listings where url like 'https://example.invalid/%'`,
);
if (cleared.rowCount) console.log(`fixture: cleared ${cleared.rowCount} rows from a previous run`);

async function rate(cur) {
  if (cur === (process.env.BASE_CURRENCY ?? 'EUR')) return 1;
  const r = await client.query(
    `select rate from fx_rates where base_currency = $1 and quote_currency = $2
     order by as_of desc limit 1`,
    [cur, process.env.BASE_CURRENCY ?? 'EUR'],
  );
  return r.rows[0] ? Number(r.rows[0].rate) : null;
}

async function findOrCreateItem({ brandId, sublineId, adYear, adYearStatus, canonicalName, identityKey }) {
  const brand = brandId ?? (
    await client.query('select brand_id from sublines where id = $1', [sublineId])
  ).rows[0]?.brand_id;
  if (!brand) throw new Error(`no brand for sub-line ${sublineId}`);

  // Keyed on identity, exactly as the app is: the fixture must exercise the
  // same pooling the real paths use, or it proves nothing about them.
  const made = await client.query(
    `insert into items (brand_id, subline_id, canonical_name, ad_year, ad_year_status,
                        ad_year_basis, identity_key)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (identity_key) do update set identity_key = excluded.identity_key
     returning id`,
    [
      brand, sublineId, canonicalName, adYear, adYearStatus,
      // A year and where it came from travel together, by constraint. The
      // fixture's years are written as AD tags, which is what they are.
      adYear == null ? null : 'ad_tag',
      identityKey,
    ],
  );
  return made.rows[0].id;
}

let created = 0;
let unmatched = 0;

for (const r of ROWS) {
  const plan = planMatch({ title_raw: r.title });
  const itemId =
    plan.matchable && plan.sublineId
      ? await findOrCreateItem({
          brandId: plan.resolved?.brandId,
          sublineId: plan.sublineId,
          adYear: plan.adYear ?? null,
          adYearStatus: plan.adYearStatus ?? 'unknown',
          canonicalName: plan.canonicalName ?? r.title,
          identityKey: plan.key,
        })
      : null;
  if (!itemId) unmatched++;

  const fx = await rate(r.cur);
  const seen = days(r.age);
  await client.query(
    `insert into listings (
       item_id, source_id, title_raw, size_raw, size_region,
       condition_raw, condition_tier, price, currency, price_base, fx_rate_at_snapshot,
       url, date_seen, image_url, status, evidence, entered_manually, last_verified_at, first_seen_at
     ) values ($1,$2,$3,$4,$5,$6,$7::condition_tier,$8,$9,$10,$11,$12,$13,$14,'active','active_ask',true,$13,$13)`,
    [
      itemId, r.src, r.title, r.size, r.cur === 'JPY' ? 'JP' : 'EU',
      r.raw, r.tier, r.price, r.cur,
      fx == null ? null : Number((r.price * fx).toFixed(2)), fx,
      `https://example.invalid/${encodeURIComponent(r.title).slice(0, 40)}-${r.age}`,
      seen,
      // Placeholder host: the reverse-image links are built from whatever URL
      // the source gives us, so the shape matters more than the pixels here.
      `https://images.example.invalid/${r.src}/${r.age}.jpg`,
    ],
  );
  created++;
}

console.log(`fixture: ${created} listings inserted, ${unmatched} left unmatched by design`);

// --- Exit-market comps -------------------------------------------------------
//
// Without these, nothing is scoreable: resale value is estimated from exit
// venues only. These represent the same AD2002 Homme Plus jacket as it appears
// where the piece is SOLD (Grailed), against the acquisition-side rows above.
const EXIT_ROWS = [
  { title: HP, price: 1150, cur: 'EUR', tier: 'excellent', raw: 'Gently Used', src: 'grailed', age: 4, size: 'M' },
  { title: HP, price: 1290, cur: 'EUR', tier: 'excellent', raw: 'Gently Used', src: 'grailed', age: 11, size: 'M' },
  { title: HP, price: 1080, cur: 'EUR', tier: 'excellent', raw: 'Gently Used', src: 'grailed', age: 19, size: 'L' },
  { title: HP, price: 1210, cur: 'EUR', tier: 'excellent', raw: 'Gently Used', src: 'grailed', age: 33, size: 'M' },
  { title: HP, price: 760, cur: 'EUR', tier: 'good', raw: 'Used', src: 'grailed', age: 9, size: 'M' },
];

for (const r of EXIT_ROWS) {
  const plan = planMatch({ title_raw: r.title });
  const itemId = plan.matchable && plan.sublineId
    ? await findOrCreateItem({
        brandId: plan.resolved?.brandId,
        sublineId: plan.sublineId,
        adYear: plan.adYear ?? null,
        adYearStatus: plan.adYearStatus ?? 'unknown',
        canonicalName: plan.canonicalName ?? r.title,
        identityKey: plan.key,
      })
    : null;
  const fx = await rate(r.cur);
  const seen = days(r.age);
  await client.query(
    `insert into listings (
       item_id, source_id, title_raw, size_raw, size_region,
       condition_raw, condition_tier, price, currency, price_base, fx_rate_at_snapshot,
       url, date_seen, image_url, status, evidence, entered_manually, last_verified_at, first_seen_at
     ) values ($1,$2,$3,$4,'EU',$5,$6::condition_tier,$7,$8,$9,$10,$11,$12,$13,'active','active_ask',true,$12,$12)`,
    [
      itemId, r.src, r.title, r.size, r.raw, r.tier, r.price, r.cur,
      fx == null ? null : Number((r.price * fx).toFixed(2)), fx,
      `https://example.invalid/exit-${r.age}`, seen,
      `https://images.example.invalid/${r.src}/${r.age}.jpg`,
    ],
  );
}
console.log(`fixture: ${EXIT_ROWS.length} exit-market comps inserted`);

await client.end();
