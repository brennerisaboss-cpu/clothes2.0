-- A guessed cost stack must not read as a measured one.
--
-- Every route ships with a plausible set of numbers: 21% import VAT, 12%
-- customs duty, a 5% proxy fee, €35 of international shipping. They were
-- written to exercise the arithmetic, and they are guesses — the duty rate
-- alone varies by material and origin, and none of them knows which proxy
-- service you use or what your seller-level fee is.
--
-- Guesses are fine. Guesses that look like facts are not: they land in the
-- same "PROFIT €412" figure as everything else, with nothing to distinguish
-- them, and the whole point of this tool is that its numbers can be checked.
--
-- So a route now records when a human last confirmed its costs. Null means
-- nobody has, which is where every seeded route starts.

alter table routes
  add column if not exists costs_confirmed_at timestamptz;

comment on column routes.costs_confirmed_at is
  'When a human last checked this route''s cost stack against reality. Null means the numbers are still the seeded guesses, and every margin computed through this route is flagged as such.';
