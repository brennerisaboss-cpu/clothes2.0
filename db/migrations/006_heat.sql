-- Cultural heat (phase 7).
--
-- Some pieces carry value beyond scarcity: they are being talked about, worn by
-- people who set taste, resurfacing in discussion. That social capital shows up
-- in price later, which is exactly why it is worth watching early.
--
-- The deliberate design decision: heat is a SEPARATE AXIS from the arbitrage
-- score, never a multiplier on it. Profit is computed from comps and a fee
-- stack, both of which are measurable. Heat is inference from attention. Mixing
-- them would let a vibe quietly inflate a number the whole system exists to
-- keep honest.

create type heat_subject_type as enum ('brand', 'subline', 'item');

-- What we watch. A subject can carry an external identifier (a Wikipedia page
-- title, say) so an attention signal can be fetched for it.
create table heat_subjects (
  id            bigserial primary key,
  subject_type  heat_subject_type not null,
  brand_id      text references brands(id) on delete cascade,
  subline_id    text references sublines(id) on delete cascade,
  item_id       uuid references items(id) on delete cascade,
  label         text not null,
  -- Identifiers for external attention sources. Null means that source is not
  -- available for this subject and contributes nothing rather than zero.
  wikipedia_title text,
  enabled       boolean not null default true,
  created_at    timestamptz not null default now(),

  -- Exactly one target, matching the declared type.
  constraint heat_subject_target_matches_type check (
    (subject_type = 'brand'   and brand_id is not null and subline_id is null and item_id is null) or
    (subject_type = 'subline' and subline_id is not null and item_id is null) or
    (subject_type = 'item'    and item_id is not null)
  ),
  unique (subject_type, brand_id, subline_id, item_id)
);

-- Raw observations from external attention sources. Kept as a time series so a
-- trend can be computed rather than a single reading being mistaken for one.
create table heat_signals (
  id            bigserial primary key,
  subject_id    bigint not null references heat_subjects(id) on delete cascade,
  source        text not null,               -- 'wikipedia_pageviews', ...
  metric        text not null,               -- 'views'
  value         numeric(16,4) not null,
  period_start  timestamptz not null,
  period_end    timestamptz not null,
  fetched_at    timestamptz not null default now(),

  constraint period_is_ordered check (period_end > period_start),
  unique (subject_id, source, metric, period_start)
);

create index on heat_signals (subject_id, source, period_start desc);
