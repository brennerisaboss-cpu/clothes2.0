// Find working sources and configure them, without being told what they are.
//
//   node scripts/discover.mjs [--add domain.com] [--quiet]
//
// This exists because of a gap that made the whole platform look broken: every
// adapter worked, and nothing was pulled, because the `sources` table shipped
// with no feed rows in it. A perfectly good adapter that nothing is configured
// to use fetches nothing, silently.
//
// So the candidate list is probed and everything that answers correctly is
// added. A shop that 404s, blocks us in robots.txt, or will not say what
// currency it charges in is skipped with a reason — never guessed at, because
// a wrong currency is a 150x error that would top every table.
//
// Safe to run repeatedly: adding a shop that is already configured updates it.

import pg from 'pg';
import { collectingUserAgent, NO_CONTACT_WARNING } from '../src/lib/userAgent.mjs';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as shopify from '../src/lib/adapters/shopify.mjs';
import * as woocommerce from '../src/lib/adapters/woocommerce.mjs';
import * as page from '../src/lib/adapters/page.mjs';
import { detectCurrency } from '../src/lib/adapters/shopifyMeta.mjs';
import { planMatch } from '../src/lib/matching.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const quiet = process.argv.includes('--quiet');
const addIdx = process.argv.indexOf('--add');
const extra = addIdx > -1 ? process.argv.slice(addIdx + 1).filter((a) => !a.startsWith('--')) : [];

// Discovery must not stop for want of a contact — refusing here adds no shops
// at all, and an empty source list reads exactly like every site disappearing.
const { ua: UA, anonymous } = collectingUserAgent();
if (anonymous) console.warn(`\n${NO_CONTACT_WARNING}`);

