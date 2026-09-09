// Configure Yahoo! Shopping Japan as a Japanese secondhand source.
//
//   node scripts/add-yahoo.mjs [--role both]
//
// This is the route into Japanese secondhand that actually works. The chains
// worth watching — RAGTAG, Komehyo, 2nd Street, Treasure Factory — do not run
// Shopify, so discovery will never find them: they are custom platforms with
// no public product feed. What they do have is storefronts on Yahoo! Shopping,
// which has an official API.
//
// Used goods only. Yahoo mixes new and used in one catalogue, and a
// current-season retail price pooled into the comps would drag every estimate
// upward exactly as a boutique's would.
//
// Needs a free Yahoo! JAPAN application id — no account linkage, no cost:
// https://e.developer.yahoo.co.jp/register — then YAHOO_APP_ID in .env.local.
//
// Searches are written in Japanese where the house is known by a Japanese
// name, because that is how the listings are titled. The resolver reads both
// scripts, so what comes back matches the roster either way.

import pg from 'pg';
import { BRANDS } from '../src/lib/brands/index.mjs';

const argv = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

// Japanese search terms for the houses that are listed under them. A Japanese
// seller writes "ヨウジヤマモト", not "Yohji Yamamoto", and searching the Latin
// form alone would miss most of the catalogue.
const JA = {
  yohji: 'ヨウジヤマモト',
  cdg: 'コムデギャルソン',
  issey: 'イッセイミヤケ',
  junya: 'ジュンヤワタナベ',
  'rick-owens': 'リックオウエンス',
  ann: 'アンドゥムルメステール',
  guidi: 'グイディ',
  ccp: 'カルロクリスチャンポエル',
  bbs: 'ボリスビジャンサベリ',
  'greg-lauren': 'グレッグローレン',
  haider: 'ハイダーアッカーマン',
  devoa: 'デヴォア',
  'uma-wang': 'ウマワン',
  'ziggy-chen': 'ジギーチェン',
  'paul-harnden': 'ポールハーデン',
};

if (!process.env.YAHOO_APP_ID && !argv.includes('--anyway')) {
  console.error(`
YAHOO_APP_ID is not set.

  Free, no account linkage, a few minutes:
    1. https://e.developer.yahoo.co.jp/register
    2. create an application
    3. put its Application ID in .env.local as YAHOO_APP_ID

  --anyway configures the source now; it starts working when the id is there.
`);
  process.exit(1);
}

// Prove the application id before writing anything down, for the same reason
// eBay's is proved: a bad id does not fail loudly, it produces a source that
// returns nothing, hours later, in a log.
if (process.env.YAHOO_APP_ID) {
  const yahoo = await import('../src/lib/adapters/yahooShopping.mjs');
  process.stdout.write('\nChecking the Yahoo application id … ');
  const probe = await yahoo.fetchListings(
    { appId: process.env.YAHOO_APP_ID, queries: ['ヨウジヤマモト'], conditionUsed: true, maxPages: 1 },
    {},
  );
  if (!probe.ok) {
    console.error(
      `no.\n\n  ${probe.error}\n\n` +
        `  Nothing was saved. Usually one of:\n` +
        `    • the id is from a different Yahoo property than Shopping\n` +
        `    • the application is still pending\n` +
        `    • the id was truncated on copy\n`,
    );
    process.exit(1);
  }
  console.log(`good — ${probe.listings.length} used listings on the first page.`);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

// Both the Japanese term and the Latin one, since sellers use both and the
// resolver reads either. Duplicates across searches collapse on ingest, because
// a listing's identity is its id within the source.
const queries = [];
for (const brand of BRANDS) {
  const ja = JA[brand.id];
  if (ja) queries.push(ja);
  queries.push(brand.display_name);
}

await client.query(
  `insert into sources
     (id, display_name, tier, role, automation_allowed, permission_status,
      poll_interval_minutes, marketplace_kind, config)
   values ('yahoo_jp','Yahoo! Shopping Japan (used)','feed',$1,true,'granted',$2,'secondhand',$3::jsonb)
   on conflict (id) do update set
     role = excluded.role,
     poll_interval_minutes = excluded.poll_interval_minutes,
     config = excluded.config`,
  [
    flag('role', 'both'),
    Number(flag('every', '360')),
    JSON.stringify({
      adapter: 'yahoo_shopping',
      queries,
      currency: 'JPY',
      // Yahoo mixes new and used; without this the comps would be retail.
      conditionUsed: true,
    }),
  ],
);

// Routes, or these listings price nothing and appear in no comparison.
const { rows: others } = await client.query(
  `select id, role from sources where id <> 'yahoo_jp' and tier <> 'manual' or (tier = 'manual' and role in ('exit','both'))`,
);
let routes = 0;
for (const o of others) {
  // Japan → elsewhere carries the proxy and import stack; elsewhere → Japan
  // does not, so the two directions are not the same route reversed.
  const pairs = [];
  if (o.role === 'exit' || o.role === 'both') pairs.push(['yahoo_jp', o.id, 0.05, 35, 0.21, 0.12]);
  if (o.role === 'acquisition' || o.role === 'both') pairs.push([o.id, 'yahoo_jp', 0, 25, 0.1, 0]);

  for (const [acq, exit, proxy, ship, vat, duty] of pairs) {
    const r = await client.query(
      `insert into routes (id, display_name, acquisition_source, exit_source,
                           proxy_fee_pct, domestic_ship_flat, intl_ship_flat,
                           import_vat_pct, customs_duty_pct, sale_fee_pct,
                           payment_fee_pct, outbound_ship_flat)
       select $1, $2, $3, $4, $5, 8, $6, $7, $8, 0.10, 0.029, 20
       where not exists (select 1 from routes where id = $1)`,
      [`${acq}__${exit}`, `${acq} → ${exit}`, acq, exit, proxy, ship, vat, duty],
    );
    routes += r.rowCount;
  }
}

console.log(
  `\nYahoo! Shopping Japan configured: ${queries.length} searches, used goods only.` +
    (routes ? `\n${routes} routes created.` : '') +
    `\n\n  npm run poll -- --source yahoo_jp\n`,
);
await client.end();
