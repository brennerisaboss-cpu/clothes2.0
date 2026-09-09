import { query, one } from './db';
import { VISIBLE_ITEMS_CTE, HEAD_OF_CHAIN } from './comps.mjs';

export type ListingCard = {
  id: string;
  item_id: string | null;
  brand_id?: string | null;
  source_role: string;
  marketplace_kind?: string;
  title_raw: string;
  brand_raw: string | null;
  subline_id: string | null;
  subline_name: string | null;
  subline_ambiguous: boolean | null;
  subline_monitored: boolean | null;
  size_raw: string | null;
  size_region: string;
  condition_raw: string | null;
  condition_tier: string | null;
  price: number;
  currency: string;
  price_base: number | null;
  fx_rate_at_snapshot: number | null;
  url: string | null;
  image_url: string | null;
  source_id: string;
  source_name: string;
  status: string;
  evidence: string;
  ad_year: number | null;
  ad_year_status: string | null;
  date_seen: Date;
  last_verified_at: Date | null;
  entered_manually: boolean;
  notes: string | null;
  last_action: string | null;
  source_item_id: string | null;
  proxy_purchasable: boolean | null;
};

const CARD_SELECT = `
  select l.id, l.item_id, l.title_raw, l.brand_raw, l.size_raw, l.size_region::text as size_region,
         l.condition_raw, l.condition_tier::text as condition_tier,
         l.price, l.currency, l.price_base, l.fx_rate_at_snapshot,
         l.url, l.image_url, l.source_id, l.status::text as status,
         l.evidence::text as evidence, l.date_seen, l.last_verified_at,
         l.entered_manually, l.notes, l.source_item_id, l.proxy_purchasable,
         s.display_name as source_name, s.role::text as source_role,
            s.marketplace_kind::text as marketplace_kind,
         sub.id as subline_id, sub.display_name as subline_name,
         sub.ambiguous as subline_ambiguous, sub.monitored as subline_monitored,
         i.ad_year, i.ad_year_status, i.brand_id,
         (select ra.action from review_actions ra
           where ra.listing_id = l.id order by ra.created_at desc limit 1) as last_action
    from listings l
    join sources s on s.id = l.source_id
    left join items i on i.id = l.item_id
    left join sublines sub on sub.id = i.subline_id
`;

export type GridFilters = {
  subline?: string;
  source?: string;
  conditionTier?: string;
  sizeRegion?: string;
  minPrice?: number;
  maxPrice?: number;
  freshness?: 'fresh' | 'due' | 'stale';
  needsResolution?: boolean;
  sort?: string;
  includeDismissed?: boolean;
  includeSuperseded?: boolean;
  /** Show listings that are sold, withdrawn or out of stock. Off by default. */
  includeGone?: boolean;
};