// One host at a time, a second apart. These are small shops and this is a
// personal tool; there is no version of this that needs to go faster.
let lastCall = 0;
async function polite() {
  const since = Date.now() - lastCall;
  if (since < 1000) await new Promise((r) => setTimeout(r, 1000 - since));
  lastCall = Date.now();
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const config = JSON.parse(await readFile(join(ROOT, 'config', 'shops.json'), 'utf8'));
const candidates = [
  ...config.shops.filter((s) => s.permission_status !== 'declined'),
  ...extra.map((domain) => ({ domain, name: domain })),
];

const results = [];

/**
 * The origins worth trying for one candidate.
 *
 * A domain that answers only on www, or only without it, is not a shop that
 * has closed — it is a redirect this probe declined to follow, and it looked
 * identical to a dead host in the report. Both forms are tried before a
 * candidate is written off.
 */
function originsFor(shop) {
  if (shop.base) return [shop.base];
  const bare = shop.domain.replace(/^www\./, '');
  return [`https://${bare}`, `https://www.${bare}`];
}

for (const shop of candidates) {
  const origins = originsFor(shop);
  let base = origins[0];
  const id = (shop.id ?? shop.domain).replace(/^www\./, '').replace(/[^a-z0-9]+/gi, '_').toLowerCase();

  // Currency first, where the platform needs to be told. Shopify's
  // products.json states none at all, so it has to be found before there is
  // any point fetching a catalogue we could not price.
  let currency = shop.currency?.toUpperCase();
  let via = 'config';
  if (!currency) {
    for (const origin of origins) {
      await polite();
      const detected = await detectCurrency(origin, { userAgent: UA });
      if (detected.currency) {
        currency = detected.currency;
        via = detected.via;
        base = origin;
        break;
      }
    }
  }

  // Two platforms, tried in turn.
  //
  // Shopify was the only one supported, and that quietly decided which shops
  // this platform could ever aggregate: a one-person archive dealer on
  // WordPress had no route in but by hand, however public their catalogue was.
  //
  // WooCommerce is tried second and needs no currency detected beforehand — its
  // Store API states the code and the minor unit alongside every price, which
  // is better evidence than anything a storefront meta tag gives us. So a shop
  // that "does not state a currency" is no longer written off before it has
  // been asked properly.
  // Where a shop's catalogue lives when it has no feed to ask.
  //
  // Tried in order and only after both feeds have failed, because a feed is
  // better in every way: it pages, it states its own currency, and it can say
  // it enumerated the whole catalogue. These are the conventional paths, not a
  // crawl — one request each, and the first that parses wins.
  const CATALOGUE_PATHS = ['/collections/all', '/shop', '/products', '/all', '/'];

  const platforms = [
    currency ? { id: 'shopify', adapter: shopify, config: { currency } } : null,
    { id: 'woocommerce', adapter: woocommerce, config: currency ? { currency } : {} },
  ].filter(Boolean);

  let probe = null;
  let platform = null;
  const attempts = [];
  for (const candidate of platforms) {
    await polite();
    const result = await candidate.adapter.fetchListings(
      { domain: shop.domain, base, userAgent: UA, maxPages: 1, ...candidate.config },
      {},
    );
    if (result.ok && result.listings.length) {
      probe = result;
      platform = candidate;
      break;
    }
    attempts.push(`${candidate.id}: ${result.error ?? 'no products'}`);
  }

  // The shop with no feed at all — which, on this list, is most of them.
  //
  // Discovery used to stop here and record "no feed found", and that verdict
  // decided which shops this platform could ever aggregate: a one-person
  // archive dealer on a hand-built site had no route in but by hand, however
  // public their catalogue was. The page adapter reads a results page the way
  // copying it reads one, so there is no longer any reason to write those off
  // — only a reason to prefer a feed where one exists, which is the order.
  if (!probe) {
    for (const path of CATALOGUE_PATHS) {
      await polite();
      const url = `${base}${path}`;
      const result = await page.fetchListings({ url, currency, userAgent: UA }, {});
      if (result.ok && result.listings.length) {
        probe = result;
        platform = { id: 'page', url };
        break;
      }

      // Only the first failure is worth reporting: after a robots refusal or a
      // block, the remaining four say the same thing five times.
      if (path === CATALOGUE_PATHS[0]) attempts.push(`page: ${result.error ?? 'nothing parsed'}`);

      // And after an answer that is about the SHOP rather than about this
      // path, stop asking. A robots refusal, an unreachable host or a block
      // will say exactly the same thing at /shop as at /collections/all, so
      // trying the rest is five times the requests to a shop that has already
      // declined — on a list of 38 that is most of a thousand pointless
      // fetches, which is precisely the behaviour this project refuses to have.
      const aboutTheShop =
        /robots\.txt|refused|rate limited|unreachable|request failed|ENOTFOUND|ECONNREFUSED/i
          .test(result.error ?? '');
      if (aboutTheShop) break;
    }
  }

  if (!probe) {
    results.push({
      shop: shop.domain,
      status: 'skip',
      why: attempts.join('; ') || (currency ? 'no feed found' : 'does not state a currency'),
    });
    continue;
  }

  // WooCommerce reports its own currency per listing; take it from the feed
  // rather than from a meta tag, because it came from the shop's own pricing.
  const reported = probe.listings.find((l) => l.currency)?.currency;
  if (reported && reported !== currency) {
    currency = reported;
    via = `${platform.id} feed`;
  }

  // A shop with a working feed but nothing from the roster in it is a working
  // shop that sells other labels. Adding it would poll it forever for nothing.
  const onBrand = probe.listings.filter(
    (l) => planMatch({ brand_raw: l.brandRaw, title_raw: l.title }).resolved?.brandId,
  );
  if (!onBrand.length) {
    results.push({
      shop: shop.domain, status: 'skip',
      why: `feed works (${probe.listings.length} items) but none are on the roster`,
    });
    continue;
  }

  // Role 'both', not 'acquisition'.
  //
  // A secondhand marketplace is a place a piece is bought AND a record of what
  // it trades for — its asks are genuine market comps. Marking these sources
  // acquisition-only was why the opportunities screen stayed empty: resale
  // value is computed from exit-role comps, so with every source acquisition
  // and no pollable exit venue, nothing could ever be valued and the platform
  // aggregated diligently into a table it could not use.
  //
  // Retail is a different matter and is excluded from comps entirely, by
  // marketplace_kind, wherever they are gathered.
  const role = shop.role ?? (shop.kind === 'retail' ? 'acquisition' : 'both');
  const kind = shop.kind === 'retail' ? 'retail' : 'secondhand';

  await client.query(
    `insert into sources
       (id, display_name, tier, role, automation_allowed, base_url,
        permission_status, poll_interval_minutes, marketplace_kind, config)
     values ($1,$2,'feed',$3,true,$4,'not_asked',$5,$8::marketplace_kind,
             jsonb_build_object('adapter',$9::text,'domain',$6::text,'currency',$7::text)
             || case when $4::text = 'https://' || $6::text then '{}'::jsonb
                     else jsonb_build_object('base', $4::text) end
             -- The page adapter is pointed at a page, not at a domain: which
             -- one it found is the whole configuration, and losing it here
             -- would leave a source that cannot say what to read.
             || case when $10::text is null then '{}'::jsonb
                     else jsonb_build_object('url', $10::text) end)
     on conflict (id) do update set
       display_name = excluded.display_name,
       base_url = excluded.base_url,
       marketplace_kind = excluded.marketplace_kind,
       config = excluded.config`,
    [id, shop.name ?? shop.domain, role, base, shop.poll_minutes ?? 720, shop.domain, currency, kind,
     platform.id, platform.url ?? null],
  );

  results.push({
    shop: shop.domain, status: 'added', id,
    why:
      `${platform.id}: ${onBrand.length}/${probe.listings.length} on-brand, priced in ${currency} (${via})` +
      // Said on the row that adds it, because it is a standing property of the
      // source rather than a condition of this run: a page read can add and
      // re-price, and can never report anything as gone.
      (platform.id === 'page' ? ' — one page only, never marks anything gone' : ''),
  });
}

// Every acquisition source needs a route to an exit venue or its listings can
// never be scored — they appear in the grid and in no comparison, which is the
// same silent nothing this script exists to prevent.
const { rows: exits } = await client.query(
  `select id from sources where role in ('exit','both') order by id`,
);
let routesMade = 0;
for (const r of results.filter((x) => x.status === 'added')) {
  for (const exit of exits) {
    if (exit.id === r.id) continue;
    const made = await client.query(
      `insert into routes (id, display_name, acquisition_source, exit_source,
                           proxy_fee_pct, domestic_ship_flat, intl_ship_flat,
                           import_vat_pct, customs_duty_pct, sale_fee_pct,
                           payment_fee_pct, outbound_ship_flat)
       select $1, $2, $3, $4, 0.05, 8, 35, 0.21, 0.12, 0.09, 0.029, 20
       where not exists (select 1 from routes where id = $1)`,
      [`${r.id}__${exit.id}`, `${r.shop} → ${exit.id}`, r.id, exit.id],
    );
    routesMade += made.rowCount;
  }
}

if (!quiet) {
  const added = results.filter((r) => r.status === 'added');
  console.log('');
  for (const r of results) {
    console.log(`  ${r.status === 'added' ? 'ADDED' : 'skip '} ${r.shop.padEnd(38)} ${r.why}`);
  }
  console.log(`\n  ${added.length} of ${results.length} candidates are usable feeds.`);
  if (routesMade) console.log(`  ${routesMade} routes created to exit venues.`);
  if (!added.length) {
    console.log(
      `\n  Nothing was added. Add one directly if you know a shop:\n` +
        `      npm run add-source -- --domain shop.example --currency EUR\n`,
    );
  }
}

await client.end();
