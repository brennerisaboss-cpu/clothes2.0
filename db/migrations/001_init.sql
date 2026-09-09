-- Phase 1 schema.
--
-- Design rules carried from the brief, enforced here rather than in app code
-- wherever Postgres can do it:
--   * `listings` is an append-mostly snapshot log, not a live row. Price history
--     IS this table.
--   * A disappearance is never a sale. `status` has no value that means "sold"
--     unless a source actually told us so (`sold_confirmed`).
--   * Comps are never pooled across sub-line or condition tier, so both are
--     first-class columns, not free text.
--   * FX is stored per row at observation time. Never recompute historical rows
--     at today's rate.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- Ordered worst -> best so comparisons and adjacent-tier logic work later.
create type condition_tier as enum (
  'damaged', 'fair', 'good', 'excellent', 'new', 'new_with_tags'
);

create type size_region as enum ('EU', 'US', 'UK', 'JP', 'IT', 'FR', 'ALPHA', 'UNKNOWN');

-- Note the absence of a bare 'sold'. Inferring a sale is not representable.
create type listing_status as enum (
  'active',          -- seen in the most recent successful observation
  'delisted',        -- gone, and we have positive evidence it is gone
  'sold_confirmed',  -- the source explicitly said it sold
  'relisted',        -- superseded by a later listing we linked to it
  'unknown'          -- default; we genuinely do not know
);

-- How a price observation reached us. Drives comp weighting in phase 4.
create type evidence_class as enum (
  'confirmed_sale',      -- source stated a sale at a known price
  'active_ask',          -- currently listed at this price
  'inferred_disappearance' -- vanished; a guess, never treated as a sale
);

create type source_tier as enum ('manual', 'api', 'feed');

create type permission_status as enum ('not_asked', 'asked', 'granted', 'declined');

-- ---------------------------------------------------------------------------
-- Sources
-- ---------------------------------------------------------------------------

create table sources (
  id                text primary key,          -- 'grailed', 'vestiaire', ...
  display_name      text not null,
  tier              source_tier not null,
  -- Hard block. Terms-prohibited sources can never gain an automated adapter;
  -- the constraint below makes that a schema-level fact, not a convention.
  automation_allowed boolean not null default false,
  automation_block_reason text,
  base_url          text,
  permission_status permission_status not null default 'not_asked',
  permission_note   text,
  -- Poll cadence is per source: fast sources turn over in minutes, a one-person
  -- shop in weeks. One global schedule would be wrong for both.
  poll_interval_minutes integer,
  created_at        timestamptz not null default now(),

  constraint manual_sources_are_never_automated
    check (not (tier = 'manual' and automation_allowed)),
  constraint blocked_sources_explain_themselves
    check (automation_allowed or automation_block_reason is not null),
  -- Honour a decline permanently.
  constraint declined_shops_are_never_polled
    check (permission_status <> 'declined' or not automation_allowed)
);

-- ---------------------------------------------------------------------------
-- Brand / sub-line vocabulary
-- ---------------------------------------------------------------------------

create table brands (
  id           text primary key,
  display_name text not null,
  monitored    boolean not null default true
);

-- Sub-line is the single biggest driver of value for CDG, so it is its own
-- entity and must be resolved before any price comparison happens.
create table sublines (
  id            text primary key,
  brand_id      text not null references brands(id) on delete cascade,
  display_name  text not null,
  -- Excluded from monitoring but still resolvable, so a Play listing is
  -- recognised and filtered rather than silently matched into mainline comps.
  monitored     boolean not null default true,
  -- True where the name is genuinely ambiguous in listing titles (e.g. "CDG",
  -- which is both the diffusion line and the abbreviation for the whole house).
  -- Ambiguous sublines are never auto-matched.
  ambiguous     boolean not null default false,
  note          text
);

create table brand_aliases (
  id          bigserial primary key,
  brand_id    text not null references brands(id) on delete cascade,
  subline_id  text references sublines(id) on delete cascade,
  alias       text not null,
  -- Normalised form used for lookup: casefolded, de-accented, punctuation
  -- stripped. Computed in app code so Latin and Japanese share one path.
  alias_norm  text not null,
  script      text not null default 'latin',   -- 'latin' | 'ja'
  -- An alias that resolves the brand but NOT the subline (e.g. bare "CDG").
  -- These must be flagged for manual resolution rather than auto-matched.
  resolves_subline boolean not null default true,
  unique (alias_norm, script)
);

create index on brand_aliases (alias_norm);

-- ---------------------------------------------------------------------------
-- Canonical items
-- ---------------------------------------------------------------------------

