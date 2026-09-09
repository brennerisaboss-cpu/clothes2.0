-- An alert must not push a number nobody agreed to.
--
-- Rules fired on profit, provisional status and flags, but not on what the
-- margin rested on — so a figure computed entirely from asking prices, which
-- the opportunities screen now holds back by default, would still arrive as a
-- notification. That is the same fabricated profit, delivered more forcefully:
-- a screen you chose to look at can carry a caveat, a push notification is
-- read as "this is worth acting on now".
--
-- Default false, so existing rules become stricter rather than looser. A rule
-- that was firing on asks stops until it explicitly opts back in, which is the
-- safe direction for a change nobody is watching for.

alter table alert_rules
  add column if not exists include_asks_only boolean not null default false;

comment on column alert_rules.include_asks_only is
  'Fire on margins built only from asking prices. Off by default: a push notification reads as "act now", and an ask is nobody''s agreement.';