export async function listCards(filters: GridFilters = {}): Promise<ListingCard[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: string, value: unknown) => {
    params.push(value);
    where.push(clause.replace('$?', `$${params.length}`));
  };

  if (filters.subline) add('sub.id = $?', filters.subline);
  if (filters.source) add('l.source_id = $?', filters.source);
  if (filters.conditionTier) add('l.condition_tier = $?::condition_tier', filters.conditionTier);
  if (filters.sizeRegion) add('l.size_region = $?::size_region', filters.sizeRegion);
  if (filters.minPrice != null) add('coalesce(l.price_base, l.price) >= $?', filters.minPrice);
  if (filters.maxPrice != null) add('coalesce(l.price_base, l.price) <= $?', filters.maxPrice);
  if (filters.needsResolution) where.push('(i.id is null or sub.ambiguous)');

  // Freshness thresholds mirror src/lib/confidence.mjs. Kept in SQL so the
  // re-check queue can be paged without loading every row into memory.
  if (filters.freshness === 'fresh') where.push("l.last_verified_at > now() - interval '14 days'");
  if (filters.freshness === 'due')
    where.push(
      "l.last_verified_at <= now() - interval '14 days' and l.last_verified_at > now() - interval '30 days'",
    );
  if (filters.freshness === 'stale')
    where.push("(l.last_verified_at is null or l.last_verified_at <= now() - interval '30 days')");

  // `listings` is a snapshot log: a re-price writes a new row pointing at the
  // one it supersedes. The grid shows current state, so superseded rows are
  // hidden here — they remain in the table and on the item detail page, which
  // is where the price history belongs.
  if (!filters.includeSuperseded) {
    where.push('not exists (select 1 from listings sup where sup.supersedes_id = l.id)');
  }

  // A piece that is gone is not a thing to buy.
  //
  // The grid had no status filter at all, so sold and out-of-stock listings sat
  // among the buyable ones looking identical — and on the one-off archive shops
  // this platform watches, most of the catalogue is gone. That makes the whole
  // screen useless: every promising row has to be clicked to find out it is not
  // real.
  //
  // They are not deleted, and they are not worthless. A piece that disappeared
  // at a price is evidence of what that piece moves for, which is exactly the
  // scarce kind of evidence resale value needs — so they stay in the table, keep
  // contributing as comps, and are one filter away.
  if (!filters.includeGone) {
    where.push("l.status in ('active', 'relisted')");
  }

  if (!filters.includeDismissed) {
    where.push(`not exists (
      select 1 from review_actions ra
       where ra.listing_id = l.id and ra.action = 'dismissed'
         and ra.created_at = (select max(created_at) from review_actions r2 where r2.listing_id = l.id)
    )`);
  }

  const sorts: Record<string, string> = {
    newest: 'l.date_seen desc',
    oldest: 'l.date_seen asc',
    price_asc: 'coalesce(l.price_base, l.price) asc',
    price_desc: 'coalesce(l.price_base, l.price) desc',
    stalest: 'l.last_verified_at asc nulls first',
  };
  const orderBy = sorts[filters.sort ?? 'newest'] ?? sorts.newest;

  const sql = `${CARD_SELECT}
    ${where.length ? `where ${where.join(' and ')}` : ''}
    order by ${orderBy}
    limit 200`;

  return query<ListingCard>(sql, params);
}

export async function getListing(id: string) {
  const rows = await query<ListingCard>(`${CARD_SELECT} where l.id = $1`, [id]);
  return rows[0] ?? null;
}

/**
 * Only manual entries need re-verification; API rows carry their own recency.
 *
 * `includeNotDue` drops the age threshold so anything can be re-verified on
 * demand — the queue is a prompt, not a gate.
 */
export async function verificationQueue(includeNotDue = false): Promise<ListingCard[]> {
  const dueClause = includeNotDue
    ? ''
    : "and (l.last_verified_at is null or l.last_verified_at <= now() - interval '14 days')";

  return query<ListingCard>(
    `${CARD_SELECT}
      where l.entered_manually
        ${dueClause}
        and l.status <> 'delisted'
        and not exists (select 1 from listings sup where sup.supersedes_id = l.id)
      order by l.last_verified_at asc nulls first
      limit 200`,
  );
}

export async function facets() {
  const [sublines, sources, tiers, regions, counts] = await Promise.all([
    query<{ id: string; display_name: string; monitored: boolean; ambiguous: boolean }>(
      `select id, display_name, monitored, ambiguous from sublines order by display_name`,
    ),
    query<{ id: string; display_name: string; tier: string }>(
      `select id, display_name, tier::text as tier from sources order by display_name`,
    ),
    query<{ tier: string }>(
      `select unnest(enum_range(null::condition_tier))::text as tier`,
    ),
    query<{ region: string }>(`select unnest(enum_range(null::size_region))::text as region`),
    query<{ total: number; due: number; unresolved: number; brands: number }>(
      `select
         (select count(*) from brands) as brands,
         (select count(*) from listings) as total,
         (select count(*) from listings l
           where l.entered_manually and l.status <> 'delisted'
             and (l.last_verified_at is null or l.last_verified_at <= now() - interval '14 days')
             and not exists (select 1 from listings sup where sup.supersedes_id = l.id)) as due,
         (select count(*) from listings l
            left join items i on i.id = l.item_id
            left join sublines s on s.id = i.subline_id
           where (i.id is null or s.ambiguous)
             and not exists (select 1 from listings sup where sup.supersedes_id = l.id)) as unresolved`,
    ),
  ]);
  return { sublines, sources, tiers, regions, counts: counts[0] };
}

