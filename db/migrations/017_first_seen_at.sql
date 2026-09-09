-- When a listing was FIRST seen, as distinct from when it was last confirmed.
--
-- `date_seen` had been carrying both meanings and they diverged silently. For a
-- hand-entered listing it is set once at insert and never touched, so it does
-- mean first-seen. For anything from a poll, pollRunner re-confirms an unchanged
-- price with `update listings set date_seen = now()` — so it means LAST-seen,
-- and drifts forward for as long as the piece stays on the market.
--
-- Nothing was wrong until something measured a duration. The survival estimator
-- computes time-on-market as end minus start, and for an automated row both
-- ends resolved to the same drifting instant: every span came out at zero days.
-- With eight of those it declares itself sufficient and reports a confident
-- number about a market it has measured nothing of.
--
-- Deliberately NOT solved by setting last_verified_at on every poll: that field
-- means "a human or a check looked at this", and staleness sorting and the
-- freshness weighting in confidence.mjs already read it. Widening it would move
-- those too, quietly.
alter table listings add column first_seen_at timestamptz;

comment on column listings.first_seen_at is
  'When this listing was first observed. Set once, at insert, and never updated '
  '— unlike date_seen, which a poll bumps to now() on every re-confirmation. '
  'Null on rows that predate this column and cannot be trusted to say.';

-- Backfilled ONLY where the answer is knowable.
--
-- For a hand-entered row date_seen never moved, so it is the first sighting and
-- can be copied across. For an automated row it has already drifted an unknown
-- distance and there is no record of where it started — the re-confirmation
-- overwrote it in place, so there is no earlier snapshot to read. Those stay
-- null, and the survival estimator skips them, because a floor presented as a
-- duration reads as a short life on the market and that is the direction of
-- error that manufactures false urgency.
update listings set first_seen_at = date_seen where entered_manually;

-- The first snapshot in a re-price chain is a real first sighting, and that one
-- WAS preserved: a price change inserts a new row rather than updating, so the
-- superseded row still holds the date it was seen at that price. Walking to the
-- head of each chain recovers a genuine first_seen_at for automated rows that
-- have been re-priced at least once.
with recursive chain as (
  select id, supersedes_id, id as head from listings where supersedes_id is not null
  union all
  select c.id, l.supersedes_id, l.id as head
    from chain c join listings l on l.id = c.supersedes_id
)
update listings target
   set first_seen_at = origin.date_seen
  from (
    select c.id, min(l.date_seen) as date_seen
      from chain c join listings l on l.id = c.head
     group by c.id
  ) origin
 where target.id = origin.id
   and target.first_seen_at is null;

create index on listings (first_seen_at);
