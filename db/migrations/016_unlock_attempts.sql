-- Failed unlock attempts, counted somewhere they cannot be outrun.
--
-- The first attempt at throttling was a 400ms pause before checking the
-- password. That is per-request latency, not a rate limit: it delays a
-- sequential guesser and does nothing at all to ten parallel requests, which
-- is one line of shell. There was no counter, no lockout, and no way for one
-- request to know another had just failed.
--
-- Counting needs shared state, and on a deployment with more than one instance
-- process memory is not shared. So it lives here, one row per client, and the
-- check takes a row lock — which is also what defeats parallelism: attempts
-- against the same row queue behind each other instead of racing, so the
-- escalating delay applies to the tenth simultaneous guess as much as the
-- tenth sequential one.

create table if not exists unlock_attempts (
  client            text primary key,
  failures          integer not null default 0,
  first_failure_at  timestamptz,
  last_failure_at   timestamptz,
  locked_until      timestamptz,
  updated_at        timestamptz not null default now()
);

comment on table unlock_attempts is
  'Failed password attempts per client, for throttling. Rows are deleted on a successful unlock and are safe to delete by hand — doing so only resets the delay.';