export async function conditionLabels(sourceId?: string) {
  if (!sourceId) return [];
  return query<{ raw_label: string; tier: string }>(
    `select raw_label, tier::text as tier from condition_mappings
      where source_id = $1 order by tier desc`,
    [sourceId],
  );
}

// ---------------------------------------------------------------------------
// Items (phase 2)
// ---------------------------------------------------------------------------

export type ItemRow = {
  id: string;
  canonical_name: string;
  subline_id: string | null;
  subline_name: string | null;
  ad_year: number | null;
  ad_year_status: string;
  listing_count: number;
};

export async function getItem(id: string) {
  return one<ItemRow>(
    `select i.id, i.canonical_name, i.subline_id, i.ad_year, i.ad_year_status,
            sub.display_name as subline_name,
            (select count(*) from listings l where l.item_id = i.id)::int as listing_count
       from items i
       left join sublines sub on sub.id = i.subline_id
      where i.id = $1`,
    [id],
  );
}

export type Observation = {
  id: string;
  price: number;
  currency: string;
  price_base: number | null;
  fx_rate_at_snapshot: number | null;
  condition_tier: string | null;
  condition_raw: string | null;
  evidence: string;
  status: string;
  date_seen: Date;
  last_verified_at: Date | null;
  entered_manually: boolean;
  source_id: string;
  source_name: string;
  source_role: string;
  marketplace_kind?: string;
  title_raw: string;
  url: string | null;
  image_url: string | null;
  size_raw: string | null;
  supersedes_id: string | null;
  is_head: boolean;
};

/** Every snapshot for an item — the price history is this list. */
export async function itemObservations(itemId: string) {
  return query<Observation>(
    `select l.id, l.price, l.currency, l.price_base, l.fx_rate_at_snapshot,
            l.condition_tier::text as condition_tier, l.condition_raw,
            l.evidence::text as evidence, l.status::text as status,
            l.date_seen, l.last_verified_at, l.entered_manually,
            l.source_id, s.display_name as source_name, s.role::text as source_role,
            s.marketplace_kind::text as marketplace_kind,
            l.title_raw, l.url, l.image_url, l.size_raw, l.supersedes_id,
            not exists (select 1 from listings sup where sup.supersedes_id = l.id) as is_head
       from listings l
       join sources s on s.id = l.source_id
      where l.item_id = $1
      order by l.date_seen asc`,
    [itemId],
  );
}

export type ItemSort = 'name' | 'listings' | 'lowest' | 'newest' | 'ad_year' | 'subline';

export async function listItems(sort: ItemSort = 'name') {
  const orders: Record<ItemSort, string> = {
    name: 'i.canonical_name asc',
    listings: 'listing_count desc, i.canonical_name asc',
    lowest: 'lowest_active asc nulls last',
    newest: 'last_seen desc nulls last',
    // Newest AD year first; unknown years sink rather than sorting as zero.
    ad_year: 'i.ad_year desc nulls last, i.canonical_name asc',
    subline: 'sub.display_name asc nulls last, i.canonical_name asc',
  };

  return query<
    ItemRow & { lowest_active: number | null; exit_comps: number; last_seen: Date | null }
  >(
    `select i.id, i.canonical_name, i.subline_id, i.ad_year, i.ad_year_status,
            sub.display_name as subline_name,
            (select count(*) from listings l where l.item_id = i.id)::int as listing_count,
            (select count(*) from listings l
               join sources s on s.id = l.source_id
              where l.item_id = i.id and s.role in ('exit', 'both'))::int as exit_comps,
            (select min(coalesce(l.price_base, l.price)) from listings l
              where l.item_id = i.id and l.status = 'active') as lowest_active,
            (select max(l.date_seen) from listings l where l.item_id = i.id) as last_seen
       from items i
       left join sublines sub on sub.id = i.subline_id
      order by ${orders[sort] ?? orders.name}
      limit 200`,
  );
}

// ---------------------------------------------------------------------------
// Sources, routes and poll health (phase 3)
// ---------------------------------------------------------------------------

