-- Alerting (phase 6).
--
-- Push beats pull: on a fast source a good listing has one buyer, so analysis
-- that arrives late is worthless however good it is. The dashboard is for
-- browsing; the alert is what actually drives a purchase.

-- When a listing was published at the SOURCE, where the source tells us.
-- Distinct from date_seen, which is when WE first saw it. The gap between the
-- two is our pipeline's latency, and it is the number worth optimising.
alter table listings add column source_published_at timestamptz;

comment on column listings.source_published_at is
  'Publish time as stated by the source. NULL where the source does not say — in which case latency can only be measured from when we first observed it, which understates the true delay.';

create table alert_rules (
  id            text primary key,
  display_name  text not null,
  enabled       boolean not null default true,

  -- Thresholds. All optional; a null means "do not filter on this".
  min_profit_base   numeric(12,2),
  min_spread_pct    numeric(6,4),
  min_confidence    numeric(4,3),

  -- A provisional score rests on fewer comps than the minimum. Off by default:
  -- an alert is a call to act now, and a thin estimate is not that.
  include_provisional boolean not null default false,
  -- A high-severity flag means "verify before acting". Those are still worth
  -- knowing about, so they are included by default but always carry their
  -- flags into the message.
  include_flagged     boolean not null default true,

  -- Narrowing. Null means all.
  subline_id    text references sublines(id) on delete set null,
  source_id     text references sources(id) on delete set null,
  route_id      text references routes(id) on delete set null,

  -- Delivery.
  channel       text not null default 'discord' check (channel in ('discord', 'none')),
  webhook_url   text,
  -- Digests batch instead of firing per listing.
  mode          text not null default 'realtime' check (mode in ('realtime', 'digest')),

  created_at    timestamptz not null default now(),

  constraint discord_rules_need_a_webhook
    check (channel <> 'discord' or webhook_url is not null)
);

create table alerts (
  id            bigserial primary key,
  rule_id       text not null references alert_rules(id) on delete cascade,
  listing_id    uuid not null references listings(id) on delete cascade,
  item_id       uuid references items(id) on delete set null,

  -- What was true at the moment of alerting. Stored rather than recomputed so
  -- the history stays honest when comps later move.
  profit_base   numeric(12,2),
  spread_pct    numeric(6,4),
  confidence    numeric(4,3),
  provisional   boolean not null default false,
  flags         text[] not null default '{}',
  route_id      text references routes(id) on delete set null,

  -- Latency, the metric the brief calls a feature.
  observed_at   timestamptz not null,     -- when we first saw the listing
  published_at  timestamptz,              -- when the source published it, if known
  sent_at       timestamptz,              -- when delivery succeeded
  delivery_ok   boolean not null default false,
  delivery_error text,

  created_at    timestamptz not null default now(),

  -- One alert per rule per listing snapshot. A price change writes a new
  -- snapshot row, so a genuine re-price alerts again; an unchanged listing
  -- seen on every poll does not.
  unique (rule_id, listing_id)
);

create index on alerts (created_at desc);
create index on alerts (rule_id, created_at desc);
create index on alerts (delivery_ok) where not delivery_ok;

-- Latency in seconds, from first observation to successful delivery.
create view alert_latency as
  select a.id, a.rule_id, a.listing_id, a.sent_at,
         extract(epoch from (a.sent_at - a.observed_at)) as observed_to_sent_seconds,
         case when a.published_at is not null
              then extract(epoch from (a.sent_at - a.published_at))
         end as published_to_sent_seconds
    from alerts a
   where a.delivery_ok and a.sent_at is not null;
