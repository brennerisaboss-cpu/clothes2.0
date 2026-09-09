-- Calibrating an estimate against what actually happened.
--
-- Resale value here is the median of comps from venues that can be polled.
-- The venue you actually sell on may not be one of them, and no proxy tracks
-- it exactly: eBay runs low on hyped archive and high on mainstream designer,
-- and the gap is not noise — it is a consistent, brand-specific ratio.
--
-- A ratio like that can be measured rather than guessed at, but only against
-- ground truth. So: record what a piece really sold for, and the system learns
-- the multiplier between its own estimate and reality, per brand and venue.
--
-- Two observations is not a calibration and must not be presented as one, so
-- the count travels with the ratio everywhere it is used.

create table realised_sales (
  id              uuid primary key default gen_random_uuid(),
  item_id         uuid references items(id) on delete set null,
  brand_id        text references brands(id),
  subline_id      text references sublines(id),
  venue           text not null,              -- where it actually sold
  sold_price      numeric(12,2) not null check (sold_price > 0),
  currency        char(3) not null,
  sold_price_base numeric(12,2),
  fx_rate_at_sale numeric(18,8),
  sold_at         date not null,
  -- What this platform predicted at the time. Recorded rather than recomputed:
  -- the estimate that mattered is the one that was on screen when the decision
  -- was made, and re-deriving it later against today's comps would measure the
  -- wrong thing entirely.
  estimated_base  numeric(12,2),
  estimate_comps  integer,
  condition_tier  condition_tier,
  notes           text,
  created_at      timestamptz not null default now(),

  constraint sale_fx_is_all_or_nothing
    check ((sold_price_base is null) = (fx_rate_at_sale is null))
);

create index realised_sales_brand on realised_sales (brand_id, venue);
create index realised_sales_subline on realised_sales (subline_id, venue);

-- The ratio of reality to estimate, per brand and venue.
--
-- The MEDIAN, not the mean: one piece that went for five times its estimate is
-- a story, not a trend, and an average would let it move every future number.
create view calibration as
select
  brand_id,
  venue,
  count(*)::int as observations,
  percentile_cont(0.5) within group (
    order by sold_price_base / nullif(estimated_base, 0)
  ) as ratio,
  min(sold_at) as first_sale,
  max(sold_at) as last_sale
from realised_sales
where estimated_base is not null
  and estimated_base > 0
  and sold_price_base is not null
group by brand_id, venue;

comment on view calibration is
  'Median realised/estimated ratio per brand and venue. Always read alongside `observations` — a ratio from two sales is an anecdote.';
