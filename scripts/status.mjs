// Why is the screen empty?
//
//   npm run status
//
// This exists because that question took days to answer, and the answer was
// never in one place: a source can be configured but unpolled, polled but
// vetoed, ingesting but unmatched, matched but unscored, or scored but held
// back for want of evidence. Each stage has its own screen, and none of them
// says which stage you are actually stuck at.
//
// So this walks the whole pipeline in order and stops at the first thing that
// is genuinely blocking, with the command that unblocks it. Everything after
// that point is reported but not prescribed, because fixing a later stage
// while an earlier one is empty achieves nothing.

import pg from 'pg';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await client.query(sql, params)).rows;

const BASE = (process.env.BASE_CURRENCY ?? 'EUR').toUpperCase();
const tick = (ok) => (ok ? '  ok  ' : '  --  ');

console.log('');

// ---- 1. Sources -------------------------------------------------------------

const sources = await all(
  `select s.id, s.tier::text as tier, s.role::text as role,
          s.marketplace_kind::text as kind,
          (select count(*) from listings l where l.source_id = s.id)::int as listings,
          r.ok as last_ok, r.error as last_error, r.started_at as last_run
     from sources s
     left join lateral (
       select ok, error, started_at from poll_runs
        where source_id = s.id order by started_at desc limit 1
     ) r on true
    order by s.tier, s.id`,
);

const feeds = sources.filter((s) => s.tier === 'feed');
const exits = sources.filter((s) => s.role === 'exit' || s.role === 'both');
const pollable = feeds.filter((s) => s.last_ok === true);
const failing = feeds.filter((s) => s.last_ok === false);

console.log('SOURCES');
if (!feeds.length) {
  console.log('  none configured for automatic collection.');
} else {
  for (const s of feeds) {
    const state = s.last_ok === true ? 'ok' : s.last_ok === false ? 'FAILING' : 'never polled';
    console.log(`${tick(s.last_ok === true)}${s.id.padEnd(24)} ${String(s.listings).padStart(5)} listings   ${state}`);
    if (s.last_ok === false && s.last_error) {
      console.log(`        ${String(s.last_error).slice(0, 150)}`);
    }
  }
}

// ---- 2. Credentials ---------------------------------------------------------

const creds = [
  ['EBAY_CLIENT_ID', 'eBay — the exit venue', 'npm run add-ebay'],
  ['YAHOO_APP_ID', 'Yahoo! Shopping Japan', 'npm run add-yahoo'],
  ['PROBE_CONTACT', 'shop discovery', 'npm run discover'],
];
console.log('\nCREDENTIALS');
for (const [key, what, cmd] of creds) {
  const set = Boolean(process.env[key]);
  console.log(`${tick(set)}${key.padEnd(24)} ${what}${set ? '' : `   → ${cmd}`}`);
}

// ---- 2b. Who can open it ----------------------------------------------------
//
// Not part of the pipeline, but it is the one setting whose absence is silent:
// an unprotected instance behaves identically to a protected one until someone
// else opens it.

const password = Boolean(process.env.APP_PASSWORD);
const bind = process.env.APP_BIND ?? null;
const bindIsLoopback = ['127.0.0.1', '::1', 'localhost'].includes(bind ?? '');

console.log('\nACCESS');
if (password) {
  console.log(`${tick(true)}APP_PASSWORD set — one prompt, remembered thirty days`);
} else if (bindIsLoopback) {
  console.log(`${tick(true)}no password, listening on ${bind} only`);
  console.log('        Set APP_PASSWORD before exposing this any other way — a tunnel,');
  console.log('        an ssh -L, a VPN address or a 0.0.0.0 bind all reach other people.');
} else {
  console.log(`${tick(false)}no APP_PASSWORD, and the bind is ${bind ?? 'not declared'}`);
  console.log('        The app refuses every request in this state, which is deliberate.');
}

// ---- 3. What has been collected ---------------------------------------------

const counts = await one(
  `select (select count(*) from listings)::int as listings,
          (select count(*) from listings where item_id is null)::int as unmatched,
          (select count(*) from items)::int as items,
          (select count(*) from routes)::int as routes`,
);

const evidence = await one(
  `select count(*) filter (where l.evidence = 'confirmed_sale')::int as sales,
          count(*) filter (where l.evidence = 'inferred_disappearance')::int as gone,
          count(*) filter (where l.evidence = 'active_ask')::int as asks
     from listings l
     join sources s on s.id = l.source_id
    where s.role in ('exit','both') and s.marketplace_kind <> 'retail'`,
);

