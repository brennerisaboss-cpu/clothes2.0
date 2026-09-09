export declare const MIN_OBSERVATIONS: number;
export declare const MIN_SIGNAL_POINTS: number;
export declare const DEFAULT_WINDOW_DAYS: number;
export declare const WEIGHTS: Record<string, number>;

export type Component = { sufficient: boolean; reason: string | null } & Record<string, unknown>;
export type HeatPart = { key: string; weight: number; value: number; detail: string; share: number };
export type Heat = {
  sufficient: boolean;
  reason: string | null;
  score: number | null;
  parts: HeatPart[];
  componentsUsed: number;
  coverage?: number;
};

export declare function priceMomentum(observations: unknown[], opts?: { now?: Date; windowDays?: number }): Component & { change: number | null; recentMedian: number | null; priorMedian: number | null; recentCount?: number; priorCount?: number };
export declare function turnoverVelocity(listings: unknown[], opts?: { now?: Date }): Component & { medianDaysListed: number | null; closed: number; active: number; clearRate?: number };
export declare function supplyTrend(listings: unknown[], opts?: { now?: Date; windowDays?: number }): Component & { change: number | null; recent: number; prior: number };
export declare function attentionTrend(signals: unknown[], opts?: { minPoints?: number }): Component & { change: number | null; points: number; early?: number; late?: number };
export declare function heatScore(input: Record<string, unknown>): Heat;
export declare function describeHeat(score: Heat | null | undefined): string;
