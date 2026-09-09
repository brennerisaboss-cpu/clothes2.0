-- Feed sources (phase 3).
--
-- A Shopify shop is a row here, not new code: the generic adapter takes its
-- domain and currency from `config`, so adding a shop is a config line.

alter table sources add column config jsonb not null default '{}'::jsonb;

-- Currency is required for a feed source and must never be inferred. A
-- /products.json feed carries no currency, and guessing one from a domain TLD
-- would silently scale every price on the route by ~150x.
alter table sources add constraint feed_sources_declare_currency
  check (
    tier <> 'feed'
    or (config ? 'domain' and config ? 'currency'
        and config->>'currency' ~ '^[A-Z]{3}$')
  );

-- Track the last known-good catalogue size per source. The poll runner compares
-- against this to spot a suspicious shrink, which is what stops a silently
-- broken adapter from marking a whole shop as gone.
alter table sources add column last_good_count integer;
alter table sources add column last_good_poll_at timestamptz;
