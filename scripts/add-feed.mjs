// Add a merchant product feed as a source.
//
//   node scripts/add-feed.mjs --id therealreal_feed --name "The RealReal" \
//     --url "https://<your affiliate feed url>" --currency USD --role both
//
// This is how the venues that refuse crawlers become reachable. A retailer
// publishes its whole catalogue to an affiliate network precisely so that it
// can be ingested; joining the programme gives you a feed URL, and reading it
// is the intended use of a document the merchant generates for that purpose.
//
// Where to get one:
//
//   Search "<venue> affiliate program". If they run one, its application page
//   names the network it is hosted on, and the publisher dashboard there has a
//   product feed or datafeed URL.
//
// This deliberately does not name networks. An earlier version asserted which
// network hosted which venue and was simply wrong about The RealReal, which
// cost the operator a search for a programme that was not there. Programmes
// move networks, pause, and close; the site's own footer is current and this
// file cannot be.
//
// Not every venue runs one. If a search turns up nothing, there is no
// sanctioned feed for that venue and no amount of configuration here will
// produce one.
//
// The feed URL usually embeds your publisher key, so it is a credential: put
// it in .env.local and pass --url-env rather than committing it.

import pg from 'pg';

const argv = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

// Venues known to publish a feed, with what they are and where to get it.
//
// Not shortcuts for their own sake: each carries a judgement that is easy to
// get wrong. Farfetch is RETAIL, so its prices are a ceiling nobody pays on
// the resale market and must never enter the comp pool — marking it secondhand
// by accident would inflate every estimate.
const PRESETS = {
  therealreal: {
    name: 'The RealReal',
    currency: 'USD', role: 'both', kind: 'secondhand',
  },
  vestiaire: {
    name: 'Vestiaire Collective',
    currency: 'EUR', role: 'both', kind: 'secondhand',
  },
  farfetch: {
    name: 'Farfetch',
    // Retail, deliberately. Its prices are a ceiling nobody pays on the resale
    // market, so it can be bought from but never used as a comp.
    currency: 'EUR', role: 'acquisition', kind: 'retail',
  },
};

const presetName = flag('preset');
const preset = presetName ? PRESETS[presetName] : null;
if (presetName && !preset) {
  console.error(`\nNo preset "${presetName}". Known: ${Object.keys(PRESETS).join(', ')}\n`);
  process.exit(1);
}

const id = flag('id') ?? presetName;
const url = flag('url') ?? (flag('url-env') ? process.env[flag('url-env')] : null);
const currency = (flag('currency') ?? preset?.currency)?.toUpperCase();
const name = flag('name') ?? preset?.name ?? id;
const role = flag('role') ?? preset?.role ?? 'both';
const kind = flag('kind') ?? preset?.kind ?? 'secondhand';
const format = flag('format');

if (!id || !url || !currency) {
  if (preset && !url) {
    console.error(`
${preset.name}

  1. search "${preset.name} affiliate program" — if they run one, the
     application page names the network hosting it
  2. once approved, copy the product feed URL from that network's publisher
     dashboard (it embeds your publisher key)
  3. put it in .env.local, then:

     echo '${presetName.toUpperCase()}_FEED_URL=https://…' >> .env.local
     npm run add-feed -- --preset ${presetName} --url-env ${presetName.toUpperCase()}_FEED_URL --dry-run

  The feed would be treated as ${preset.kind}${preset.kind === 'retail' ? ' — bought from, never used as a comp' : ''}, priced in ${preset.currency}.

  If that search turns up no programme, this venue has no sanctioned feed and
  nothing here can create one.
`);
    process.exit(1);
  }

  console.error(`
Usage: node scripts/add-feed.mjs --id <id> --url <feed url> --currency USD [options]
       node scripts/add-feed.mjs --preset therealreal      (prints where to get the feed)

  --preset therealreal|vestiaire|farfetch

  --name "The RealReal"     display name
  --url-env TRR_FEED_URL    read the url from an env var instead (keeps the
                            publisher key out of your shell history)
  --role both               acquisition | exit | both   default both
  --kind secondhand         secondhand | retail         default secondhand
  --format xml|csv          default: detected from the feed itself
  --dry-run                 read and report, write nothing

A feed url usually embeds your publisher key. Put it in .env.local.
`);
  process.exit(1);
}
if (!/^[A-Z]{3}$/.test(currency)) {
  console.error(`"${currency}" is not an ISO 4217 code.`);
  process.exit(1);
}

const config = { adapter: 'merchant_feed', url, currency };
if (format) config.format = format;

// Read the feed before writing anything down.
//
// A feed URL is long, embeds a publisher key, and is copied out of a
// dashboard — so it is wrong often. Saving first and finding out at the next
// poll means the failure surfaces hours later, in a log, detached from the act
// that caused it. This reads it now and prints what it found, so a wrong URL,
// an expired key, or a column layout the mapping does not fit is visible while
// you still have the dashboard open.
const { fetchListings } = await import('../src/lib/adapters/merchantFeed.mjs');

console.log(`\nReading the feed …`);
const probe = await fetchListings({ ...config, userAgent: 'resale-tracker/0.1 (setup check)' });

if (!probe.ok) {
  console.error(
    `\n  Could not read it — ${probe.error}\n\n` +
      `  Nothing was saved. Common causes:\n` +
      `    • the URL needs your publisher key and it was truncated on copy\n` +
      `    • the network serves the feed over FTP; use the HTTPS variant\n` +
      `    • the feed is behind a login rather than a keyed URL\n`,
  );
  process.exit(1);
}

const onBrand = [];
{
  const { planMatch } = await import('../src/lib/matching.mjs');
  for (const l of probe.listings) {
    if (planMatch({ brand_raw: l.brandRaw, title_raw: l.title }).resolved?.brandId) onBrand.push(l);
  }
}

console.log(`  ${probe.listings.length} rows, ${onBrand.length} on the roster.`);
for (const l of onBrand.slice(0, 3)) {
  console.log(`    ${String(l.price).padStart(9)} ${l.currency ?? currency}  ${l.title.slice(0, 62)}`);
}
if (!onBrand.length) {
  console.warn(
    `\n  Nothing in this feed matched the brand roster. That is not necessarily\n` +
      `  wrong — a feed can be a category or a region — but check the prices above\n` +
      `  look right before relying on it.`,
  );
}
if (process.argv.includes('--dry-run')) {
  console.log('\n--dry-run: nothing written.\n');
  process.exit(0);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

await client.query(
  `insert into sources
     (id, display_name, tier, role, automation_allowed, permission_status,
      poll_interval_minutes, marketplace_kind, config)
   values ($1,$2,'feed',$3,true,'granted',$4,$5::marketplace_kind,$6::jsonb)
   on conflict (id) do update set
     display_name = excluded.display_name,
     role = excluded.role,
     marketplace_kind = excluded.marketplace_kind,
     config = excluded.config`,
  [id, name, role, Number(flag('every', '720')), kind, JSON.stringify(config)],
);

// permission_status is 'granted' rather than 'not_asked': joining an affiliate
// programme and being given a feed URL IS the merchant granting access. That
// is the whole difference between this and crawling them.

console.log(`\nAdded "${id}" — ${role}, ${kind}, ${currency}.\n\n  npm run poll -- --source ${id}\n`);
await client.end();