// ---- 4b. Route costs --------------------------------------------------------
//
// Not a blocker — every screen still works — but it is subtracted from every
// profit figure on those screens, so it belongs in the same list.

const routeCosts = await one(
  `select count(*)::int as total,
          count(*) filter (where costs_confirmed_at is null)::int as unconfirmed
     from routes`,
);

console.log('\nROUTE COSTS');
console.log(
  `        ${String(routeCosts.total - routeCosts.unconfirmed).padStart(5)} of ${routeCosts.total} routes have costs somebody checked`,
);

console.log('\nCOLLECTED');
console.log(`        ${String(counts.listings).padStart(5)} listings, ${counts.items} items, ${counts.routes} routes`);
console.log(`        ${String(counts.unmatched).padStart(5)} unmatched — these appear in /unresolved and score nothing`);
console.log(`\nEVIDENCE (on venues you can sell through)`);
console.log(`        ${String(evidence.sales).padStart(5)} recorded sales`);
console.log(`        ${String(evidence.gone).padStart(5)} pieces seen leaving the market`);
console.log(`        ${String(evidence.asks).padStart(5)} asking prices`);

// ---- 4. Exchange rates ------------------------------------------------------

const placeholders = await one(
  `select count(*)::int as n from fx_rates
    where quote_currency = $1 and source = 'placeholder_seed'`,
  [BASE],
);

// ---- 4c. Which side of the trade the data is on -----------------------------
//
// The count that answers "why is /opportunities empty" more often than any
// other. Grailed and Vestiaire are exit venues: a listing pasted from one is a
// comp, never a candidate. A collection made entirely of them scores nothing,
// and until this line existed the screen and this script both reported that as
// "not enough comps" — advice to collect more of exactly the thing there was
// already too much of.

const sides = await one(
  `select
     (select count(*) from listings where status = 'active')::int as listings,
     (select count(*) from listings where status = 'active' and item_id is not null)::int as matched,
     (select count(*) from listings l join sources s on s.id = l.source_id
       where l.status = 'active' and l.item_id is not null
         and s.role in ('acquisition','both'))::int as acquisition_active,
     (select count(*) from listings l join sources s on s.id = l.source_id
       where l.item_id is not null and s.role in ('exit','both')
         and s.marketplace_kind <> 'retail')::int as exit_observations`,
);

console.log('\nSIDES OF THE TRADE');
console.log(`        ${String(sides.acquisition_active).padStart(5)} matched listings you could BUY   (acquisition venues)`);
console.log(`        ${String(sides.exit_observations).padStart(5)} observations you value against    (exit venues)`);
if (sides.acquisition_active === 0 && sides.exit_observations > 0) {
  console.log('        Everything you have is on the selling side. Those are the yardstick;');
  console.log('        nothing among them is a piece to buy, so nothing can be scored.');
}

// ---- 4d. How thin the comps are, item by item -------------------------------
//
// A score needs MIN_COMPS exit observations IN THE SAME CONDITION TIER as the
// piece being bought. Totals hide that: twelve comps spread over four tiers
// value nothing at all.

const tiers = await all(
  `select i.canonical_name,
          count(*) filter (where s.role in ('acquisition','both') and l.status = 'active')::int as buyable,
          count(*) filter (where s.role in ('exit','both') and s.marketplace_kind <> 'retail')::int as comps,
          count(distinct l.condition_tier) filter (
            where s.role in ('exit','both') and s.marketplace_kind <> 'retail')::int as tiers
     from items i
     join listings l on l.item_id = i.id
     join sources s on s.id = l.source_id
    group by i.id, i.canonical_name
   having count(*) filter (where s.role in ('acquisition','both') and l.status = 'active') > 0
    order by comps desc
    limit 8`,
);

if (tiers.length) {
  console.log('\nITEMS WITH SOMETHING TO BUY');
  for (const t of tiers) {
    const enough = t.comps >= 3;
    console.log(
      `${tick(enough)}${String(t.buyable).padStart(3)} buyable, ${String(t.comps).padStart(3)} exit comps` +
        ` across ${t.tiers} tier${t.tiers === 1 ? '' : 's'}   ${String(t.canonical_name).slice(0, 40)}`,
    );
  }
}

// ---- 4e. Prices nothing can compare ----------------------------------------
//
// price_base is what every comparison in the platform reads, and it is stamped
// once at insert. A listing recorded while its currency had no rate stores a
// null there and keeps it forever, because a listing whose price never changes
// is never re-inserted. Such a row is not merely imprecise — it is invisible:
// it cannot be scored, ranked or compared, and every screen simply omits it.
//
// `npm run fx` repairs these from the rates already on hand, so this is worth
// naming rather than leaving as an unexplained absence.