create table items (
  id             uuid primary key default gen_random_uuid(),
  brand_id       text not null references brands(id),
  subline_id     text references sublines(id),
  model          text,
  canonical_name text not null,
  -- AD year is identity, not annotation: the same model in AD1995 and AD2002
  -- are different items with different values. Null is ambiguous on its own,
  -- so ad_year_status says WHY it is null.
  ad_year        integer,
  ad_year_status text not null default 'unknown'
    check (ad_year_status in ('known', 'pre_ad_era', 'absent_from_tag', 'unknown')),
  season_year    integer,
  notes          text,
  created_at     timestamptz not null default now(),

  constraint ad_year_present_iff_known
    check ((ad_year_status = 'known') = (ad_year is not null)),
  -- AD tagging began ~1988; anything earlier is pre_ad_era by definition.
  constraint ad_year_plausible
    check (ad_year is null or (ad_year between 1988 and 2100))
);

create index on items (brand_id, subline_id);

-- ---------------------------------------------------------------------------
-- Listings: the snapshot log
-- ---------------------------------------------------------------------------

create table listings (
  id                  uuid primary key default gen_random_uuid(),
  item_id             uuid references items(id) on delete set null,
  source_id           text not null references sources(id),
  source_item_id      text,

  brand_raw           text,
  title_raw           text not null,
  size_raw            text,
  size_region         size_region not null default 'UNKNOWN',

  condition_raw       text,
  condition_tier      condition_tier,

  price               numeric(12,2) not null check (price >= 0),
  currency            char(3) not null,
  price_base          numeric(12,2) check (price_base >= 0),
  fx_rate_at_snapshot numeric(18,8) check (fx_rate_at_snapshot > 0),

  shipping_estimate   numeric(12,2),
  url                 text,
  image_url           text,

  status              listing_status not null default 'unknown',
  evidence            evidence_class not null default 'active_ask',

  date_seen           timestamptz not null default now(),
  -- Did the observation that produced this row succeed? A failed poll must
  -- never be able to mark anything delisted, so this is recorded per row.
  last_poll_ok        boolean not null default true,

  -- Manual-tier freshness. Null for API rows, which carry their own recency
  -- via date_seen.
  last_verified_at    timestamptz,
  entered_manually    boolean not null default false,

  -- Relist linkage: points at the listing this one supersedes. Set only when
  -- we have positive evidence (same seller + near-identical title/image within
  -- a short window), never inferred from a gap.
  supersedes_id       uuid references listings(id) on delete set null,

  notes               text,
  created_at          timestamptz not null default now(),

  -- FX must travel as a set: a converted price is meaningless without the rate
  -- that produced it.
  constraint fx_is_all_or_nothing
    check ((price_base is null) = (fx_rate_at_snapshot is null)),
  -- A sale is only ever recorded when a source confirmed it.
  constraint only_confirmed_sales_claim_sales
    check ((evidence = 'confirmed_sale') = (status = 'sold_confirmed')),
  -- Manual entries must carry a verification timestamp; that is what the
  -- staleness decay is computed from.
  constraint manual_entries_are_verifiable
    check (not entered_manually or last_verified_at is not null)
);

create index on listings (item_id, date_seen desc);
create index on listings (source_id, date_seen desc);
create index on listings (status) where status = 'active';
create index on listings (last_verified_at) where entered_manually;
create unique index listings_source_item_seen
  on listings (source_id, source_item_id, date_seen)
  where source_item_id is not null;

-- ---------------------------------------------------------------------------
-- Poll audit: the record that makes "never infer a delisting from a failed
-- poll" auditable after the fact.
-- ---------------------------------------------------------------------------

create table poll_runs (
  id             bigserial primary key,
  source_id      text not null references sources(id),
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  ok             boolean not null default false,
  results_count  integer,
  previous_count integer,
  error          text,
  -- Set when the run returned suspiciously fewer results than the previous one.
  -- A suspect run changes no statuses.
  suspect_shrink boolean not null default false
);

create index on poll_runs (source_id, started_at desc);

-- ---------------------------------------------------------------------------
-- FX rates, stored so historical conversions stay reproducible.
-- ---------------------------------------------------------------------------

create table fx_rates (
  id            bigserial primary key,
  base_currency char(3) not null,
  quote_currency char(3) not null,
  rate          numeric(18,8) not null check (rate > 0),
  as_of         timestamptz not null default now(),
  source        text,
  unique (base_currency, quote_currency, as_of)
);

-- ---------------------------------------------------------------------------
-- Condition vocabulary mapping, written down per source as the brief requires.
-- ---------------------------------------------------------------------------

create table condition_mappings (
  id            bigserial primary key,
  source_id     text not null references sources(id) on delete cascade,
  raw_label     text not null,
  raw_label_norm text not null,
  tier          condition_tier not null,
  note          text,
  unique (source_id, raw_label_norm)
);

-- ---------------------------------------------------------------------------
-- Manual review actions on the dashboard.
-- ---------------------------------------------------------------------------

create table review_actions (
  id         bigserial primary key,
  listing_id uuid not null references listings(id) on delete cascade,
  action     text not null check (action in ('reviewed', 'dismissed', 'bought', 'flagged')),
  note       text,
  created_at timestamptz not null default now()
);

create index on review_actions (listing_id, created_at desc);
