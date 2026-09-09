import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  spansFrom, survivalCurve, chanceGoneWithin, medianDays, urgency, ageInDays, MIN_DEPARTURES,
} from '../src/lib/survival.mjs';

const span = (days, departed) => ({ days, departed });

// A venue where things move: most listings gone inside a fortnight.
const FAST = [
  ...Array.from({ length: 10 }, (_, i) => span(2 + i * 0.5, true)),
  ...Array.from({ length: 3 }, () => span(20, false)),
];

test('the curve only steps down where something actually left', () => {
  const curve = survivalCurve([span(5, true), span(10, false), span(12, true)]);
  // Two departures, one censored — and the censored span creates no step.
  assert.deepEqual(curve.points.map((p) => p.days), [0, 5, 12]);
  assert.equal(curve.departures, 2);
  assert.equal(curve.censored, 1);
});

test('a listing still up is counted as lasting AT LEAST that long, never exactly', () => {
  // The classic error, and it biases every estimate downward: the pieces that
  // sit forever are precisely the ones a naive average never counts, because
  // they have no end date yet.
  const withLongSurvivors = survivalCurve([
    ...Array.from({ length: 8 }, () => span(3, true)),
    ...Array.from({ length: 40 }, () => span(300, false)),
  ]);
  const withoutThem = survivalCurve(Array.from({ length: 8 }, () => span(3, true)));

  // Ignoring the 40 live listings says everything is gone by day 3.
  assert.equal(withoutThem.points.at(-1).surviving, 0);
  // Counting them says most things survive it, which is what is true.
  assert.ok(withLongSurvivors.points.at(-1).surviving > 0.8, 'censored spans stay at risk');
});

test('below a floor of real departures it returns nothing rather than a shape', () => {
  const thin = survivalCurve(Array.from({ length: MIN_DEPARTURES - 1 }, (_, i) => span(i + 1, true)));
  assert.equal(thin.sufficient, false);
  assert.equal(chanceGoneWithin(thin, 3, 7), null);
  assert.equal(medianDays(thin), null);
  // And the caller is told it is ignorance, not safety.
  assert.equal(urgency(null).band, 'unknown');
});

test('the question is asked from the listing\'s current age, not from zero', () => {
  const curve = survivalCurve(FAST);
  assert.equal(curve.sufficient, true);

  const fresh = chanceGoneWithin(curve, 0, 7);
  const aged = chanceGoneWithin(curve, 5, 7);
  // A piece that has already outlasted most of its cohort is likelier to keep
  // doing so. Reading the curve from zero would report the same risk for both
  // and rush you at the wrong listing.
  assert.ok(fresh > aged, `fresh ${fresh} should exceed aged ${aged}`);
});

test('past the last observed departure it says nothing, not "safe"', () => {
  // Beyond its last failure a Kaplan-Meier curve carries no information.
  // Reporting 0% there would print the estimator's ignorance as a reassurance,
  // on exactly the listings that have been sitting longest.
  const curve = survivalCurve(FAST);
  const last = curve.points.at(-1).days;
  assert.equal(chanceGoneWithin(curve, last + 1, 7), null);
});

test('a re-price is not a departure', () => {
  // 'relisted' means a new snapshot superseded this row — the piece is still
  // for sale at a different price. Counting it as one would make every shop
  // that adjusts prices look like a shop where things sell.
  const rows = ['relisted', 'delisted', 'sold_confirmed', 'active', 'unknown'].map((status) => ({
    first_seen_at: '2026-01-01', date_seen: '2026-01-08', last_verified_at: '2026-01-08', status,
  }));
  const spans = spansFrom(rows);
  assert.deepEqual(spans.map((s) => s.departed), [false, true, true, false, false]);
  assert.ok(spans.every((s) => Math.abs(s.days - 7) < 0.01));
});

// --- the input assumption, which was wrong for every automated source -------
//
// `date_seen` carried two meanings that diverged silently. On a hand-entered
// row it is set once and never touched, so it is the first sighting. On
// anything from a poll, pollRunner re-confirms an unchanged price with
// `update listings set date_seen = now()` — so it is the LAST sighting and
// drifts forward for as long as the piece stays up.
//
// Measuring a duration from it made both ends of an automated span resolve to
// the same instant. Nothing in the maths was wrong; it was being handed the
// interval between an instant and itself.

test('an automated row is measured from its first sighting, not its last', () => {
  // What the poll actually leaves behind: date_seen bumped to the most recent
  // confirmation, last_verified_at never set (nothing in the poll path sets
  // it), first_seen_at frozen at insert.
  const [span] = spansFrom([{
    first_seen_at: '2026-01-01T00:00:00Z',
    date_seen: '2026-03-02T00:00:00Z',   // sixty days of re-confirmations
    last_verified_at: null,
    status: 'delisted',
  }]);
  assert.equal(Math.round(span.days), 60);
  assert.equal(span.departed, true);
});

