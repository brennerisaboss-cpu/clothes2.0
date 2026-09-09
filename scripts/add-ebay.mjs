// Configure eBay as a source, one search per monitored house.
//
//   node scripts/add-ebay.mjs [--marketplace EBAY_GB] [--currency GBP]
//
// eBay matters here for a reason no other reachable venue covers: it is a
// genuine EXIT venue for this market, and exit comps are what resale value is
// computed from. Without one, listings aggregate into a table that cannot be
// scored — which is exactly the state this platform was in.
//
// One source per house rather than one broad search: eBay ranks and truncates
// results, so a single query for "archive designer" returns whatever it feels
// like, while "Yohji Yamamoto" returns Yohji. It also lets a house that turns
// over quickly be polled more often than one that does not.
//
// Needs a free eBay developer key. Five minutes at developer.ebay.com:
// register, create an application, take the Client ID and Client Secret from
// its production keyset, and put them in .env.local as EBAY_CLIENT_ID and
// EBAY_CLIENT_SECRET.
//
// Note what this does NOT give you: the Browse API returns ACTIVE listings —
// asks, not sold prices. Sold data needs eBay's Marketplace Insights API,
// which is approval-gated. So these are comps in the same sense a shop window
// is a comp, and the calibration layer is what turns them into an expectation
// of what a piece actually fetches.

import pg from 'pg';
import { BRANDS } from '../src/lib/brands/index.mjs';
import { isSandboxKey, hostFor } from '../src/lib/adapters/ebay.mjs';

const argv = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

const marketplace = flag('marketplace', 'EBAY_GB');
const currency = flag('currency', marketplace === 'EBAY_GB' ? 'GBP' : 'USD').toUpperCase();
const every = Number(flag('every', '360'));

if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET) {
  console.error(`
EBAY_CLIENT_ID and EBAY_CLIENT_SECRET are not set.

  Free, and about five minutes:
    1. developer.ebay.com — register
    2. create an application
    3. copy the Client ID and Client Secret from its production keyset
    4. put both in .env.local

The sources can still be configured now and will start working once the keys
are there; pass --anyway to do that.
`);
  if (!argv.includes('--anyway')) process.exit(1);
}

// Which eBay is this keyset for?
//
// eBay stamps it into the App ID: "...-SBX-..." is Sandbox, "...-PRD-..." is
// Production, and a keyset authenticates ONLY against its own host. The
// adapter derives the host from the key for exactly that reason, so the two
// can never disagree.
//
// A Sandbox keyset is still worth USING, and refusing to touch it was the
// wrong call: it proves the whole chain — token, search, parse, ingest —
// without waiting on a production application. What it may not do is become a
// live source, because eBay's sandbox catalogue is fixture data. Comps from an
// exit venue are the only thing resale value is estimated from here, so a
// sandbox source would authenticate and then value every piece against
// inventory nobody is selling.
//
// So: verify with it, never poll with it.
const sandbox = isSandboxKey(process.env.EBAY_CLIENT_ID);

