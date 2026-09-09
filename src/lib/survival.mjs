// How long does a listing last before it is gone?
//
// The opportunities screen answers "what is worth buying". It does not answer
// "what is worth buying TODAY", and those differ: a piece with a €400 spread
// that has sat on a slow shop for five months will still be there next week,
// and one with a €150 spread on a venue where things move in days may not be
// there tomorrow. Ranking purely on margin quietly recommends the pieces that
// need the least urgency, because a piece nobody else wants is exactly the one
// with room left in its price.
//
// What makes this answerable rather than a guess: the listings table is a
// snapshot log. Every piece that was seen and later found gone has a duration,
// in days, and those durations are a distribution — per source, because a
// Japanese archive shop and eBay are not the same market.
//
// Two properties this has to get right, and both are about honesty rather than
// arithmetic:
//
//   CENSORING. A listing still active has not "lasted 12 days" — it has lasted
//   AT LEAST 12 days, and will last longer. Averaging observed durations while
//   ignoring the live ones is the classic error, and it biases every estimate
//   downward: the pieces that stay forever are precisely the ones never
//   counted. So this is Kaplan-Meier, which uses a censored observation for as
//   long as it was known to survive and then stops counting it.
//
//   CONDITIONING. "40% of listings are gone within a week" is not the question
//   when the listing in front of you has already been up for a month. The
//   question is the chance it goes in the next week GIVEN it reached a month,
//   and a piece that has already outlasted most of its cohort is usually one
//   that will keep doing so. So the curve is read from the listing's current
//   age, not from zero.
//
// And the discipline every estimator here follows: below a floor of actual
// departures it returns nothing at all rather than a number with a wide error
// bar, because a number on a screen is acted on and an error bar is not.

/** Below this many observed departures, the shape of the curve is noise. */
export const MIN_DEPARTURES = 8;

const DAY = 86_400_000;

/**
 * One listing's contribution to the curve.
 *
 * @typedef {object} Span
 * @property {number}  days      how long it was known to be on the market
 * @property {boolean} departed  true if it was seen leaving; false if it is
 *                               still up, which makes it censored
 */

/**
 * Turn snapshot rows into spans.
 *
 * The two ends, and why neither is `date_seen` alone:
 *
 *   START is `first_seen_at`, which is written once at insert and never
 *   updated. `date_seen` cannot serve, because pollRunner re-confirms an
 *   unchanged price with `update listings set date_seen = now()` — so on every
 *   automated row it means LAST-seen and drifts forward for as long as the
 *   piece stays on the market. Measuring from it made both ends of the span
 *   resolve to the same instant: every automated span came out at zero days,
 *   and with eight of those the curve declared itself sufficient and reported a
 *   confident figure about a market it had measured nothing of. Nothing in the
 *   maths was wrong; it was being fed a duration between an instant and itself.
 *
 *   END is the last confirmation, which is `date_seen` for an automated row
 *   (that is exactly what the bump records) and `last_verified_at` for a
 *   hand-entered one (whose `date_seen` never moves). Taking the later of the
 *   two is right for both without needing to ask which kind it is.
 *
 * A row with no `first_seen_at` contributes NOTHING. Those are rows that
 * predate the column, whose original sighting was overwritten in place and is
 * not recoverable. The tempting fallback — start from `date_seen` — yields a
 * floor, and a floor read as a duration says the piece sold quickly, which is
 * the direction of error that manufactures urgency. Refusing is the same choice
 * this module already makes below MIN_DEPARTURES.
 */
export function spansFrom(rows, now = new Date()) {
  const spans = [];
  for (const row of rows ?? []) {
    const start = row.first_seen_at ? new Date(row.first_seen_at).getTime() : NaN;
    if (!Number.isFinite(start)) continue;

    // 'relisted' is a listing that was superseded by a new snapshot of the same
    // piece — a re-price, not a departure. Counting it as one would make every
    // shop that adjusts prices look like a shop where things sell.
    const departed = row.status === 'delisted' || row.status === 'sold_confirmed';

    // The last moment this listing was known to be on the market. Never `now`:
    // counting the silence since a source stopped being polled as time on the
    // market would inflate every span on it, and that is the source least
    // entitled to influence the estimate.
    const confirmations = [row.date_seen, row.last_verified_at]
      .map((v) => (v ? new Date(v).getTime() : NaN))
      .filter(Number.isFinite);
    if (!confirmations.length) continue;
    const end = Math.max(...confirmations);

    spans.push({ days: Math.max(0, (end - start) / DAY), departed });
  }
  return spans;
}