test('the collapse this fixes: reading the start from date_seen gives zero days', () => {
  // The regression in one assertion. Twelve automated rows, all re-confirmed
  // moments ago, eight of them departed. Started from date_seen every span is
  // zero, the curve passes MIN_DEPARTURES, and it reports a confident figure
  // about a market it has measured nothing of.
  const now = Date.now();
  const asItWasRead = Array.from({ length: 12 }, (_, i) => ({
    days: 0, departed: i % 3 !== 0,
  }));
  const collapsed = survivalCurve(asItWasRead);
  assert.equal(collapsed.sufficient, true, 'eight departures is enough to publish');
  assert.equal(collapsed.points.at(-1).days, 0, 'and every one of them at day zero');

  // Read from first_seen_at the same rows carry their real durations.
  const real = spansFrom(Array.from({ length: 12 }, (_, i) => ({
    first_seen_at: new Date(now - (i + 1) * 5 * 86_400_000),
    date_seen: new Date(now - i * 60_000),
    last_verified_at: null,
    status: i % 3 === 0 ? 'active' : 'delisted',
  })));
  assert.ok(real.every((s) => s.days > 1), 'no span collapses to a point');
  assert.ok(medianDays(survivalCurve(real)) > 1);
});

test('a row that cannot say when it was first seen contributes nothing', () => {
  // Rows predating the column: the original sighting was overwritten in place
  // by a re-confirmation and is not recoverable. The tempting fallback —
  // start from date_seen — yields a floor, and a floor read as a duration says
  // the piece sold quickly, which is the direction of error that manufactures
  // urgency. Refusing is the same choice this module makes below MIN_DEPARTURES.
  assert.deepEqual(
    spansFrom([{ first_seen_at: null, date_seen: '2026-01-08', last_verified_at: null, status: 'delisted' }]),
    [],
  );
  assert.deepEqual(
    spansFrom([{ date_seen: '2026-01-08', status: 'delisted' }]),
    [],
    'and an absent column is the same as a null one',
  );
});

test('the span ends at the last confirmation, whichever column carries it', () => {
  // date_seen for an automated row — the bump IS the confirmation. And
  // last_verified_at for a hand-entered one, whose date_seen never moves.
  // Taking the later of the two is right for both without asking which it is.
  const [automated] = spansFrom([{
    first_seen_at: '2026-01-01', date_seen: '2026-01-11', last_verified_at: null, status: 'active',
  }]);
  assert.equal(Math.round(automated.days), 10);

  const [manual] = spansFrom([{
    first_seen_at: '2026-01-01', date_seen: '2026-01-01', last_verified_at: '2026-01-11', status: 'active',
  }]);
  assert.equal(Math.round(manual.days), 10);
});

test('age is measured from the first sighting too', () => {
  // Otherwise an automated listing that has been up for months reads as
  // minutes old, and the curve is asked the wrong question about it.
  const now = new Date('2026-03-02T00:00:00Z');
  assert.equal(Math.round(ageInDays('2026-01-01T00:00:00Z', now)), 60);
  assert.equal(ageInDays(null, now), null, 'and an undatable row has no age, not age zero');
  assert.equal(ageInDays(undefined, now), null);
});

test('urgency is three bands, and never a false precision', () => {
  assert.equal(urgency(0.8).band, 'now');
  assert.equal(urgency(0.5).band, 'now');
  assert.equal(urgency(0.3).band, 'soon');
  assert.equal(urgency(0.2).band, 'soon');
  assert.equal(urgency(0.05).band, 'patient');
});

test('the median is a real crossing or nothing', () => {
  assert.equal(medianDays(survivalCurve(FAST)) > 0, true);
  // A venue where most things simply stay up has no median to report, and
  // extrapolating one would be inventing the number outright.
  const slow = survivalCurve([
    ...Array.from({ length: MIN_DEPARTURES }, (_, i) => span(i + 1, true)),
    ...Array.from({ length: 200 }, () => span(400, false)),
  ]);
  assert.equal(slow.sufficient, true);
  assert.equal(medianDays(slow), null);
});

test('an unparseable date contributes nothing rather than a zero-day span', () => {
  assert.deepEqual(
    spansFrom([{ first_seen_at: 'not a date', date_seen: 'not a date', status: 'delisted' }]),
    [],
  );
  assert.equal(ageInDays('not a date'), null);
});
