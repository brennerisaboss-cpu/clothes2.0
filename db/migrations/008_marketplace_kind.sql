-- What kind of market is this source?
--
-- Retail and secondhand prices answer different questions, and pooling them
-- corrupts the only number that matters. A boutique's full retail price for a
-- current-season piece is not a comp for a fifteen-year-old archive jacket; it
-- is a ceiling nobody pays on the resale market. Mixed into a comp set it
-- drags every resale estimate upward, which invents margin that is not there —
-- the exact direction of error that costs money rather than opportunities.
--
-- So the distinction is recorded on the source and enforced where comps are
-- gathered, rather than left to whoever adds the next shop to remember.

create type marketplace_kind as enum ('secondhand', 'retail');

alter table sources
  add column if not exists marketplace_kind marketplace_kind not null default 'secondhand';

-- The venues already known to be secondhand marketplaces stay as they are; the
-- default is deliberately 'secondhand' because that is what this platform is
-- for, and a retail shop is the exception that must be marked.

comment on column sources.marketplace_kind is
  'retail sources are never used as comps — their prices are a ceiling nobody pays on the resale market';
