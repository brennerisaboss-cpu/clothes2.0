// Turn a shop into a polled source.
//
//   node scripts/add-source.mjs --domain shop.example --currency JPY [options]
//
//     --name "Display Name"     defaults to the domain
//     --id my_shop              defaults to a slug of the domain
//     --role acquisition|exit|both      default acquisition
//     --every 720               poll interval in minutes, default 720
//     --dry-run                 check everything, write nothing
//
// This is the last link in the chain: probe-shops finds candidates, this makes
// one of them real, and poll.mjs then reads it every cycle.
//
// It refuses more than it accepts, on purpose. A source added wrongly does not
// error — it quietly produces prices that are off by a currency factor, or
// fetches paths the shop asked nobody to fetch. So before writing a row it
// re-verifies, live:
//
//   1. robots.txt allows /products.json for our User-Agent. Checked now, not
//      trusted from a probe run weeks ago, and re-checked on every poll.
//   2. The feed exists, parses, and contains products.
//   3. A currency was stated explicitly. Never inferred from the TLD — a
//      .jp shop billing in USD would put every price out by ~150x.
//
// The RealReal, Vestiaire and Grailed can never be added here: they are
// manual-tier by terms, and the schema refuses to mark a manual source
// automatable regardless of what is passed in.

import pg from 'pg';
import { parseRobots, isAllowed } from '../src/lib/robots.mjs';
import * as shopify from '../src/lib/adapters/shopify.mjs';

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const domain = flag('domain');
// Override the origin the feed is read from. Exists so this path can be
// exercised end to end against a local server; a real shop never needs it.
const base = flag('base') ?? (domain ? `https://${domain}` : null);
const currency = flag('currency')?.toUpperCase();
const dryRun = has('dry-run');

if (!domain || !currency) {
  console.error(`
Usage: node scripts/add-source.mjs --domain shop.example --currency JPY

  --name "Display Name"   defaults to the domain
  --id my_shop            defaults to a slug of the domain
  --role acquisition|exit|both     default acquisition
  --every 720             poll interval in minutes, default 720
  --dry-run               verify only, write nothing

Currency is required and never guessed. Check what the shop actually bills in.
`);
  process.exit(1);
}

if (!/^[A-Z]{3}$/.test(currency)) {
  console.error(`"${currency}" is not an ISO 4217 code.`);
  process.exit(1);
}

const BLOCKED = ['grailed.com', 'vestiairecollective.com', 'therealreal.com'];
if (BLOCKED.some((b) => domain.endsWith(b))) {
  console.error(
    `${domain} is manual-tier permanently — its terms prohibit automated access.\n` +
      `Enter its listings by hand on /add.`,
  );
  process.exit(1);
}

const id = flag('id') ?? domain.replace(/^www\./, '').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
const name = flag('name') ?? domain;
const role = flag('role', 'acquisition');
const every = Number(flag('every', '720'));

if (!['acquisition', 'exit', 'both'].includes(role)) {
  console.error(`--role must be acquisition, exit or both.`);
  process.exit(1);
}
if (!Number.isFinite(every) || every < 15) {
  console.error(`--every must be at least 15 minutes. Polling a small shop faster than it changes is rude and pointless.`);
  process.exit(1);
}

const CONTACT = process.env.PROBE_CONTACT;
if (!CONTACT) {
  console.error(
    `PROBE_CONTACT is not set.\n\n` +
      `A shop owner who notices these requests should be able to find out who is\n` +
      `making them and ask you to stop. Set it to an email you read.`,
  );
  process.exit(1);
}
const UA = `resale-tracker/0.1 (personal price tracker; ${CONTACT})`;