export type SourceRow = {
  id: string;
  display_name: string;
  tier: string;
  role: string;
  automation_allowed: boolean;
  automation_block_reason: string | null;
  permission_status: string;
  config: Record<string, unknown>;
  last_good_count: number | null;
  last_good_poll_at: Date | null;
  active_listings: number;
  last_run_ok: boolean | null;
  last_run_at: Date | null;
  last_run_error: string | null;
};

export async function listSources() {
  return query<SourceRow>(
    `select s.id, s.display_name, s.tier::text as tier, s.role::text as role,
            s.automation_allowed, s.automation_block_reason,
            s.permission_status::text as permission_status,
            s.config, s.last_good_count, s.last_good_poll_at,
            (select count(*) from listings l
              where l.source_id = s.id and l.status = 'active')::int as active_listings,
            r.ok as last_run_ok, r.started_at as last_run_at, r.error as last_run_error
       from sources s
       left join lateral (
         select ok, started_at, error from poll_runs
          where source_id = s.id order by started_at desc limit 1
       ) r on true
      order by s.role, s.id`,
  );
}

export type RouteRow = {
  id: string;
  display_name: string;
  acquisition_source: string;
  exit_source: string;
  acquisition_name: string;
  exit_name: string;
  active: boolean;
  notes: string | null;
  proxy_fee_pct: number;
  proxy_fee_flat: number;
  domestic_ship_flat: number;
  intl_ship_flat: number;
  import_vat_pct: number;
  customs_duty_pct: number;
  sale_fee_pct: number;
  payment_fee_pct: number;
  outbound_ship_flat: number;
  currency: string;
  /** When a human last checked this stack. Null means it is still the seed's guess. */
  costs_confirmed_at: Date | null;
};

export async function listRoutes() {
  return query<RouteRow>(
    `select r.*, a.display_name as acquisition_name, e.display_name as exit_name
       from routes r
       join sources a on a.id = r.acquisition_source
       join sources e on e.id = r.exit_source
      order by r.active desc, r.display_name`,
  );
}

export async function recentPollRuns(limit = 30) {
  return query<{
    id: number;
    source_id: string;
    started_at: Date;
    finished_at: Date | null;
    ok: boolean;
    results_count: number | null;
    previous_count: number | null;
    error: string | null;
    suspect_shrink: boolean;
  }>(
    `select id, source_id, started_at, finished_at, ok, results_count,
            previous_count, error, suspect_shrink
       from poll_runs order by started_at desc limit $1`,
    [limit],
  );
}

// ---------------------------------------------------------------------------
// Scoring inputs (phase 4)
// ---------------------------------------------------------------------------

export type Candidate = {
  id: string;
  item_id: string;
  brand_id: string | null;
  title_raw: string;
  price: number;
  currency: string;
  price_base: number | null;
  condition_tier: string | null;
  size_raw: string | null;
  size_region: string;
  url: string | null;
  image_url: string | null;
  source_id: string;
  source_name: string;
  source_role: string;
  marketplace_kind?: string;
  date_seen: Date;
  /** First sighting. Null on rows predating the column — see 017. */
  first_seen_at: Date | null;
  last_verified_at: Date | null;
  entered_manually: boolean;
  subline_name: string | null;
  ad_year: number | null;
  canonical_name: string;
};

/**
 * How many candidates one pass will score.
 *
 * A cap has to exist — every candidate pulls a comp set and the page holds all
 * of it in memory — but the old one was 300, and 300 of what mattered as much
 * as the number. The rows come back newest first, so once a catalogue passed
 * three hundred buyable pieces the ranking was computed over the three hundred
 * most recently seen and the best opportunity in the database could be absent
 * from the screen whose entire job is to name it. Silently: nothing said the
 * list had been cut.
 *
 * So it is high enough that reaching it is unusual, and reaching it is now
 * something the page can see and say — /opportunities compares this against the
 * census and prints the shortfall rather than quietly ranking a slice.
 */
export const SCORING_CANDIDATE_LIMIT = 2000;

/**
 * Active listings on ACQUISITION sources that are matched to an item.
 *
 * Exit-venue listings are excluded as candidates on purpose: a Grailed listing
 * is not something you buy in this pipeline, it is the yardstick you measure
 * against. Including them would score buying at the exit venue and selling into
 * it, which is a fee-stack loss by construction.
 */
