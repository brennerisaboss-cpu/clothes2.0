// Configure eBay as a source, one search per monitored house.
//
//   node scripts/add-ebay.mjs [--marketplace EBAY_GB] [--currency GBP] [--sold]
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
// Note what the default does NOT give you: the Browse API returns ACTIVE
// listings — asks, not sold prices. So these are comps in the same sense a shop
// window is a comp, and the calibration layer is what turns them into an
// expectation of what a piece actually fetches.
//
// --sold adds the other half, and it is the more valuable half. eBay's
// Marketplace Insights API returns COMPLETED SALES: an item, a price, a date,
// stated by the venue. It is what moves a margin from arithmetic on two hopes
// to a figure resting on a transaction.
//
// It is not the only route to that — a page of sold listings pasted on /add
// records them from any venue you can open, and `npm run record-sale --item`
// records what a piece fetched when you sold it yourself. What this adds is
// that it happens without you.
//
// It is a limited release. The scope is granted per application, on request, by
// eBay — separately from Buy API access and separately from the Application
// Growth Check. Most keysets do not have it. This probes for it before saving
// anything, so a keyset without the grant fails here, with the reason, rather
// than silently returning nothing on every poll for weeks.
//
// The two are separate SOURCES and one VENUE. They need different scopes and
// have different completeness properties — a sold-item search is a ranked
// sample and never enumerates a catalogue — so they cannot share a row; and
// comps scope to the venue rather than to the endpoint, so the sales are never
// dropped out of a pool for sitting under a different source id.

import pg from 'pg';
import { BRANDS } from '../src/lib/brands/index.mjs';
import { isSandboxKey, hostFor } from '../src/lib/adapters/ebay.mjs';
import * as insights from '../src/lib/adapters/ebayInsights.mjs';

const argv = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

const marketplace = flag('marketplace', 'EBAY_GB');
const currency = flag('currency', marketplace === 'EBAY_GB' ? 'GBP' : 'USD').toUpperCase();
const every = Number(flag('every', '360'));
const withSold = argv.includes('--sold');

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

// The sold half, if asked for and if the keyset can reach it.
let soldSearches = 0;
if (withSold) {
  // Probed before it is saved. A limited-release scope the keyset does not hold
  // fails with a 403 on every call, and a source configured anyway would return
  // nothing on every poll — which looks exactly like a market where nothing
  // sells, for as long as nobody checks.
  const probe = await insights.fetchListings(
    { queries: [BRANDS[0].display_name], marketplaceId: marketplace, maxPages: 1 },
    {},
  );

  if (!probe.ok) {
    console.error(`
  Sold data NOT configured: ${probe.error}

  Marketplace Insights is a limited release. Ask eBay for the
  ${insights.SCOPE_PATH} scope on this keyset, at developer.ebay.com under the
  application's API access. It is separate from Buy API access and from the
  Application Growth Check, and nothing here can grant it.

  The asks above are configured and working. Run this again with --sold once
  the scope is granted.
`);
  } else {
    const soldQueries = BRANDS.map((b) => b.display_name);
    await client.query(
      `insert into sources
         (id, display_name, tier, role, automation_allowed, permission_status,
          poll_interval_minutes, marketplace_kind, venue_id, config)
       values ('ebay_sold','eBay (completed sales)','api','exit',true,'granted',
               $1,'secondhand','ebay',$2::jsonb)
       on conflict (id) do update set
         poll_interval_minutes = excluded.poll_interval_minutes,
         venue_id = excluded.venue_id,
         config = excluded.config`,
      [
        // Daily rather than hourly. The window is ninety days wide and the
        // quota is smaller than the Browse one, so asking more often re-reads
        // the same sales and buys nothing.
        Math.max(every, 1440),
        JSON.stringify({
          adapter: 'ebay_insights',
          queries: soldQueries,
          marketplaceId: marketplace,
          currency,
          filter: 'conditions:{USED}',
        }),
      ],
    );
    soldSearches = soldQueries.length;
    console.log(`\n  Sold data reachable — ${probe.listings.length} completed sales for "${BRANDS[0].display_name}".`);
  }
}

console.log(
  `\neBay configured as an exit venue: ${added} searches on ${marketplace}, priced in ${currency}.` +
    (soldSearches ? `\n${soldSearches} completed-sale searches, refreshed daily.` : '') +
    (routes ? `\n${routes} routes created.` : '') +
    (withSold && !soldSearches ? '' : '') +
    (soldSearches
      ? '\n\nThis is the first source that can say what somebody actually paid.\n' +
        'Until now every margin rested on asking prices, and /opportunities held\n' +
        'those behind a toggle for exactly that reason.'
      : '\n\nThese are asking prices. --sold adds eBay\'s completed sales, which is\nwhat turns a margin into a figure somebody agreed to.') +
    `\n\n  npm run poll\n`,
);
await client.end();
