-- Overseas purchase-agency eligibility (phase 5).
--
-- Yahoo!ショッピング added a per-item flag in February 2026 letting merchants
-- exclude products from overseas proxy-buying services. An excluded item cannot
-- be bought through Buyee or ZenMarket AT ALL, so offering a proxy link for one
-- sends you to a dead end at exactly the moment speed matters.
--
-- Three states, and the difference matters:
--   true   merchant permits proxy purchase
--   false  merchant has excluded it — suppress proxy links, and arguably the alert
--   null   the source did not say, which is not the same as "yes"
alter table listings add column proxy_purchasable boolean;

comment on column listings.proxy_purchasable is
  'Overseas purchase-agency eligibility as stated by the source. NULL means the source did not say — never treat that as permission.';

create index on listings (proxy_purchasable) where proxy_purchasable is false;
