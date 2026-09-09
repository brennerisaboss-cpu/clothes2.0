export type Resolution = {
  brandId: string | null;
  sublineId: string | null;
  sublineName?: string | null;
  confident: boolean;
  ambiguous: boolean;
  monitored: boolean;
  reason: string;
  matchedAlias: string | null;
  adYear: number | null;
  adYearStatus: string;
  /** Which fact the year came from: the AD tag on the garment, or a season code. */
  adYearBasis: 'ad_tag' | 'season' | null;
  /** The season as written, when that is where the year came from. */
  seasonCode: string | null;
};
export declare function resolveBrand(text: string | null | undefined): Resolution;
