export type Draft = {
  titleRaw: string;
  brandRaw: string | null;
  sourceId: string;
  sourceItemId: string | null;
  url: string | null;
  price: number | null;
  currency: string | null;
  sizeRaw: string | null;
  conditionRaw: string | null;
  imageUrl: string | null;
  notes: string | null;
  brandId: string | null;
  sublineId: string | null;
  adYear: number | null;
  adYearStatus: string;
  needsManualResolution: boolean;
  monitored: boolean;
  warnings: string[];
};

export declare function parseMoney(text: string): {
  amount: number | null;
  currency: string | null;
  ambiguous: boolean;
};
/** One line's link and image, by index into the raw split of the same text. */
export type PastedLink = [number, string | null, string | null];

/** The venues you have configured, so a pasted row lands on the right one. */
export type KnownSource = { id: string; base_url: string | null };

export declare function parseBulk(
  text: string | null | undefined,
  links?: PastedLink[],
  sources?: KnownSource[],
): {
  drafts: Draft[];
  note: string;
};

/** Drafts from one saved-search alert email's HTML part. */
export declare function parseAlertEmail(
  html: string | null | undefined,
  sources?: KnownSource[],
): { drafts: Draft[]; note: string };
