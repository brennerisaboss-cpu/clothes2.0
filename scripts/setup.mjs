// One-command setup.
//
//   npm run setup
//
// Checks the database is reachable, applies migrations, seeds the brand
// roster, and tells you exactly what to do next. Safe to re-run — migrations
// and seeds are both idempotent.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const withFixture = process.argv.includes('--fixture');

function run(script, { optional = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(ROOT, 'scripts', script)], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code) => {
      if (code === 0 || optional) return resolve(code === 0);
      reject(new Error(`${script} exited ${code}`));
    });
  });
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(`
DATABASE_URL is not set.

  Local Postgres, if you have Docker:
    docker compose up -d
    echo 'DATABASE_URL=postgresql://postgres:postgres@localhost:5432/clothes' >> .env.local

  Or a hosted one (Supabase, Neon): copy its connection string into .env.local.

Then run npm run setup again.
`);
  process.exit(1);
}

if (!existsSync(join(ROOT, '.env.local'))) {
  console.warn('No .env.local found. Reading configuration from the environment.\n');
}

process.stdout.write('Checking the database … ');
const client = new pg.Client({ connectionString: url });
try {
  await client.connect();
  const { rows } = await client.query('select version()');
  console.log(rows[0].version.split(' ').slice(0, 2).join(' '));
  await client.end();
} catch (err) {
  console.log('unreachable');
  console.error(`
Could not connect: ${err.message}

  If you are using the bundled Postgres:  docker compose up -d
  If it is hosted, check DATABASE_URL and that your IP is allowed.
`);
  process.exit(1);
}

console.log('\nApplying migrations …');
await run('migrate.mjs');

console.log('\nSeeding the brand roster …');
await run('seed.mjs');

if (withFixture) {
  console.log('\nAdding sample data …');
  await run('dev-fixture.mjs');
}

// Identity is derived from listing titles by code that changes, so a pull can
// change what should be one item and what should be two. Existing rows keep
// whatever key they were created with, which means the old pooling survives
// exactly where it was wrong — the listings that prompted a refinement stay
// merged while new ones arrive under new keys and join nothing.
//
// Idempotent: it recomputes every item from its own listings and reports
// "nothing to re-key" when the two already agree, so running it on every setup
// costs a query and keeps the data in step with the code.
console.log('\nChecking item identity …');
await run('rekey-items.mjs', { optional: true });

// Real exchange rates, before anything is compared.
//
// The seed writes placeholders so the conversion path is exercised end to end
// on a machine with no network. They are labelled as placeholders and the
// running app shows a banner while any are in use, because a rate that is a
// few per cent off moves every margin by about the size of the edge being
// looked for. This replaces them with the ECB's published fixing.
//
// Not fatal if it fails: the rest of the platform still works, and the banner
// says plainly that the numbers cannot be trusted yet.
console.log('\nFetching exchange rates …');
const fxOk = await run('fx.mjs', { optional: true });
if (!fxOk) {
  console.warn(
    '  Rates could not be fetched — the app will run on seed placeholders and\n' +
      '  will say so on every page. Run npm run fx once you have network.',
  );
}

const has = (k) => Boolean(process.env[k]);
const optional = [
  ['PROBE_CONTACT', 'shop probe and attention signals', 'any email you are willing to be contacted on'],
  ['YAHOO_APP_ID', 'Yahoo! Shopping', 'https://e.developer.yahoo.co.jp/register'],
  ['RAKUTEN_APP_ID', 'Rakuten Ichiba', 'https://webservice.rakuten.co.jp/'],
  ['EBAY_CLIENT_ID', 'eBay Browse', 'https://developer.ebay.com/'],
  ['DISCORD_WEBHOOK_URL', 'alert delivery', 'a channel → Integrations → Webhooks'],
];

console.log(`
Ready. npm run dev, then http://localhost:3000

Nothing is being collected yet. Each of these pulls data on its own; none
needs anything typed in by hand:

  npm run discover                  independent shops with public feeds — no key
  npm run add-ebay                  the exit venue, without which nothing scores
  npm run add-yahoo                 Japanese secondhand, used goods only
  npm run add-feed -- --preset therealreal
`);

const missing = optional.filter(([k]) => !has(k));
if (missing.length) {
  console.log('Optional, each unlocking one source:\n');
  for (const [key, what, where] of missing) {
    console.log(`  ${key.padEnd(21)} ${what.padEnd(30)} ${where}`);
  }
  console.log('\nSet any of them, then: npm run verify:live\n');
} else {
  console.log('Every credential is set. Run: npm run verify:live\n');
}
