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
};
export declare function resolveBrand(text: string | null | undefined): Resolution;