const unconvertible = await all(
  `select currency, count(*)::int as n
     from listings
    where price_base is null and price is not null and currency <> $1
    group by currency order by n desc`,
  [BASE],
);

if (unconvertible.length) {
  console.log('\nPRICES NOTHING CAN COMPARE');
  for (const row of unconvertible) {
    console.log(
      `${tick(false)}${String(row.n).padStart(5)} in ${row.currency} ${row.n === 1 ? 'has' : 'have'} no base price` +
        ' — invisible to every screen',
    );
  }
  console.log('        npm run fx        repairs these from the rates already on file');
}

// ---- 5. The first thing that is actually blocking ---------------------------
//
// In pipeline order, because fixing a later stage while an earlier one is
// empty achieves nothing at all.

const blockers = [
  [
    !feeds.length,
    'No sources collect anything automatically.',
    'npm run discover        (no credentials needed)\n     npm run add-ebay        (free key — this is the exit venue)',
  ],
  [
    feeds.length > 0 && !pollable.length && failing.length > 0,
    `Every configured source is failing. The reason is printed above.`,
    'fix the cause, then: npm run poll',
  ],
  [
    feeds.length > 0 && !pollable.length && !failing.length,
    'Sources are configured but have never been polled.',
    'npm run poll',
  ],
  [
    counts.listings > 0 && !exits.length,
    'Nothing you can sell through is configured, so no margin can be computed.',
    'npm run add-ebay',
  ],
  [
    counts.listings > 0 && !counts.routes,
    'No routes from where you buy to where you sell, so nothing is scored.',
    'npm run discover        (it creates routes for what it finds)',
  ],
  [
    sides.listings > 0 && sides.acquisition_active === 0,
    'Everything collected is on a venue you SELL through, so nothing is a\n' +
      '  candidate to buy. Grailed and Vestiaire listings are the yardstick\n' +
      '  /opportunities measures against, never a row on it.',
    'paste a page from the buying side — The RealReal, a Japanese site, a shop',
  ],
  [
    evidence.sales === 0 && evidence.gone === 0 && evidence.asks > 0,
    'Every comp is an asking price — what sellers hope for, not what buyers\n' +
      '  paid. /opportunities now shows these anyway, marked ask-based, because\n' +
      '  a pasted search page can only ever record an ask. The margins are real\n' +
      '  arithmetic on unreal inputs; treat them as a shortlist, not a number.',
    'npm run add-ebay -- --sold        (completed sales, if eBay grants the scope)\n' +
    '     npm run record-sale -- --brand cdg --venue ebay --price 700 --estimated 1150',
  ],
  [
    unconvertible.length > 0,
    `${unconvertible.reduce((n, r) => n + r.n, 0)} listing(s) have no base-currency price, so nothing\n` +
      '  can score them — they are absent from /opportunities rather than\n' +
      '  ranked low. price_base is stamped once at insert, so a listing recorded\n' +
      '  before its currency had a rate keeps the null until this is run.',
    'npm run fx',
  ],
  [
    placeholders.n > 0,
    'Exchange rates are still seed placeholders, so every margin is unreliable.',
    'npm run fx',
  ],
  [
    routeCosts.total > 0 && routeCosts.unconfirmed === routeCosts.total,
    `No route's costs have been checked, so the fees, shipping, duty and VAT\n` +
      '  subtracted from every profit figure are the seeded guesses. The rows are\n' +
      '  still worth reading; the euro figure on them is not, yet.',
    'npm run route-costs',
  ],
];

const blocking = blockers.filter(([when]) => when);

// The RealReal, Grailed and Vestiaire publish no feed and expose no API, so
// no amount of configuration reaches them. Pasting a page does, and it is easy
// to forget it exists when everything else here is a command.
const pasted = await one(
  `select count(*)::int as n from listings l
     join sources s on s.id = l.source_id
    where s.tier = 'manual' and l.entered_manually`,
);
console.log('\nBY HAND (the only route into venues that publish nothing)');
console.log(`        ${String(pasted.n).padStart(5)} listings pasted or entered`);
console.log('        Paste a page: open a search on The RealReal, Grailed or');
console.log('        Vestiaire, select all, copy, and paste it on /add.');

console.log('\n' + '─'.repeat(72));
if (!blocking.length) {
  console.log('\nNothing is blocking. Open http://localhost:3000/opportunities\n');
} else {
  console.log('\nWHAT IS BLOCKING, in the order it matters:\n');
  for (const [, what, how] of blocking) {
    console.log(`  ${what}`);
    console.log(`     ${how}\n`);
  }
}

await client.end();