// Prove the credentials before writing anything down.
//
// eBay is the exit venue, and without one nothing in this platform can be
// scored — so a key that is wrong, or from a sandbox keyset rather than a
// production one, is not a small misconfiguration. Finding out at the next
// poll means finding out hours later, in a log, with an empty screen in
// between and no obvious reason for it.
if (process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET) {
  const { fetchToken, fetchListings } = await import('../src/lib/adapters/ebay.mjs');
  const host = hostFor(process.env.EBAY_CLIENT_ID);
  process.stdout.write(`\nAuthenticating against ${host} … `);
  const auth = await fetchToken({
    clientId: process.env.EBAY_CLIENT_ID,
    clientSecret: process.env.EBAY_CLIENT_SECRET,
  });
  if (!auth.ok) {
    console.error(
      `no.\n\n  ${auth.error}\n\n` +
        `  Nothing was saved. Usually one of:\n` +
        `    • the Client ID and Secret are from different keysets\n` +
        `    • the Client Secret was truncated on copy\n` +
        `    • the application has not finished being created\n`,
    );
    process.exit(1);
  }
  console.log('good — the key works.');

  // Then actually ask it something. A token proves the credential; only a
  // search proves the adapter, the query shape, the marketplace id and the
  // parse. On a Sandbox key this is the whole point of the exercise.
  process.stdout.write('Running one search … ');
  const probe = await fetchListings(
    {
      queries: [BRANDS[0].display_name],
      marketplaceId: marketplace,
      currency,
      filter: 'conditions:{USED}',
      maxPages: 1,
      token: auth.token,
      clientId: process.env.EBAY_CLIENT_ID,
    },
    {},
  );
  if (!probe.ok) {
    console.log(`no — ${probe.error}`);
  } else {
    console.log(`${probe.listings.length} results for "${BRANDS[0].display_name}".`);
    for (const l of probe.listings.slice(0, 3)) {
      console.log(`    ${String(l.price).padStart(9)} ${l.currency}  ${String(l.title).slice(0, 56)}`);
    }
  }

  if (sandbox) {
    console.log(`
  That was eBay's SANDBOX. The credential and the whole chain — token, search,
  parse — are proven working; the inventory is fixture data, so it is not a
  market and cannot be a comp.

  Nothing was saved, deliberately: a sandbox source would authenticate and then
  value every piece you own against a catalogue nobody is selling from, which
  is worse than having no exit venue at all and looks identical to working.

  The Production keyset is the same application at developer.ebay.com, under
  its Production tab — its App ID reads -PRD-. Put those two values in
  .env.local and run this again; nothing else changes.
`);
    process.exit(0);
  }
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

// One source carrying a search per house, rather than one source per house.
//
// Per-house searches are necessary — eBay ranks and truncates, so a single
// broad query returns whatever it favours rather than the roster. But a source
// per house would multiply routes by the number of houses and score every
// listing against all of them. eBay is one venue, so it is one source.
const queries = BRANDS.map((b) => b.display_name);

await client.query(
  `insert into sources
     (id, display_name, tier, role, automation_allowed, permission_status,
      poll_interval_minutes, marketplace_kind, config)
   values ('ebay','eBay','feed','both',true,'granted',$1,'secondhand',$2::jsonb)
   on conflict (id) do update set
     poll_interval_minutes = excluded.poll_interval_minutes,
     config = excluded.config`,
  [
    every,
    JSON.stringify({
      adapter: 'ebay',
      queries,
      marketplaceId: marketplace,
      currency,
      // Used only. A new-with-tags current-season piece is a retail price
      // wearing a marketplace's clothes, and pooling it in would drag every
      // estimate upward exactly as a boutique's would.
      filter: 'conditions:{USED}',
    }),
  ],
);
const added = queries.length;

// Routes from every acquisition source to eBay, or these comps price nothing.
const { rows: acquisitions } = await client.query(
  `select id from sources where role in ('acquisition','both') and id <> 'ebay'`,
);
let routes = 0;
for (const a of acquisitions) {
  const r = await client.query(
    `insert into routes (id, display_name, acquisition_source, exit_source,
                         proxy_fee_pct, domestic_ship_flat, intl_ship_flat,
                         import_vat_pct, customs_duty_pct, sale_fee_pct,
                         payment_fee_pct, outbound_ship_flat)
     select $1, $2, $3, 'ebay', 0.05, 8, 35, 0.21, 0.12, 0.13, 0.029, 20
     where not exists (select 1 from routes where id = $1)`,
    [`${a.id}__ebay`, `${a.id} → eBay`, a.id],
  );
  routes += r.rowCount;
}

console.log(
  `\neBay configured as an exit venue: ${added} searches on ${marketplace}, priced in ${currency}.` +
    (routes ? `\n${routes} routes created.` : '') +
    `\n\n  npm run poll\n`,
);
await client.end();
