// What a route actually costs you.
//
//   npm run route-costs                          list every route and its stack
//   npm run route-costs -- --route jp_to_grailed --sale-fee 0.09 --confirm
//
// The seeded numbers are guesses. They were written to exercise the arithmetic
// and they say so, but on a €600 piece the difference between a guessed 12%
// duty and the real rate is larger than most of what the opportunities screen
// sorts on — so until a human has checked a route, every margin computed
// through it carries a flag saying the deductions are estimates.
//
// This is how that flag goes away: put your real numbers in, and confirm them.
// `--confirm` on its own confirms the stack as it stands, for the case where
// the seeded numbers turn out to be right.
//
// Where the real numbers come from:
//
//   sale fee        the exit venue's own fee schedule, at YOUR seller level
//   payment fee     usually folded into the above; check whether it is
//   proxy fee       your proxy service's published commission, plus its flat
//   shipping        one real quote for a coat-sized parcel on that leg
//   duty            your customs authority's tariff for the material — apparel
//                   is not one rate, and leather, fur and silk are not wool
//   import VAT      your country's standard rate, charged on item + shipping
//                   + duty, not on the item alone

import pg from 'pg';

const argv = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const has = (n) => argv.includes(`--${n}`);

// Percentages are stored as fractions. Accepting "9" and "0.09" and guessing
// which was meant is how a 9% fee becomes a 900% one, so they are only ever
// fractions here and the script refuses anything above 1.
const FIELDS = [
  ['proxy-fee', 'proxy_fee_pct', 'pct'],
  ['proxy-flat', 'proxy_fee_flat', 'money'],
  ['domestic-ship', 'domestic_ship_flat', 'money'],
  ['intl-ship', 'intl_ship_flat', 'money'],
  ['import-vat', 'import_vat_pct', 'pct'],
  ['duty', 'customs_duty_pct', 'pct'],
  ['sale-fee', 'sale_fee_pct', 'pct'],
  ['payment-fee', 'payment_fee_pct', 'pct'],
  ['outbound-ship', 'outbound_ship_flat', 'money'],
];

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const routeId = flag('route');

if (!routeId) {
  const { rows } = await client.query(
    `select r.*, (select count(*) from listings l
                    where l.source_id = r.acquisition_source)::int as candidates
       from routes r order by r.costs_confirmed_at nulls first, r.id`,
  );
  if (!rows.length) {
    console.log('\nNo routes configured. `npm run discover` creates them for what it finds.\n');
    process.exit(0);
  }

  const pct = (v) => `${(Number(v) * 100).toFixed(1)}%`;
  console.log('');
  for (const r of rows) {
    const state = r.costs_confirmed_at
      ? `confirmed ${new Date(r.costs_confirmed_at).toISOString().slice(0, 10)}`
      : 'SEEDED GUESS — every margin through it is flagged';
    console.log(`${r.id}   ${r.display_name}`);
    console.log(`  ${state}`);
    console.log(
      `  buying:  proxy ${pct(r.proxy_fee_pct)} + ${r.proxy_fee_flat}, ` +
        `ship ${r.domestic_ship_flat} + ${r.intl_ship_flat}, ` +
        `duty ${pct(r.customs_duty_pct)}, VAT ${pct(r.import_vat_pct)}`,
    );
    console.log(
      `  selling: fee ${pct(r.sale_fee_pct)}, payment ${pct(r.payment_fee_pct)}, ` +
        `ship ${r.outbound_ship_flat}`,
    );
    if (r.notes) console.log(`  ${r.notes}`);
    console.log('');
  }
  console.log('To correct one:\n');
  console.log('  npm run route-costs -- --route <id> --sale-fee 0.09 --duty 0.04 --confirm\n');
  console.log('Percentages are fractions: 0.09 is nine percent.\n');
  await client.end();
  process.exit(0);
}

const { rows: existing } = await client.query('select * from routes where id = $1', [routeId]);
if (!existing[0]) {
  console.error(`\nNo route "${routeId}". Run npm run route-costs with no arguments to list them.\n`);
  process.exit(1);
}

const sets = [];
const params = [routeId];
for (const [name, column, kind] of FIELDS) {
  const given = flag(name);
  if (given == null) continue;
  const value = Number(given);
  if (!Number.isFinite(value) || value < 0) {
    console.error(`--${name} must be a number, got "${given}"`);
    process.exit(1);
  }
  if (kind === 'pct' && value > 1) {
    console.error(
      `--${name} is a fraction, so nine percent is 0.09, not 9. Refusing ${value}, ` +
        'which would be a 900% fee and would quietly invert every margin on this route.',
    );
    process.exit(1);
  }
  params.push(value);
  sets.push(`${column} = $${params.length}`);
}

const confirm = has('confirm');
if (!sets.length && !confirm) {
  console.error('\nNothing to change. Pass some values, or --confirm to accept the stack as it stands.\n');
  process.exit(1);
}

sets.push(confirm ? 'costs_confirmed_at = now()' : 'costs_confirmed_at = null');
if (flag('notes')) {
  params.push(flag('notes'));
  sets.push(`notes = $${params.length}`);
}

const { rows } = await client.query(
  `update routes set ${sets.join(', ')}, updated_at = now() where id = $1 returning *`,
  params,
);

const r = rows[0];
console.log(`\n${r.id}: updated.`);
if (confirm) {
  console.log('Costs confirmed. Margins through this route no longer carry the estimate flag.\n');
} else {
  // Changing numbers without confirming them leaves the flag on, deliberately:
  // a half-corrected stack is still an unchecked one.
  console.log('Left unconfirmed. Add --confirm once the numbers are checked.\n');
}

await client.end();
