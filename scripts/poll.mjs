// Poll every feed source once.
//
//   node scripts/poll.mjs [--source <id>]
//
// Intended to be driven by a scheduled function (Vercel Cron) in production.
// Poll cadence is per source: a fast marketplace turns over in minutes, a
// one-person archive shop in weeks, and applying one schedule to both is either
// rude or useless.

import pg from 'pg';
import { collectingUserAgent, NO_CONTACT_WARNING } from '../src/lib/userAgent.mjs';
import { runPoll } from '../src/lib/pollRunner.mjs';
import { DUE_FOR_POLL } from '../src/lib/ingest.mjs';
import { ADAPTERS } from '../src/lib/adapters/index.mjs';
import { fetchRates, isFresh } from '../src/lib/adapters/fx.mjs';

// One builder, and it refuses rather than inventing. The previous default
// wrote "contact not set" into the User-Agent — a request that was asked to
// identify itself and declined in words, which is what Wikimedia answers 403 to.
// Polling sources that are already configured must not stop for want of a
// contact: refusing here collects nothing at all, which is a worse failure than
// an unidentified request to a shop that never asked for one.
const { ua: UA, anonymous } = collectingUserAgent();
if (anonymous) console.warn(`\n${NO_CONTACT_WARNING}`);

const idx = process.argv.indexOf('--source');
const only = idx > -1 ? process.argv[idx + 1] : null;

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

// Naming one source bypasses both the cadence and any cooldown: asking for a
// source by name is a person deciding, and those two exist to pace a schedule.
const { rows: sources } = await client.query(
  `select s.* from sources s
    where s.tier = 'feed' and s.automation_allowed
      and s.permission_status <> 'declined'
      ${only ? 'and s.id = $1' : `and ${DUE_FOR_POLL}`}
    order by s.id`,
  only ? [only] : [],
);

if (!only && !sources.length) {
  console.log(
    '\nNothing is due. Sources are polled on their own poll_interval_minutes, and a\n' +
    'source that answered 429 is left alone until its cooldown passes.\n' +
    'Name one to poll it anyway:  npm run poll -- --source <id>\n',
  );
}

if (!sources.length) {
  console.log('No feed sources configured. Manual-tier sources are never polled.');
  await client.end();
  process.exit(0);
}

// Rates before listings, always.
//
// price_base is stamped once, at insert. A snapshot taken while its currency
// has no rate is stored unconvertible and stays that way — invisible to every
// comparison in the platform rather than merely approximate — because a
// listing whose price never changes is never re-inserted. So the conversion
// layer is made current first, and a source whose currency still has no rate
// afterwards is skipped rather than ingested into a hole.
const BASE = (process.env.BASE_CURRENCY ?? 'EUR').toUpperCase();
const needed = [...new Set(sources.map((s) => s.config?.currency).filter(Boolean))]
  .map((c) => c.toUpperCase());

const fx = await fetchRates({ baseCurrency: BASE, currencies: needed, userAgent: UA });
if (fx.ok) {
  for (const r of fx.listings) {
    await client.query(
      `insert into fx_rates (base_currency, quote_currency, rate, as_of, source)
       values ($1, $2, $3, $4::date, 'ecb_via_frankfurter')
       on conflict (base_currency, quote_currency, as_of) do update set rate = excluded.rate`,
      [r.from, r.to, r.rate, r.asOf],
    );
  }
  const asOf = fx.listings[0]?.asOf;
  if (fx.listings.length) {
    console.log(`  fx: ${fx.listings.length} rates into ${BASE}, fixed ${asOf}`);
    if (!isFresh(asOf)) console.warn(`  fx: publisher's own fixing looks stale (${asOf})`);
  }
  if (fx.note) console.warn(`  fx: ${fx.note}`);
} else {
  // Not fatal on its own: rates already in the log may still be current enough
  // to convert today's poll. It is only fatal per source, checked below.
  console.warn(`  fx: refresh failed — ${fx.error}; using the rates already stored`);
}

const { rows: covered } = await client.query(
  `select distinct base_currency from fx_rates where quote_currency = $1`,
  [BASE],
);
const haveRate = new Set([BASE, ...covered.map((r) => r.base_currency)]);

for (const source of sources) {
  const adapterId = source.config?.adapter ?? 'shopify';
  const adapter = ADAPTERS[adapterId];
  if (!adapter) {
    console.error(`  ${source.id}: no adapter "${adapterId}"`);
    continue;
  }

  const currency = source.config?.currency?.toUpperCase();
  if (currency && !haveRate.has(currency)) {
    // Skipping loses one poll. Ingesting would lose the prices permanently.
    console.warn(
      `  ${source.id}: SKIPPED — no ${currency}->${BASE} rate, so its prices ` +
        `could not be compared. Run npm run fx.`,
    );
    continue;
  }

  const started = Date.now();
  const result = await runPoll({
    client,
    source,
    adapter,
    baseCurrency: process.env.BASE_CURRENCY ?? 'EUR',
    userAgent: UA,
  });
  const ms = Date.now() - started;

  if (result.ok) {
    console.log(
      `  ${source.id}: ok — ${result.count} seen, ${result.kept} on-brand, ` +
        `${result.inserted} new/changed, ${result.delisted} delisted, ` +
        `${result.relisted} relisted (${ms}ms)`,
    );
    // The prices were recorded; the silences were not read as absences. Worth
    // saying every time rather than once, because it is the standing limit of
    // a source like this and not a transient condition.
    if (result.partial) console.log(`        nothing marked gone — ${result.partial}`);
    if (result.cooldownMinutes) {
      console.log(
        `        rate limited — leaving ${source.id} alone for ${result.cooldownMinutes} minutes`,
      );
    }

    // Condition words this source used that nothing maps to a tier. Worth
    // saying, because a listing whose condition is unmapped is valued against
    // the cheapest tier with its confidence halved — the same treatment as one
    // whose seller said nothing at all — and the fix is one row.
    if (result.unmappedConditions) {
      const labels = Object.entries(result.unmappedConditions)
        .map(([label, n]) => `${label} (${n})`)
        .join(', ');
      console.log(`        unmapped conditions: ${labels}`);
      console.log('        add them to condition_mappings so these listings can be tiered');
    }
  } else {
    // A vetoed poll is a normal, expected outcome, not a crash. Nothing changed.
    console.warn(`  ${source.id}: NOT APPLIED — ${result.error} (${ms}ms)`);
    if (result.cooldownMinutes) {
      console.warn(
        `        leaving it alone for ${result.cooldownMinutes} minutes rather than asking again`,
      );
    }
  }
}

await client.end();
