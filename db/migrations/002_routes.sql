-- Arbitrage direction.
--
-- Correction from the operator, and it overrides the brief's framing: the
-- profitable pipeline in practice is
--
--     The RealReal / Japanese sites / individual shops  ->  Grailed / Vestiaire
--
-- The brief assumed the big platforms were purely the *valuation reference*
-- and small shops the acquisition surface. That is half right. The RealReal
-- turns out to be an acquisition surface too — so "big vs small" is the wrong
-- axis. The right axis is the role a source plays for THIS operator: where you
-- buy, and where you sell.
--
-- Direction matters because a spread is only real in one direction. The same
-- pair of prices is an opportunity Tokyo->Grailed and a loss Grailed->Tokyo,
-- and the fee stack differs on each leg.

create type source_role as enum (
  'acquisition',  -- where pieces are bought
  'exit',         -- where pieces are sold, and therefore the valuation reference
  'both'
);

alter table sources add column role source_role not null default 'acquisition';

-- A route is a directed acquisition -> exit pair with its own cost stack.
-- Scoring (phase 4) computes against a route, never against a bare price
-- difference, because the fees are what decide whether a spread survives.
create table routes (
  id                 text primary key,
  display_name       text not null,
  acquisition_source text not null references sources(id),
  exit_source        text not null references sources(id),
  active             boolean not null default true,
  notes              text,

  -- Cost components. All are ESTIMATES and labelled as such in the UI; none of
  -- these are hardcoded rates to be trusted as exact.
  --
  -- Acquisition side.
  proxy_fee_pct        numeric(6,4) not null default 0,  -- Buyee/ZenMarket cut
  proxy_fee_flat       numeric(10,2) not null default 0,
  domestic_ship_flat   numeric(10,2) not null default 0,  -- seller -> proxy warehouse
  intl_ship_flat       numeric(10,2) not null default 0,  -- proxy -> destination
  import_vat_pct       numeric(6,4) not null default 0,
  customs_duty_pct     numeric(6,4) not null default 0,

  -- Exit side.
  sale_fee_pct         numeric(6,4) not null default 0,   -- marketplace commission
  payment_fee_pct      numeric(6,4) not null default 0,
  outbound_ship_flat   numeric(10,2) not null default 0,

  currency           char(3) not null default 'EUR',
  updated_at         timestamptz not null default now(),

  constraint route_is_directed check (acquisition_source <> exit_source),
  unique (acquisition_source, exit_source)
);

create index on routes (active) where active;

comment on table routes is
  'Directed acquisition -> exit pairs. Every cost component is an estimate; the Japan->EU legs in particular (proxy fee plus two shipping legs plus import VAT) are what kill marginal-looking arbitrage, so they are modelled explicitly rather than folded into one shipping number.';
