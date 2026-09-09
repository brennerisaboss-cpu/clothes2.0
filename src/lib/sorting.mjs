// Sort comparators.
//
// Framework-free and database-free on purpose: the grid and the opportunities
// list both use these, so "highest profit" cannot come to mean two different
// things on two screens. Pure functions are also the only way to test the
// ordering rules directly.

/** How far below the exit estimate a listing sits, 0–1. Null when unscored. */
export function discountRatio(score) {
  if (!score?.scored || !score.resale?.value || score.price == null) return null;
  return 1 - score.price / score.resale.value;
}

/** Anything carrying a high-severity flag needs a human look before acting. */
export function isFlagged(score) {
  return Boolean(score?.flags?.some((f) => f.severity === 'high'));
}

export const SORT_LABELS = {
  profit: 'Highest profit',
  discount: 'Largest discount',
  confidence: 'Highest confidence',
  spread: 'Largest spread',
  flagged: 'Flagged for review',
  newest: 'Newest',
  oldest: 'Oldest',
  price_asc: 'Price: low to high',
  price_desc: 'Price: high to low',
  stalest: 'Least recently verified',
  urgent: 'Going fastest',
};

export const SCORE_SORTS = new Set(['profit', 'spread', 'confidence', 'discount', 'flagged', 'urgent']);

/**
 * Build a comparator for one sort key.
 *
 * Two rules that are easy to get wrong and matter:
 *   * Unscored rows sink on score-based sorts rather than sorting as zero.
 *     Ranking "no data" above a genuine loss would put the least informative
 *     rows at the top of the list you act from.
 *   * Missing prices sink on BOTH price directions, for the same reason.
 */
export function compareByScore(sort, scores) {
  const score = (row) => scores.get(row.id)?.best;
  const time = (d) => (d ? new Date(d).getTime() : 0);

  return (a, b) => {
    if (SCORE_SORTS.has(sort)) {
      const sa = score(a);
      const sb = score(b);
      const ok = (s) => Boolean(s?.scored);
      if (ok(sa) !== ok(sb)) return ok(sa) ? -1 : 1;
      if (!ok(sa)) return time(b.date_seen) - time(a.date_seen);

      if (sort === 'flagged') {
        const fa = isFlagged(sa) ? 1 : 0;
        const fb = isFlagged(sb) ? 1 : 0;
        if (fa !== fb) return fb - fa;
        return (sb.profit ?? 0) - (sa.profit ?? 0);
      }
      if (sort === 'discount') {
        return (discountRatio(sb) ?? -Infinity) - (discountRatio(sa) ?? -Infinity);
      }
      // Going fastest. A listing with no survival estimate for its venue sinks
      // rather than sorting as zero risk — "we do not know" is not "it will
      // wait", and putting the unknowns at the bottom of an urgency list is the
      // only reading that cannot rush you at the wrong row.
      if (sort === 'urgent') {
        const ua = sa.goneWithinWeek;
        const ub = sb.goneWithinWeek;
        if ((ua == null) !== (ub == null)) return ua == null ? 1 : -1;
        if (ua == null) return (sb.profit ?? 0) - (sa.profit ?? 0);
        // Two rows equally likely to vanish are ordered by what is lost if one
        // does, which is the only tiebreak that changes a decision.
        if (ub !== ua) return ub - ua;
        return (sb.profit ?? 0) - (sa.profit ?? 0);
      }
      if (sort === 'confidence') return (sb.confidence ?? 0) - (sa.confidence ?? 0);
      if (sort === 'spread') return (sb.spreadPct ?? -Infinity) - (sa.spreadPct ?? -Infinity);
      return (sb.profit ?? -Infinity) - (sa.profit ?? -Infinity);
    }

    switch (sort) {
      case 'oldest':
        return time(a.date_seen) - time(b.date_seen);
      case 'price_asc':
        return (a.price_base ?? Infinity) - (b.price_base ?? Infinity);
      case 'price_desc':
        // Missing prices must sink here too, so the nulls do not lead the list.
        return (b.price_base ?? -Infinity) - (a.price_base ?? -Infinity);
      case 'stalest':
        return time(a.last_verified_at) - time(b.last_verified_at);
      case 'newest':
      default:
        return time(b.date_seen) - time(a.date_seen);
    }
  };
}
