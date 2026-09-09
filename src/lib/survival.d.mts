export const MIN_DEPARTURES: number;

export type Span = { days: number; departed: boolean };

export type Curve = {
  points: { days: number; surviving: number }[];
  departures: number;
  censored: number;
  total: number;
  sufficient: boolean;
};

export function spansFrom(
  rows: {
    /** Written once at insert. A row without one contributes no span. */
    first_seen_at?: Date | string | null;
    date_seen: Date | string;
    last_verified_at?: Date | string | null;
    status: string;
  }[],
  now?: Date,
): Span[];

export function survivalCurve(spans: Span[]): Curve;

export function chanceGoneWithin(curve: Curve | null, ageDays: number, horizon?: number): number | null;

export function medianDays(curve: Curve | null): number | null;

export function urgency(chance: number | null): {
  band: 'now' | 'soon' | 'patient' | 'unknown';
  label: string;
};

export function ageInDays(firstSeenAt: Date | string | null | undefined, now?: Date): number | null;
