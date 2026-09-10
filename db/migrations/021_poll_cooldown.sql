-- Leave a source alone when it asks to be left alone.
--
-- A 429 was treated as an ordinary failure, which means it was treated as a
-- reason to try again on the usual schedule. Every other failure is: a timeout,
-- a bad gateway, a parse error — try again in fifteen minutes, it may have been
-- transient. A rate limit is the one failure that is the shop TELLING you the
-- schedule is the problem, and answering it by keeping the schedule is how one
-- 429 becomes a shop that rate-limits robots.txt.
--
-- So it is recorded, and the next run skips the source until it expires. Where
-- the shop named a delay in `Retry-After`, that is the delay — its own number,
-- not a guess. Where it named none, a default long enough to matter.
alter table sources add column if not exists cooldown_until timestamptz;

comment on column sources.cooldown_until is
  'Set when a source answers 429. Polling skips it until this passes. From the '
  'shop''s own Retry-After where it gave one.';

create index if not exists sources_cooldown on sources (cooldown_until)
  where cooldown_until is not null;

-- The per-source cadence, which existed and was never read.
--
-- `poll_interval_minutes` has been in this table since the first migration, and
-- scripts/poll.mjs opens by explaining why it matters: "a fast marketplace
-- turns over in minutes, a one-person archive shop in weeks, and applying one
-- schedule to both is either rude or useless". It then selected every feed
-- source and polled all of them, on every tick — so a shop configured for every
-- twelve hours was being read every fifteen minutes, ninety-six times a day, by
-- a platform whose own documentation said it would not be.
--
-- Nothing to add for it: poll_runs already records started_at per source, and
-- is already indexed by (source_id, started_at desc). The column was there, the
-- history was there, and the WHERE clause was missing.
--
-- A default for rows that never set one, so "unset" means a sensible cadence
-- rather than "as often as the cron fires".
alter table sources alter column poll_interval_minutes set default 360;

update sources set poll_interval_minutes = 360 where poll_interval_minutes is null;
