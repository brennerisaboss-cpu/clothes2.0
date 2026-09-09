-- Feed sources are not all shops.
--
-- The original constraint required every feed source to declare a `domain`,
-- because at the time every feed was a Shopify storefront. A merchant product
-- feed — the sanctioned affiliate route into venues that refuse crawlers — is
-- identified by a URL instead, and was rejected outright.
--
-- The currency half of the rule is the part that matters and it stays exactly
-- as strict: a feed source that has not said what it charges in is refused,
-- because a price without a currency is not a small problem but a 150x one.
-- What relaxes is only WHERE the source's identity lives.

alter table sources drop constraint if exists feed_sources_declare_currency;

alter table sources add constraint feed_sources_declare_currency check (
  tier <> 'feed'
  or (
    -- Identified by a shop domain, or by a feed URL. One or the other.
    (config ? 'domain' or config ? 'url')
    and config ? 'currency'
    and (config ->> 'currency') ~ '^[A-Z]{3}$'
  )
);
