export declare const MIN_COMPS: number;
export declare const EVIDENCE_WEIGHT: Record<string, number>;

export type EvidenceCounts = {
  confirmed_sale: number;
  active_ask: number;
  inferred_disappearance: number;
};

export type TierSummary = {
  tier: string | null;
  count: number;
  counts: EvidenceCounts;
  sufficient: boolean;
  median: number | null;
  /** An estimate that exists but falls short of MIN_COMPS. Must always be
   *  rendered with an explicit warning — never as a plain figure. */
  provisionalMedian: number | null;
  provisionalConfidence: number;
  reason: string | null;
  confidence: number;
  factors: { volume: number; quality: number; recency: number };
  newestAgeDays: number | null;
  oldestAgeDays: number | null;
  lowestActive: number | null;
};

export type ItemSummary = {
  tiers: TierSummary[];
  untiered: TierSummary | null;
  totals: {
    observations: number;
    counts: EvidenceCounts;
    evidenceSummary: string;
  };
};

export declare function weightedMedian(
  entries: { value: number; weight: number }[],
): number | null;
export declare function observationWeight(obs: unknown, now?: Date): number;
export declare function summariseItem(observations: unknown[], now?: Date): ItemSummary;
export declare function describeEvidence(counts: EvidenceCounts): string;
