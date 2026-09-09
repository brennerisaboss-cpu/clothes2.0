export declare const VERIFY_AFTER_DAYS: number;
export declare const STALE_AFTER_DAYS: number;
export declare const FLOOR_WEIGHT: number;

export declare function daysSince(date: Date | string | null, now?: Date): number;
export declare function freshnessWeight(
  lastVerifiedAt: Date | string | null,
  now?: Date,
): number;
export declare function freshnessState(
  lastVerifiedAt: Date | string | null,
  now?: Date,
): 'fresh' | 'due' | 'stale';
export declare function describeFreshness(
  lastVerifiedAt: Date | string | null,
  now?: Date,
): { state: 'fresh' | 'due' | 'stale'; ageDays: number | null; weight: number; label: string };
