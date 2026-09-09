import type { Resolution } from './resolve.mjs';

export declare function itemKey(input: {
  sublineId: string | null;
  adYear: number | null;
  type: string | null;
  material: string | null;
}): string;

export declare function planMatch(listing: {
  brand_raw?: string | null;
  title_raw?: string | null;
}): {
  matchable: boolean;
  reason: string;
  resolved: Resolution;
  sublineId?: string;
  adYear?: number | null;
  adYearStatus?: string;
  type?: string | null;
  material?: string | null;
  /** The identity two listings must share to be the same piece. */
  key?: string;
  /** Generated from that identity — never a seller's title. */
  canonicalName?: string;
};
