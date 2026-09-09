import pg from 'pg';
import { BRANDS, SUBLINES, ALIASES, registryProblems } from '../src/lib/brands/index.mjs';
import { normalizeAlias } from '../src/lib/normalize.mjs';

// Sources.
//
// `automation_allowed: false` is not a "we haven't got round to it" marker. For
// the three big platforms it records a terms-level prohibition, and the schema
// refuses to let a manual-tier source be marked automatable. The reason string
// is stored so nobody (including a future me) has to re-derive it.
const SOURCES = [
  {
    id: 'grailed',
    display_name: 'Grailed',
    tier: 'manual',
    role: 'exit',
    automation_allowed: false,
    automation_block_reason:
      'Terms prohibit bots, scrapers, data-mining tools, AI-based extraction, browser extensions and automated purchasing. Manual entry only; driven by first-party saved-search alerts.',
    base_url: 'https://www.grailed.com',
  },
  {
    id: 'therealreal',
    display_name: 'The RealReal',
    tier: 'manual',
    role: 'acquisition',
    automation_allowed: false,
    automation_block_reason:
      'Their site refuses crawlers and their terms prohibit compiling site content into a database, so there is no automated route unless they publish an affiliate product feed — search "The RealReal affiliate program" to find out. If they do not, this stays manual entry: paste a URL on /add and it prefills what the URL encodes.',
    base_url: 'https://www.therealreal.com',
  },
  {
    id: 'vestiaire',
    display_name: 'Vestiaire Collective',
    tier: 'manual',
    role: 'exit',
    automation_allowed: false,
    automation_block_reason:
      'Their terms require prior written consent for any application interacting with the site, explicitly including scrapers. An affiliate product feed would be that consent in writing — search "Vestiaire Collective affiliate program" to see whether one exists. Otherwise manual entry.',
    base_url: 'https://www.vestiairecollective.com',
  },
  {
    id: 'manual_other',
    display_name: 'Other (manual)',
    tier: 'manual',
    role: 'acquisition',
    automation_allowed: false,
    automation_block_reason:
      'Catch-all for hand-entered listings from sources without their own row yet.',
    base_url: null,
  },
];

// Condition vocabulary, mapped per source and written down as the brief requires.
//
// Rule applied throughout: where a source's grade straddles two of our tiers,
// map DOWN. Overstating condition is what manufactures a fake arbitrage signal
// — a damaged piece priced like a mint one looks exactly like a bargain.
const CONDITIONS = [
  ['therealreal', 'Pristine', 'new', 'Never worn / as-new per TRR grading.'],
  ['therealreal', 'Excellent', 'excellent', null],
  ['therealreal', 'Very Good', 'good', 'Mapped down; TRR "Very Good" shows wear.'],
  ['therealreal', 'Good', 'good', null],
  ['therealreal', 'Fair', 'fair', null],

  ['vestiaire', 'Never worn, with tag', 'new_with_tags', null],
  ['vestiaire', 'Never worn', 'new', null],
  ['vestiaire', 'Very good condition', 'excellent', null],
  ['vestiaire', 'Good condition', 'good', null],
  ['vestiaire', 'Fair condition', 'fair', null],

  ['grailed', 'New With Tags', 'new_with_tags', null],
  ['grailed', 'New/Never Worn', 'new', null],
  ['grailed', 'Gently Used', 'excellent', null],
  ['grailed', 'Used', 'good', null],
  ['grailed', 'Very Worn', 'fair', 'Grailed has no tier below this; damaged must be set by hand.'],
];

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query('begin');