export async function scoringCandidates() {
  return query<Candidate>(
    `select l.id, l.item_id, l.title_raw, l.price, l.currency, l.price_base,
            l.condition_tier::text as condition_tier, l.size_raw,
            l.size_region::text as size_region, l.url, l.image_url,
            l.source_id, s.display_name as source_name, s.role::text as source_role,
            s.marketplace_kind::text as marketplace_kind,
            l.date_seen, l.first_seen_at, l.last_verified_at, l.entered_manually,
            sub.display_name as subline_name, i.ad_year, i.canonical_name, i.brand_id
       from listings l
       join sources s on s.id = l.source_id
       join items i on i.id = l.item_id
       left join sublines sub on sub.id = i.subline_id
      where l.status = 'active'
        and s.role in ('acquisition', 'both')
        and not exists (select 1 from listings sup where sup.supersedes_id = l.id)
        and not exists (
          select 1 from review_actions ra
           where ra.listing_id = l.id and ra.action = 'dismissed'
             and ra.created_at = (select max(created_at) from review_actions r2 where r2.listing_id = l.id)
        )
      order by l.date_seen desc
      limit ${SCORING_CANDIDATE_LIMIT}`,
  );
}

/**
 * All observations for a set of items, in one round trip.
 *
 * Items the seller described incompletely also see their siblings.
 *
 * Identity is `subline|adYear|type|material|model`, and anything unstated keys
 * as `?` — its own bucket, correctly, since a coat of unknown fibre is not
 * known to be the wool one. But feed titles routinely omit the fibre ("HOMME
 * PLUS AD2002 tailored jacket"), so those items would sit alone forever with a
 * comp set of one and never be valued, which is the same as not collecting
 * them. So an item with a `?` draws comps from items that agree on everything
 * it does know, and those observations are flagged as borrowed.
 *
 * The rule itself is in comps.mjs, where the integration test can run the
 * same SQL this does.
 *
 * ONE COMP PER PIECE, not one per snapshot.
 *
 * `listings` is a snapshot log: a re-price inserts a new row pointing at the
 * one it supersedes, and the table IS the price history. That makes it the
 * wrong thing to count. A single jacket whose seller cut its price twice wrote
 * three rows, and this query returned all three — so one garment on one venue
 * satisfied the three-comp minimum by itself, was reported as a SETTLED
 * estimate rather than a provisional one, and carried a confidence figure built
 * from a volume factor that had counted the same piece three times. The median
 * it produced sat at the price the seller had already abandoned.
 *
 * Nothing about that surfaces as an error. It surfaces as a number, on the
 * screen the whole platform exists to put numbers on.
 *
 * So only the head of each chain is a comp — the piece as it stands now, at its
 * current price, carrying whatever evidence it ended with. The superseded rows
 * are not discarded: they are the price history, and `itemObservations` still
 * returns every one of them for the item page and its chart, which is where a
 * sequence of prices means something.
 */
export async function observationsForItems(itemIds: string[]) {
  if (!itemIds.length) return new Map<string, Observation[]>();
  const rows = await query<Observation & { item_id: string; borrowed: boolean }>(
    `with ${VISIBLE_ITEMS_CTE}
     select v.for_item as item_id, v.borrowed,
            l.id, l.price, l.currency, l.price_base, l.fx_rate_at_snapshot,
            l.condition_tier::text as condition_tier, l.condition_raw,
            l.evidence::text as evidence, l.status::text as status,
            l.date_seen, l.last_verified_at, l.entered_manually,
            l.source_id, s.display_name as source_name, s.role::text as source_role,
            s.marketplace_kind::text as marketplace_kind,
            l.title_raw, l.url, l.image_url, l.size_raw, l.supersedes_id,
            true as is_head
       from visible v
       join listings l on l.item_id = v.from_item
       join sources s on s.id = l.source_id
      where ${HEAD_OF_CHAIN}`,
    [itemIds],
  );
  const grouped = new Map<string, Observation[]>();
  for (const row of rows) {
    if (!grouped.has(row.item_id)) grouped.set(row.item_id, []);
    grouped.get(row.item_id)!.push(row);
  }
  return grouped;
}

