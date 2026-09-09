import type { Score } from './scoring.mjs';

export declare function evaluateRule(
  score: Score | { scored: boolean; flags: unknown[] },
  rule: Record<string, unknown>,
  listing?: Record<string, unknown>,
): { fires: boolean; reason: string; matched: string[] };

export declare function latencyFor(
  listing: { date_seen?: Date | string | null; source_published_at?: Date | string | null },
  sentAt?: Date,
): {
  observedToSent: number | null;
  publishedToSent: number | null;
  best: number | null;
  basis: string;
};

export declare function formatLatency(seconds: number | null | undefined): string;
