-- A feed source must declare its currency. That is the whole rule.
--
-- This constraint has now been wrong twice for the same reason: it kept trying
-- to also specify HOW a source identifies itself. First it demanded a shop
-- `domain`, which a merchant product feed does not have. Then it allowed
-- `domain` or `url`, which an eBay source has neither of — it is identified by
-- its adapter and its searches.
--
-- Identity is the adapter's business and differs legitimately per adapter. The
-- part worth enforcing in the schema is the part that is catastrophic when
-- missing and identical for every adapter: a price with no currency is not a
-- small problem, it is a 150x one. So that is all this checks now.

alter table sources drop constraint if exists feed_sources_declare_currency;

alter table sources add constraint feed_sources_declare_currency check (
  tier <> 'feed'
  or (config ? 'currency' and (config ->> 'currency') ~ '^[A-Z]{3}$')
);