// ---------------------------------------------------------------------------
// Alerting (phase 6)
// ---------------------------------------------------------------------------

export type AlertRuleRow = {
  id: string;
  display_name: string;
  enabled: boolean;
  min_profit_base: number | null;
  min_spread_pct: number | null;
  min_confidence: number | null;
  include_provisional: boolean;
  include_flagged: boolean;
  subline_id: string | null;
  source_id: string | null;
  route_id: string | null;
  channel: string;
  webhook_url: string | null;
  mode: string;
  fired_count: number;
  last_fired_at: Date | null;
};

/**
 * Every item a listing could plausibly be, for the matchmaker to score.
 *
 * Narrowed by house, which is the one thing the matchmaker will never cross
 * and the cheapest filter there is. Everything finer — year, garment,
 * material, model — is decided by the scoring, because those are the
 * comparisons that have to state what they agreed on.
 */
export async function itemsForBrands(brandIds: string[]) {
  if (!brandIds.length) return [];
  return query<{
    id: string;
    identity_key: string;
    canonical_name: string;
    brand_id: string;
    subline_id: string | null;
    ad_year: number | null;
    listings: number;
  }>(
    `select i.id, i.identity_key, i.canonical_name, i.brand_id, i.subline_id, i.ad_year,
            (select count(*) from listings l where l.item_id = i.id)::int as listings
       from items i
      where i.brand_id = any($1::text[])
      order by i.canonical_name
      limit 2000`,
    [brandIds],
  );
}

export async function listAlertRules() {
  return query<AlertRuleRow>(
    `select r.*,
            (select count(*) from alerts a where a.rule_id = r.id)::int as fired_count,
            (select max(a.created_at) from alerts a where a.rule_id = r.id) as last_fired_at
       from alert_rules r order by r.enabled desc, r.id`,
  );
}

export type AlertRow = {
  id: number;
  rule_id: string;
  rule_name: string;
  listing_id: string;
  item_id: string | null;
  title_raw: string;
  url: string | null;
  image_url: string | null;
  source_name: string;
  profit_base: number | null;
  spread_pct: number | null;
  confidence: number | null;
  provisional: boolean;
  flags: string[];
  route_id: string | null;
  observed_at: Date;
  published_at: Date | null;
  sent_at: Date | null;
  delivery_ok: boolean;
  delivery_error: string | null;
  created_at: Date;
  latency_seconds: number | null;
};

export async function listAlerts(limit = 50) {
  return query<AlertRow>(
    `select a.*, r.display_name as rule_name, l.title_raw, l.url, l.image_url,
            s.display_name as source_name,
            case when a.sent_at is not null
                 then extract(epoch from (a.sent_at - coalesce(a.published_at, a.observed_at)))
            end as latency_seconds
       from alerts a
       join alert_rules r on r.id = a.rule_id
       join listings l on l.id = a.listing_id
       join sources s on s.id = l.source_id
      order by a.created_at desc limit $1`,
    [limit],
  );
}

/**
 * Pipeline latency, the metric the brief calls a feature.
 *
 * Reported separately by basis: measuring from our own first sighting flatters
 * the number, because it excludes however long we took to notice.
 */
export async function latencyStats() {
  const rows = await query<{
    basis: string;
    n: number;
    median_seconds: number | null;
    p90_seconds: number | null;
    worst_seconds: number | null;
  }>(
    `select 'source publish time' as basis,
            count(*)::int as n,
            percentile_cont(0.5) within group (order by published_to_sent_seconds) as median_seconds,
            percentile_cont(0.9) within group (order by published_to_sent_seconds) as p90_seconds,
            max(published_to_sent_seconds) as worst_seconds
       from alert_latency where published_to_sent_seconds is not null
     union all
     select 'our first sighting',
            count(*)::int,
            percentile_cont(0.5) within group (order by observed_to_sent_seconds),
            percentile_cont(0.9) within group (order by observed_to_sent_seconds),
            max(observed_to_sent_seconds)
       from alert_latency where observed_to_sent_seconds is not null`,
  );
  return rows.filter((r) => Number(r.n) > 0);
}

