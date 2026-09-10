import { observationsForItems, listRoutes, calibrationRatios } from './queries';
import { scoreAllRoutes } from './scoring.mjs';
import type { Score } from './scoring.mjs';

export type ScoredRow = { best: Score; routeCount: number };

// The comparators live in sorting.mjs, free of any database import so they can
// be tested directly. Re-exported here so pages have one import.
export { compareByScore, discountRatio, isFlagged, SORT_LABELS, SCORE_SORTS } from './sorting.mjs';
export type { SortKey } from './sorting.mjs';

/**
 * Score a set of listings in one pass, shared by the grid and the
 * opportunities view so both sort on identical numbers.
 *
 * Only acquisition-side listings are scored. An exit-venue listing is the
 * yardstick, not something you buy, and giving it a "profit" would invite
 * sorting a comp above a real candidate.
 */
export async function scoreListings(
  listings: {
    id: string;
    item_id?: string | null;
    source_role?: string | null;
    source_id: string;
    brand_id?: string | null;
    price_base: number | null;
    condition_tier: string | null;
    /** Scoring weights comps by how far their size is from this one. */
    size_raw?: string | null;
    date_seen: Date;
    last_verified_at: Date | null;
    entered_manually: boolean;
  }[],
): Promise<Map<string, ScoredRow>> {
  const scoreable = listings.filter(
    (l) => l.item_id && (l.source_role === 'acquisition' || l.source_role === 'both'),
  );
  if (!scoreable.length) return new Map();

  const [observations, routes, calibration] = await Promise.all([
    observationsForItems([...new Set(scoreable.map((l) => l.item_id as string))]),
    listRoutes(),
    // Read once for the whole page rather than per row: it is a handful of
    // rows and every listing needs it.
    calibrationRatios().catch(() => new Map()),
  ]);

  const out = new Map<string, ScoredRow>();
  for (const listing of scoreable) {
    const { best, all } = scoreAllRoutes({
      listing,
      observations: observations.get(listing.item_id as string) ?? [],
      routes,
      // What pieces of this brand actually fetched on each venue, where enough
      // sales have been recorded to know. Below three it stays uncorrected.
      calibration,
      brandId: listing.brand_id ?? null,
    });
    out.set(listing.id, { best, routeCount: all.length });
  }
  return out;
}
