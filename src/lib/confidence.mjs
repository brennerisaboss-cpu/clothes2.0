// Freshness and confidence for manually entered listings.
//
// A manual entry does not refresh itself. The brief's rule: an entry that has
// not been re-verified should lose confidence weight over time rather than
// sitting there looking as authoritative as a fresh API result.

export const VERIFY_AFTER_DAYS = 14;   // enters the re-check queue
export const STALE_AFTER_DAYS = 30;    // no longer counted as a current price
export const FLOOR_WEIGHT = 0.1;       // never quite zero; still evidence of a kind

export function daysSince(date, now = new Date()) {
  if (!date) return Infinity;
  const then = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(then.getTime())) return Infinity;
  return (now.getTime() - then.getTime()) / 86_400_000;
}

/**
 * Weight in [FLOOR_WEIGHT, 1]. Full weight until the re-check window opens,
 * then decays linearly to the floor at the stale threshold.
 */
export function freshnessWeight(lastVerifiedAt, now = new Date()) {
  const age = daysSince(lastVerifiedAt, now);
  if (!Number.isFinite(age)) return FLOOR_WEIGHT;
  if (age <= VERIFY_AFTER_DAYS) return 1;
  if (age >= STALE_AFTER_DAYS) return FLOOR_WEIGHT;

  const span = STALE_AFTER_DAYS - VERIFY_AFTER_DAYS;
  const progress = (age - VERIFY_AFTER_DAYS) / span;
  return Number((1 - progress * (1 - FLOOR_WEIGHT)).toFixed(4));
}

/** @returns {'fresh'|'due'|'stale'} */
export function freshnessState(lastVerifiedAt, now = new Date()) {
  const age = daysSince(lastVerifiedAt, now);
  if (age <= VERIFY_AFTER_DAYS) return 'fresh';
  if (age < STALE_AFTER_DAYS) return 'due';
  return 'stale';
}

export function describeFreshness(lastVerifiedAt, now = new Date()) {
  const age = daysSince(lastVerifiedAt, now);
  const state = freshnessState(lastVerifiedAt, now);
  return {
    state,
    ageDays: Number.isFinite(age) ? Math.floor(age) : null,
    weight: freshnessWeight(lastVerifiedAt, now),
    label: !Number.isFinite(age)
      ? 'never verified'
      : age < 1
        ? 'verified today'
        : `verified ${Math.floor(age)}d ago`,
  };
}