// ---------------------------------------------------------------------------
// Cultural heat (phase 7)
// ---------------------------------------------------------------------------

export type HeatSubject = {
  id: number;
  subject_type: string;
  brand_id: string | null;
  subline_id: string | null;
  item_id: string | null;
  label: string;
  wikipedia_title: string | null;
  enabled: boolean;
  signal_points: number;
};

export async function listHeatSubjects() {
  return query<HeatSubject>(
    `select s.*,
            (select count(*) from heat_signals g where g.subject_id = s.id)::int as signal_points
       from heat_subjects s
      where s.enabled
      order by s.subject_type, s.label`,
  );
}

/**
 * Everything the heat model needs for one subject, in one round trip.
 *
 * Listings are scoped to the subject: a sub-line subject sees every listing for
 * every item in that sub-line; an item subject sees only its own.
 */
export async function heatInputs(subject: HeatSubject) {
  const where =
    subject.subject_type === 'item'
      ? 'l.item_id = $1'
      : subject.subject_type === 'subline'
        ? 'i.subline_id = $1'
        : 'i.brand_id = $1';
  const param =
    subject.subject_type === 'item'
      ? subject.item_id
      : subject.subject_type === 'subline'
        ? subject.subline_id
        : subject.brand_id;

  const [listings, signals] = await Promise.all([
    query<{
      id: string;
      price_base: number | null;
      date_seen: Date;
      first_seen: Date;
      closed_at: Date | null;
      status: string;
      source_role: string;
  marketplace_kind?: string;
    }>(
      `select l.id, l.price_base, l.date_seen, l.status::text as status,
              s.role::text as source_role,
              -- created_at is when this snapshot first appeared; date_seen is
              -- the last time it was observed present. The span between them is
              -- how long it sat on the market AT THIS PRICE.
              --
              -- Approximation worth knowing: a re-priced listing becomes two
              -- snapshots, so its total dwell is split across them and turnover
              -- reads slightly faster than reality. Acceptable for a soft
              -- signal; it would not be for a price.
              l.created_at as first_seen,
              case when l.status in ('delisted','sold_confirmed') then l.date_seen end as closed_at
         from listings l
         join items i on i.id = l.item_id
         join sources s on s.id = l.source_id
        where ${where}
        order by l.date_seen desc
        limit 2000`,
      [param],
    ),
    query<{ value: number; period_start: Date; source: string }>(
      `select value, period_start, source from heat_signals
        where subject_id = $1 order by period_start asc limit 400`,
      [subject.id],
    ),
  ]);

  return { listings, signals };
}

/**
 * The measured ratio between what pieces really sold for and what this
 * platform estimated, per brand and venue.
 *
 * Keyed "brand|venue" so scoring can look one up without a query per row.
 */
export async function calibrationRatios() {
  const rows = await query<{
    brand_id: string | null;
    venue: string;
    observations: number;
    ratio: number;
  }>(`select brand_id, venue, observations, ratio from calibration`);

  const map = new Map<string, { observations: number; ratio: number }>();
  for (const r of rows) {
    map.set(`${r.brand_id ?? '?'}|${r.venue}`, {
      observations: Number(r.observations),
      ratio: Number(r.ratio),
    });
  }
  return map;
}

/**
 * The counts behind "why is /opportunities empty".
 *
 * One round trip, because it runs on a page that is already doing three. The
 * numbers are deliberately the same shapes the scoring path uses — an active
 * listing, matched, on a source with the right role — so the diagnosis cannot
 * drift from the thing it diagnoses.
 *
 * Retail is excluded from the exit count for the same reason resaleEstimate
 * excludes it: a boutique's asking price is not a comp for an archive piece.
 */
