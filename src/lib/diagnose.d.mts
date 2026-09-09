export type Census = {
  listings: number;
  matched: number;
  acquisitionActive: number;
  exitObservations: number;
  routes: number;
  scored: number;
  salesBacked: number;
  asksOnly: number;
  profitable: number;
  routesConfirmed: number;
  unconvertible: number;
};

export type Blocker = {
  kind:
    | 'no_listings'
    | 'nothing_matched'
    | 'no_buy_side'
    | 'no_comps'
    | 'no_routes'
    | 'unconvertible'
    | 'comps_too_thin'
    | 'all_losses'
    | 'asks_only';
  what: string;
  fix: string;
  href?: string;
};

export function firstBlocker(census: Partial<Census>): Blocker | null;

export function showAsks(opts: {
  /** Tri-state: undefined is "no opinion", and shows them. */
  requested?: boolean | undefined;
}): boolean;
