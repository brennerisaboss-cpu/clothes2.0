import type { Score } from './scoring.mjs';

export type SortKey =
  | 'profit' | 'discount' | 'confidence' | 'spread' | 'flagged' | 'urgent'
  | 'newest' | 'oldest' | 'price_asc' | 'price_desc' | 'stalest';

export type SortableRow = {
  id: string;
  date_seen: Date | string;
  last_verified_at?: Date | string | null;
  price_base?: number | null;
};

export declare const SORT_LABELS: Record<SortKey, string>;
export declare const SCORE_SORTS: Set<string>;
export declare function discountRatio(score: Score | undefined): number | null;
export declare function isFlagged(score: Score | undefined): boolean;
export declare function compareByScore(
  sort: SortKey,
  scores: Map<string, { best: Score }>,
): (a: SortableRow, b: SortableRow) => number;