export async function pipelineCensus() {
  const row = await one<{
    listings: number;
    matched: number;
    acquisition_active: number;
    exit_observations: number;
    routes: number;
    routes_confirmed: number;
    unconvertible: number;
  }>(
    `select
       (select count(*) from listings where status = 'active')::int as listings,
       (select count(*) from listings where status = 'active' and item_id is not null)::int as matched,
       (select count(*) from listings l join sources s on s.id = l.source_id
         where l.status = 'active' and l.item_id is not null
           and s.role in ('acquisition','both'))::int as acquisition_active,
       -- Head of chain only, exactly as observationsForItems counts them: a
       -- re-priced listing is one comp, not one per price it has worn.
       (select count(*) from listings l join sources s on s.id = l.source_id
         where l.item_id is not null and s.role in ('exit','both')
           and s.marketplace_kind <> 'retail'
           and not exists (select 1 from listings sup where sup.supersedes_id = l.id))::int
         as exit_observations,
       (select count(*) from routes)::int as routes,
       (select count(*) from routes where costs_confirmed_at is not null)::int as routes_confirmed,
       -- A price nothing can compare: price_base is stamped once at insert and
       -- every comparison in the platform reads it, so a null there makes the
       -- row invisible rather than imprecise.
       (select count(*) from listings
         where status = 'active' and price is not null and price_base is null)::int as unconvertible`,
  );
  return {
    listings: Number(row?.listings ?? 0),
    matched: Number(row?.matched ?? 0),
    acquisitionActive: Number(row?.acquisition_active ?? 0),
    exitObservations: Number(row?.exit_observations ?? 0),
    routes: Number(row?.routes ?? 0),
    routesConfirmed: Number(row?.routes_confirmed ?? 0),
    unconvertible: Number(row?.unconvertible ?? 0),
  };
}

/**
 * Every listing's time on the market, per source.
 *
 * One query for the whole page: the survival curve is a property of a VENUE,
 * not of a listing, so it is computed once per source and read for each row.
 *
 * Deliberately reads the whole log rather than active rows — the departed ones
 * are the entire signal, and the live ones are what stop the estimate being
 * biased toward the pieces that happened to sell.
 *
 * ONE SPAN PER PIECE, MEASURED END TO END.
 *
 * A re-priced listing is a chain of snapshot rows, and each row carries a
 * `first_seen_at` of its own — the moment that PRICE reached the market, which
 * is what pollRunner means by it and is not when the piece did. Reading the log
 * row by row therefore produced one span per price rather than one per piece,
 * every extra span short and none of them ever departing. Kaplan-Meier counts a
 * censored span in the at-risk pool for as long as it was known to survive, so
 * those short never-departing entries padded the denominator at exactly the
 * early times where the curve does its steepest work: the estimate came out
 * flatter than the market, pieces read as lasting longer than they do, and the
 * urgency band under-stated how fast a venue moves. Taking only the head row
 * instead would trade that for the opposite error, starting the clock at the
 * last price cut and reporting a jacket that has sat for five months as days
 * old.
 *
 * So the chain is walked from its root: the span starts where the piece first
 * appeared, ends at the head's last confirmation, and departs only if the head
 * departed. That is the duration the piece actually had.
 */
export async function marketSpans() {
  const rows = await query<{
    source_id: string;
    first_seen_at: Date | null;
    date_seen: Date;
    last_verified_at: Date | null;
    status: string;
  }>(
    // Forward from the roots, because that is the direction a recursive CTE can
    // travel: a row nothing supersedes is the first sighting of a piece, and
    // each step follows supersedes_id to the next price it wore. `started` is
    // carried down unchanged, so every row in a chain knows when its piece
    // arrived. The index added in 018 is what makes the walk cheap.
    //
    // A row with no first_seen_at predates the column and is skipped rather
    // than started from date_seen: that yields a floor, and a floor read as a
    // duration says the piece sold quickly, which is the direction of error
    // that manufactures urgency. survival.mjs makes the same refusal.
    `with recursive chain as (
       select l.id as node, l.first_seen_at as started
         from listings l
        where l.supersedes_id is null
          and l.first_seen_at is not null
          and l.first_seen_at > now() - interval '400 days'
       union all
       select next.id, c.started
         from chain c
         join listings next on next.supersedes_id = c.node
     )
     select l.source_id, c.started as first_seen_at, l.date_seen,
            l.last_verified_at, l.status::text as status
       from chain c
       join listings l on l.id = c.node
      where ${HEAD_OF_CHAIN}
      order by c.started desc
      limit 20000`,
  );
  const bySource = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = bySource.get(row.source_id) ?? [];
    list.push(row);
    bySource.set(row.source_id, list);
  }
  return bySource;
}