try {
  for (const s of SOURCES) {
    await client.query(
      `insert into sources (id, display_name, tier, role, automation_allowed, automation_block_reason, base_url)
       values ($1,$2,$3,$4::source_role,$5,$6,$7)
       on conflict (id) do update set
         display_name = excluded.display_name,
         tier = excluded.tier,
         role = excluded.role,
         automation_allowed = excluded.automation_allowed,
         automation_block_reason = excluded.automation_block_reason,
         base_url = excluded.base_url`,
      [s.id, s.display_name, s.tier, s.role ?? 'acquisition', s.automation_allowed, s.automation_block_reason, s.base_url],
    );
  }

  // Fail loudly rather than seeding a registry with dangling references.
  const problems = registryProblems();
  if (problems.length) throw new Error(`brand registry problems:\n  ${problems.join('\n  ')}`);

  for (const b of BRANDS) {
    await client.query(
      `insert into brands (id, display_name) values ($1,$2)
       on conflict (id) do update set display_name = excluded.display_name`,
      [b.id, b.display_name],
    );
  }

  for (const sub of SUBLINES) {
    await client.query(
      `insert into sublines (id, brand_id, display_name, monitored, ambiguous, note)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (id) do update set
         brand_id = excluded.brand_id,
         display_name = excluded.display_name,
         monitored = excluded.monitored,
         ambiguous = excluded.ambiguous,
         note = excluded.note`,
      [sub.id, sub.brand_id, sub.display_name, sub.monitored !== false, Boolean(sub.ambiguous), sub.note ?? null],
    );
  }

  for (const a of ALIASES) {
    const { compact, script } = normalizeAlias(a.alias);
    await client.query(
      `insert into brand_aliases (brand_id, subline_id, alias, alias_norm, script, resolves_subline)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (alias_norm, script) do update set
         brand_id = excluded.brand_id,
         subline_id = excluded.subline_id,
         alias = excluded.alias,
         resolves_subline = excluded.resolves_subline`,
      [a.brand, a.sub ?? null, a.alias, compact, script, a.sub != null],
    );
  }

  for (const [sourceId, raw, tier, note] of CONDITIONS) {
    await client.query(
      `insert into condition_mappings (source_id, raw_label, raw_label_norm, tier, note)
       values ($1,$2,$3,$4,$5)
       on conflict (source_id, raw_label_norm) do update set
         tier = excluded.tier, note = excluded.note`,
      [sourceId, raw, normalizeAlias(raw).compact, tier, note],
    );
  }

  // Routes: the directed pipelines that actually make money, per the operator.
  //
  //   The RealReal / Japanese sites / individual shops  ->  Grailed / Vestiaire
  //
  // Every number below is an ESTIMATE and is labelled as one in the UI. The
  // Japan legs are modelled component-by-component on purpose: the proxy fee
  // plus TWO shipping legs plus import VAT is exactly what turns a
  // healthy-looking spread into a loss, and a model that hides them inside one
  // "shipping" figure will show profits that do not exist.
  const ROUTES = [
    {
      id: 'trr_to_grailed',
      display_name: 'The RealReal → Grailed',
      acquisition_source: 'therealreal',
      exit_source: 'grailed',
      // Domestic-ish purchase: no proxy, no double shipping leg.
      intl_ship_flat: 25, import_vat_pct: 0.21, customs_duty_pct: 0.12,
      sale_fee_pct: 0.09, payment_fee_pct: 0.029, outbound_ship_flat: 15,
      notes: 'TRR ships internationally; VAT and duty apply on import to Belgium. Duty rate varies by material and origin — 12% is a placeholder for apparel.',
    },
    {
      id: 'trr_to_vestiaire',
      display_name: 'The RealReal → Vestiaire',
      acquisition_source: 'therealreal',
      exit_source: 'vestiaire',
      intl_ship_flat: 25, import_vat_pct: 0.21, customs_duty_pct: 0.12,
      sale_fee_pct: 0.15, payment_fee_pct: 0.03, outbound_ship_flat: 15,
      notes: 'Vestiaire commission is higher than Grailed but reaches a different buyer pool.',
    },
    {
      id: 'jp_to_grailed',
      display_name: 'Japan (proxy) → Grailed',
      acquisition_source: 'manual_other',
      exit_source: 'grailed',
      // The stack the brief warns about, itemised.
      proxy_fee_pct: 0.05, proxy_fee_flat: 3,
      domestic_ship_flat: 7, intl_ship_flat: 35,
      import_vat_pct: 0.21, customs_duty_pct: 0.12,
      sale_fee_pct: 0.09, payment_fee_pct: 0.029, outbound_ship_flat: 15,
      notes: 'Buyee/ZenMarket style. Two shipping legs plus proxy fee plus import VAT. This is the route where marginal-looking spreads die.',
    },
    {
      id: 'jp_to_vestiaire',
      display_name: 'Japan (proxy) → Vestiaire',
      acquisition_source: 'manual_other',
      exit_source: 'vestiaire',
      proxy_fee_pct: 0.05, proxy_fee_flat: 3,
      domestic_ship_flat: 7, intl_ship_flat: 35,
      import_vat_pct: 0.21, customs_duty_pct: 0.12,
      sale_fee_pct: 0.15, payment_fee_pct: 0.03, outbound_ship_flat: 15,
      notes: 'Same acquisition stack as jp_to_grailed, higher exit commission.',
    },
  ];

  for (const r of ROUTES) {
    await client.query(
      `insert into routes (
         id, display_name, acquisition_source, exit_source, notes,
         proxy_fee_pct, proxy_fee_flat, domestic_ship_flat, intl_ship_flat,
         import_vat_pct, customs_duty_pct,
         sale_fee_pct, payment_fee_pct, outbound_ship_flat
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       on conflict (id) do update set
         display_name = excluded.display_name,
         notes = excluded.notes,
         -- Costs are only re-seeded while they are still guesses. Once a human
         -- has confirmed what a route actually costs, re-running the seed must
         -- not quietly put the placeholders back: that would revert real
         -- numbers to invented ones and clear no flag on the way, so every
         -- margin through the route would silently change and nothing would
         -- say why.
         proxy_fee_pct = case when routes.costs_confirmed_at is null then excluded.proxy_fee_pct else routes.proxy_fee_pct end,
         proxy_fee_flat = case when routes.costs_confirmed_at is null then excluded.proxy_fee_flat else routes.proxy_fee_flat end,
         domestic_ship_flat = case when routes.costs_confirmed_at is null then excluded.domestic_ship_flat else routes.domestic_ship_flat end,
         intl_ship_flat = case when routes.costs_confirmed_at is null then excluded.intl_ship_flat else routes.intl_ship_flat end,
         import_vat_pct = case when routes.costs_confirmed_at is null then excluded.import_vat_pct else routes.import_vat_pct end,
         customs_duty_pct = case when routes.costs_confirmed_at is null then excluded.customs_duty_pct else routes.customs_duty_pct end,
         sale_fee_pct = case when routes.costs_confirmed_at is null then excluded.sale_fee_pct else routes.sale_fee_pct end,
         payment_fee_pct = case when routes.costs_confirmed_at is null then excluded.payment_fee_pct else routes.payment_fee_pct end,
         outbound_ship_flat = case when routes.costs_confirmed_at is null then excluded.outbound_ship_flat else routes.outbound_ship_flat end,
         updated_at = now()`,
      [
        r.id, r.display_name, r.acquisition_source, r.exit_source, r.notes ?? null,
        r.proxy_fee_pct ?? 0, r.proxy_fee_flat ?? 0,
        r.domestic_ship_flat ?? 0, r.intl_ship_flat ?? 0,
        r.import_vat_pct ?? 0, r.customs_duty_pct ?? 0,
        r.sale_fee_pct ?? 0, r.payment_fee_pct ?? 0, r.outbound_ship_flat ?? 0,
      ],
    );
  }

  // FX seed rates.
  //
  // PLACEHOLDERS, deliberately labelled as such in the `source` column so they
  // are visible as estimates in the UI rather than passing as observed rates.
  // There is no live FX feed wired up in phase 1; these exist so price_base is
  // populated and the conversion path is exercised end to end. Replace with a
  // real feed before any scoring decision rests on them.
  const FX_PLACEHOLDER = [
    ['JPY', 0.00580],
    ['USD', 0.86000],
    ['GBP', 1.17000],
    ['CHF', 1.07000],
  ];
  for (const [from, rate] of FX_PLACEHOLDER) {
    await client.query(
      `insert into fx_rates (base_currency, quote_currency, rate, as_of, source)
       values ($1, $2, $3, date_trunc('day', now()), 'placeholder_seed')
       on conflict (base_currency, quote_currency, as_of) do update set rate = excluded.rate`,
      [from, process.env.BASE_CURRENCY ?? 'EUR', rate],
    );
  }

  // A starter alert rule, deliberately on channel "none" so nothing is sent
  // until a webhook is configured. Tuning thresholds against a silent rule
  // first is how you avoid training yourself to ignore the real ones.
  await client.query(
    `insert into alert_rules (id, display_name, enabled, min_profit_base,
        min_confidence, include_provisional, include_flagged, channel, mode)
     values ('default', 'Default — profit over EUR150', true, 150, 0.15, false, true, 'none', 'realtime')
     on conflict (id) do nothing`,
  );

  // A weekly digest, also silent until pointed at a webhook. The alert is for
  // acting now; the digest is for noticing patterns. Different jobs.
  await client.query(
    `insert into alert_rules (id, display_name, enabled, min_profit_base,
        include_provisional, include_flagged, channel, mode)
     values ('weekly_digest', 'Weekly digest', false, 50, true, true, 'none', 'digest')
     on conflict (id) do nothing`,
  );

  // Heat subjects: one per monitored sub-line, plus the house itself.
  //
  // Wikipedia titles are filled in only where a page plausibly exists under
  // that exact name. A subject without one still gets internal heat (price,
  // turnover, supply) and simply contributes nothing from attention — which is
  // different from contributing zero.
  const WIKI = {
    'cdg-mainline': 'Comme des Garçons',
    'junya-watanabe': 'Junya Watanabe',
    'junya-watanabe-man': 'Junya Watanabe',
    'noir-kei-ninomiya': 'Kei Ninomiya',
    'yy-mainline': 'Yohji Yamamoto',
    'yy-pour-homme': 'Yohji Yamamoto',
    'im-mainline': 'Issey Miyake',
    'ro-mainline': 'Rick Owens',
    'ann-mainline': 'Ann Demeulemeester',
  };

  // Brand-level attention. Only filled where a page plausibly exists under that
  // exact title; a wrong title yields a silent 404 rather than an error, so
  // guessing would quietly produce no data and look like a cold brand.
  const WIKI_BRAND = {
    cdg: 'Comme des Garçons',
    yohji: 'Yohji Yamamoto',
    ann: 'Ann Demeulemeester',
    rick: 'Rick Owens',
    issey: 'Issey Miyake',
    ccp: 'Carol Christian Poell',
    haider: 'Haider Ackermann',
    undercover: 'Undercover (brand)',
    sacai: 'Sacai',
    visvim: 'Visvim',
    kapital: 'Kapital (brand)',
    greglauren: 'Greg Lauren',
    umawang: 'Uma Wang',
    bbs: 'Boris Bidjan Saberi',
  };

  for (const b of BRANDS) {
    await client.query(
      `insert into heat_subjects (subject_type, brand_id, label, wikipedia_title)
       values ('brand', $1, $2, $3)
       on conflict (subject_type, brand_id, subline_id, item_id) do nothing`,
      [b.id, b.display_name, WIKI_BRAND[b.id] ?? null],
    );
  }

  for (const sub of SUBLINES) {
    if (sub.monitored === false) continue;
    await client.query(
      `insert into heat_subjects (subject_type, brand_id, subline_id, label, wikipedia_title)
       values ('subline', $1, $2, $3, $4)
       on conflict (subject_type, brand_id, subline_id, item_id) do nothing`,
      [sub.brand_id, sub.id, sub.display_name, WIKI[sub.id] ?? null],
    );
  }

  await client.query('commit');
  const counts = await client.query(`
    select
      (select count(*) from sources) as sources,
      (select count(*) from sublines) as sublines,
      (select count(*) from brand_aliases) as aliases,
      (select count(*) from condition_mappings) as conditions,
      (select count(*) from fx_rates) as fx_rates,
      (select count(*) from routes) as routes,
      (select count(*) from alert_rules) as alert_rules,
      (select count(*) from heat_subjects) as heat_subjects
  `);
  console.log('seeded', counts.rows[0]);
} catch (err) {
  await client.query('rollback');
  console.error('seed failed:', err.message);
  process.exitCode = 1;
}
await client.end();
