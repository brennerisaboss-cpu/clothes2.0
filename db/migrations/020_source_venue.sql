-- One venue, observed more than one way.
--
-- A source is a way of collecting, and until now that was also assumed to be a
-- venue: one row per place, one adapter per row. eBay breaks the assumption.
-- Its Browse API returns ACTIVE listings and its Marketplace Insights API
-- returns COMPLETED SALES, they are different endpoints with different scopes
-- and different completeness properties, so they cannot be one source — and
-- they are unarguably one venue.
--
-- That matters because of one rule in scoring.mjs. Resale value prefers comps
-- from the venue actually being sold on, since a route charges that venue's
-- fees and venues genuinely differ. Implemented as `source_id = route.exit_source`,
-- it would have done something quietly terrible the moment sold data arrived:
-- an item with three eBay ASKS would scope to those three and drop every eBay
-- SALE out of the pool, because the sales sit under a different source id.
-- Trading the strongest evidence this platform can hold for a proxy of it, to
-- satisfy a boundary that is an artefact of how the data is fetched.
--
-- So sources carry the venue they observe. For every source that exists today
-- that is itself, which is why the backfill is the identity — the column adds a
-- distinction rather than changing any current behaviour.
alter table sources add column if not exists venue_id text;

update sources set venue_id = id where venue_id is null;

-- A source's venue is itself unless it says otherwise.
--
-- A default would express that if a column default could reference another
-- column, and it cannot, so it is a trigger. The alternative was leaving the
-- column nullable and coalescing at every read, which is two representations of
-- one fact and the sort of thing that is right in nine places and forgotten in
-- the tenth. Every existing writer — the seed, add-source, add-feed, add-ebay,
-- the fixtures — keeps working unchanged and gets the correct venue.
create or replace function sources_default_venue() returns trigger as $$
begin
  if new.venue_id is null then new.venue_id := new.id; end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists sources_venue_defaults_to_self on sources;
create trigger sources_venue_defaults_to_self
  before insert or update on sources
  for each row execute function sources_default_venue();

alter table sources alter column venue_id set not null;

comment on column sources.venue_id is
  'The marketplace this source observes. Usually the source id; different only '
  'where one venue is reached through more than one endpoint — eBay Browse and '
  'eBay Marketplace Insights are two sources and one venue. Comp pools scope to '
  'the venue, never to the endpoint.';

create index if not exists sources_venue_id on sources (venue_id);