// ---- 1. robots.txt, live ----------------------------------------------------
console.log(`\nChecking ${base}/robots.txt …`);
let groups;
try {
  const res = await fetch(`${base}/robots.txt`, {
    headers: { 'user-agent': UA, accept: 'text/plain' },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 200) groups = parseRobots(await res.text());
  else if (res.status === 404) groups = [];
  else {
    // Anything other than "here are the rules" or "there are none" is treated
    // as do-not-fetch. Guessing in the permissive direction is the one mistake
    // that cannot be taken back.
    console.error(`  robots.txt returned ${res.status} — treating as do-not-fetch. Not added.`);
    process.exit(1);
  }
} catch (err) {
  console.error(`  robots.txt unreachable (${err?.message ?? err}). Not added.`);
  process.exit(1);
}

const verdict = isAllowed(groups, '/products.json', UA);
if (!verdict) {
  console.error(
    `  robots.txt disallows /products.json for this User-Agent.\n\n` +
      `  That is the shop's answer, and it is the end of it. If you want their\n` +
      `  data, ask them — or keep the shop in the manual tier and enter pieces\n` +
      `  by hand. Not added.`,
  );
  process.exit(1);
}
console.log(`  allowed`);

// ---- 2. The feed itself -----------------------------------------------------
console.log(`Fetching the product feed …`);
const probe = await shopify.fetchListings(
  { domain, base, currency, userAgent: UA, maxPages: 1 },
  {},
);
if (!probe.ok) {
  console.error(`  no usable feed — ${probe.error}\n\n  Not added. A shop without a feed belongs in the manual tier.`);
  process.exit(1);
}
if (!probe.listings.length) {
  console.error(`  the feed parsed but was empty. Not added — check the domain.`);
  process.exit(1);
}
console.log(`  ${probe.listings.length} products on the first page`);

// Show what was actually parsed. A currency mistake is invisible in a count and
// obvious in a price, so print prices and let the operator sanity-check them.
console.log(`\n  Sample of what would be ingested:`);
for (const l of probe.listings.slice(0, 3)) {
  console.log(`    ${String(l.price).padStart(9)} ${currency}  ${l.brandRaw ? `[${l.brandRaw}] ` : ''}${l.title.slice(0, 60)}`);
}
console.log(`\n  Do those prices look right for ${currency}? If not, stop and check the shop.`);

if (dryRun) {
  console.log(`\n--dry-run: nothing written.\n`);
  process.exit(0);
}

// ---- 3. Write the row -------------------------------------------------------
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const { rows } = await client.query(
  `insert into sources
     (id, display_name, tier, role, automation_allowed, base_url,
      permission_status, poll_interval_minutes, config)
   values ($1, $2, 'feed', $3, true, $4, 'not_asked', $5,
           jsonb_build_object('adapter', 'shopify', 'domain', $6::text, 'currency', $7::text)
           -- Only record an explicit base when it differs from the domain, so
           -- an ordinary shop's config stays two obvious keys.
           || case when $4::text = 'https://' || $6::text then '{}'::jsonb
                   else jsonb_build_object('base', $4::text) end)
   on conflict (id) do update set
     display_name = excluded.display_name,
     role = excluded.role,
     base_url = excluded.base_url,
     poll_interval_minutes = excluded.poll_interval_minutes,
     config = excluded.config
   returning id, role, poll_interval_minutes`,
  [id, name, role, base, every, domain, currency],
);

const row = rows[0];
console.log(
  `\nAdded "${row.id}" — ${role}, ${currency}, every ${row.poll_interval_minutes} minutes.\n\n` +
    `  npm run poll -- --source ${row.id}\n`,
);

// A source with no route reaches no exit venue, so it produces listings that
// can never be scored — visible in the grid, absent from every opportunity.
// Worth saying now rather than being discovered as an empty table.
if (role !== 'exit') {
  const { rows: routes } = await client.query(
    `select count(*)::int as n from routes where acquisition_source = $1`,
    [row.id],
  );
  if (!routes[0].n) {
    console.log(
      `  No route yet from ${row.id} to an exit venue, so its listings will show\n` +
        `  in the grid but score nothing. Add one on /sources.\n`,
    );
  }
}

await client.end();
