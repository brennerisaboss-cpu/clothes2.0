// Applying a measured correction to an estimate.
//
// The estimate is a median of comps from venues that can be polled. The venue
// actually sold on may not be among them, and no proxy tracks it exactly. The
// gap is not random — it is a consistent, brand-specific ratio — so it can be
// measured against sales that really happened and corrected for.
//
// The whole difficulty is knowing when NOT to apply it. A ratio from two sales
// is an anecdote, and letting an anecdote move every number is worse than
// leaving the estimate uncorrected: it produces a figure that looks
// better-informed while being driven by one lucky sale.
//
// So the correction is scaled by how much evidence stands behind it, and it
// never fully replaces the raw estimate until there is a real body of sales.

/** Below this many observations, a ratio is an anecdote and is ignored. */
export const MIN_OBSERVATIONS = 3;

/** At this many, the measured ratio is trusted in full. */
export const FULL_CONFIDENCE_OBSERVATIONS = 12;

/**
 * A ratio far from 1 is more likely a mistake — a mis-parsed price, a sale
 * recorded in the wrong currency, a comp set for the wrong item — than a real
 * market fact. Applying a 6x correction to every future estimate on that basis
 * would be catastrophic, so the correction is clamped and the clamping is
 * reported rather than hidden.
 */
export const MIN_RATIO = 0.4;
export const MAX_RATIO = 2.5;

/**
 * @param {object|null} row  A `calibration` view row: { ratio, observations }.
 * @returns {{ factor: number, applied: boolean, weight: number, reason: string,
 *             observations: number, clamped: boolean }}
 */
export function calibrationFactor(row) {
  const observations = Number(row?.observations ?? 0);
  const raw = Number(row?.ratio);

  if (!row || !Number.isFinite(raw) || raw <= 0) {
    return { factor: 1, applied: false, weight: 0, observations, clamped: false,
             reason: 'no sales recorded for this brand on this venue yet' };
  }

  if (observations < MIN_OBSERVATIONS) {
    return { factor: 1, applied: false, weight: 0, observations, clamped: false,
             reason: `only ${observations} recorded sale${observations === 1 ? '' : 's'} — not enough to correct from` };
  }

  const clamped = raw < MIN_RATIO || raw > MAX_RATIO;
  const ratio = Math.min(MAX_RATIO, Math.max(MIN_RATIO, raw));

  // Ramp in with evidence rather than switching on at the threshold: three
  // sales should nudge the estimate, not redefine it.
  const span = FULL_CONFIDENCE_OBSERVATIONS - MIN_OBSERVATIONS;
  const weight = Math.min(1, (observations - MIN_OBSERVATIONS) / span);

  // Interpolate between "no correction" and the measured ratio.
  const factor = 1 + (ratio - 1) * weight;

  return {
    factor,
    applied: true,
    weight,
    observations,
    clamped,
    reason: clamped
      ? `measured ${raw.toFixed(2)}x across ${observations} sales, clamped to ${ratio.toFixed(2)}x — check for a mis-recorded sale`
      : `${ratio.toFixed(2)}x measured across ${observations} sales, applied at ${Math.round(weight * 100)}% weight`,
  };
}

/**
 * Correct an estimate, returning both numbers.
 *
 * The uncorrected figure is kept so the screen can show what was adjusted and
 * by how much. A correction you cannot see is one you cannot check.
 */
export function calibrate(estimate, row) {
  const c = calibrationFactor(row);
  if (estimate == null || !Number.isFinite(Number(estimate))) {
    return { value: null, raw: null, ...c };
  }
  const raw = Number(estimate);
  return { value: Math.round(raw * c.factor * 100) / 100, raw, ...c };
}