/**
 * The Kaplan-Meier survival curve for a set of spans.
 *
 * Returns points of `{ days, surviving }` where `surviving` is the estimated
 * probability a listing is still up at that many days, plus the counts the
 * estimate rests on so a caller can refuse it.
 */
export function survivalCurve(spans) {
  const clean = (spans ?? []).filter((s) => Number.isFinite(s.days) && s.days >= 0);
  const departures = clean.filter((s) => s.departed).length;

  // Every distinct time at which something departed. Censored spans never
  // create a step — they only sit in the at-risk count until they drop out.
  const times = [...new Set(clean.filter((s) => s.departed).map((s) => s.days))].sort((a, b) => a - b);

  const points = [{ days: 0, surviving: 1 }];
  let surviving = 1;
  for (const t of times) {
    const atRisk = clean.filter((s) => s.days >= t).length;
    if (!atRisk) break;
    const died = clean.filter((s) => s.departed && s.days === t).length;
    surviving *= 1 - died / atRisk;
    points.push({ days: t, surviving });
  }

  return {
    points,
    departures,
    censored: clean.length - departures,
    total: clean.length,
    sufficient: departures >= MIN_DEPARTURES,
  };
}

/** The curve's value at a given age, stepping down at each departure time. */
function survivingAt(curve, days) {
  let value = 1;
  for (const p of curve.points) {
    if (p.days > days) break;
    value = p.surviving;
  }
  return value;
}

/**
 * The chance this listing is gone within `horizon` days, given it has already
 * been up for `ageDays`.
 *
 * Null when the curve rests on too few departures, or when the listing has
 * already outlived every departure recorded — beyond the last observed
 * failure a Kaplan-Meier curve says nothing, and flattening it to "0% chance"
 * would be the estimator's ignorance printed as a reassurance.
 */
export function chanceGoneWithin(curve, ageDays, horizon = 7) {
  if (!curve?.sufficient) return null;

  const lastObserved = curve.points[curve.points.length - 1]?.days ?? 0;
  if (ageDays > lastObserved) return null;

  const now = survivingAt(curve, ageDays);
  if (!(now > 0)) return null;

  const later = survivingAt(curve, ageDays + horizon);
  const chance = 1 - later / now;
  return Math.min(1, Math.max(0, chance));
}

/** Median days on the market, or null where the curve never reaches half. */
export function medianDays(curve) {
  if (!curve?.sufficient) return null;
  for (const p of curve.points) if (p.surviving <= 0.5) return p.days;
  return null;
}

/**
 * How urgently to look at this row.
 *
 * Deliberately NOT folded into the profit figure. A margin is money and a
 * survival chance is a probability; multiplying them produces an expected
 * value that reads like money, and someone would then sort on it and compare
 * it with a real euro amount. They are reported side by side and ranked
 * separately.
 *
 * Three bands rather than a number, because the underlying estimate is not
 * precise enough to order two listings 4 points apart, and a decimal would
 * imply that it is.
 */
export function urgency(chance) {
  if (chance == null) return { band: 'unknown', label: 'no survival data for this venue' };
  if (chance >= 0.5) return { band: 'now', label: `about ${Math.round(chance * 100)}% gone within a week` };
  if (chance >= 0.2) return { band: 'soon', label: `about ${Math.round(chance * 100)}% gone within a week` };
  return { band: 'patient', label: `about ${Math.round(chance * 100)}% gone within a week` };
}

/**
 * Days a listing has been on the market, as of now.
 *
 * From its FIRST sighting. `date_seen` is the last confirmation on an automated
 * row, so measuring from it reports a piece that has been up for months as
 * minutes old — and the curve is then asked the wrong question about it.
 */
export function ageInDays(firstSeenAt, now = new Date()) {
  if (firstSeenAt == null) return null;
  const start = new Date(firstSeenAt).getTime();
  if (!Number.isFinite(start)) return null;
  return Math.max(0, (now.getTime() - start) / DAY);
}
