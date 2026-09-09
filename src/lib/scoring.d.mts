export declare const STEEP_DISCOUNT_RATIO: number;
export declare const STALE_COMP_DAYS: number;

export type CostBreakdown = {
  total: number;
  breakdown: {
    item: number; proxyFee: number; domesticShip: number;
    intlShip: number; customsDuty: number; importVat: number;
  };
};
export type ProceedsBreakdown = {
  total: number;
  breakdown: { resale: number; saleFee: number; paymentFee: number; outboundShip: number };
};
export type ResaleEstimate = {
  sufficient: boolean;
  settled?: boolean;
  reason: string | null;
  value: number | null;
  comps: number;
  counts?: { confirmed_sale: number; active_ask: number; inferred_disappearance: number };
  confidence: number;
  factors?: { volume: number; quality: number; recency: number };
  newestAgeDays?: number | null;
  oldestAgeDays?: number | null;
  exitCompsTotal: number;
  /** Was the estimate drawn from the exit venue's own comps, or from all venues? */
  venueScoped?: boolean;
  /** Comps that are other models of the same kind of piece, not this one. */
  borrowedComps?: number;
  borrowedTotal?: number;
  exitSourceId?: string | null;
  assumedTier?: string | null;
  /** The estimate before any calibration correction, kept so it can be checked. */
  uncalibrated?: number | null;
  calibration?: {
    factor: number;
    applied: boolean;
    weight: number;
    observations: number;
    clamped: boolean;
    reason: string;
  };
};
export type ScoreFlag = { kind: string; severity: 'high' | 'medium'; message: string };

export type Score = {
  scored: boolean;
  /** True when the estimate falls short of MIN_COMPS. Must be surfaced. */
  provisional?: boolean;
  reason?: string;
  route?: Record<string, unknown> & { id: string; display_name?: string; exit_source?: string };
  price?: number;
  resale?: ResaleEstimate;
  cost?: CostBreakdown;
  proceeds?: ProceedsBreakdown;
  profit?: number;
  spreadPct?: number | null;
  confidence?: number;
  listingFreshness?: number;
  dataAgeDays?: number | null;
  flags: ScoreFlag[];
  actionable?: boolean;
  /** 'confirmed_sales' when a real sale backs the estimate; 'asks_only' otherwise. */
  /** What the margin rests on: a recorded sale, a piece that vanished at a price, or asks alone. */
  evidenceBasis?: 'confirmed_sales' | 'disappearances' | 'asks_only';
  /**
   * Chance this listing is gone within a week, given how long it has already
   * been up. Attached by the page from the venue's survival curve rather than
   * computed here — it is a property of the VENUE and the listing's age, not of
   * the arbitrage. Null where the venue has too few observed departures to say.
   */
  goneWithinWeek?: number | null;
  confirmedSales?: number;
  disappearances?: number;
};

export declare function landedCost(price: number | null, route: unknown): CostBreakdown | null;
export declare function netProceeds(resale: number | null, route: unknown): ProceedsBreakdown | null;
export declare function resaleEstimate(
  observations: unknown[], conditionTier: string | null, now?: Date,
): ResaleEstimate;
export declare function scoreOpportunity(input: {
  listing: unknown; observations: unknown[]; route: unknown; now?: Date;
}): Score;
export declare function scoreAllRoutes(input: {
  listing: unknown; observations: unknown[]; routes: unknown[]; now?: Date;
  calibration?: Map<string, { observations: number; ratio: number }> | null;
  brandId?: string | null;
}): { best: Score; all: Score[] };
