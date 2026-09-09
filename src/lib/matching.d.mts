import type { Resolution } from './resolve.mjs';
import type { Garment } from './garment.mjs';

/**
 * The text a brand is resolved from: the title, plus the vendor field when the
 * title does not already carry it.
 */
export declare function resolutionText(
  brandRaw: string | null | undefined,
  titleRaw: string | null | undefined,
): string;

/** What garment a listing is, read from the title first and the vendor second. */
export declare function garmentOf(
  brandRaw: string | null | undefined,
  titleRaw: string | null | undefined,
): Garment;

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
  adYearBasis?: 'ad_tag' | 'season' | null;
  type?: string | null;
  material?: string | null;
  /** The identity two listings must share to be the same piece. */
  key?: string;
  /** Generated from that identity — never a seller's title. */
  canonicalName?: string;
};
