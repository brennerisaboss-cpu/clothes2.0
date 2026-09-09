export type MatchableListing = {
  title_raw: string;
  brand_id?: string | null;
  subline_id?: string | null;
};

export type MatchableItem = {
  id?: string;
  identity_key: string;
  canonical_name: string;
  brand_id: string;
  subline_id: string | null;
  ad_year: number | null;
  listings?: number;
};

export type Match = {
  score: number;
  /** 'strong' | 'likely' | 'possible' | 'no' */
  tier: string;
  agreements: string[];
  assumptions: string[];
  conflict: string | null;
};

/** How well one listing matches one item, and why. */
export function scoreMatch(listing: MatchableListing, item: MatchableItem): Match;

/** The items worth proposing for one listing, best first. */
export function suggestMatches(
  listing: MatchableListing,
  items: MatchableItem[],
  options?: { limit?: number },
): (Match & { item: MatchableItem })[];

/** May this be applied without asking? Only when nothing was assumed. */
export function safeToApply(match: Match): boolean;

/** The words in a title that might identify a garment. */
export function meaningfulTokens(title: string): Set<string>;

export type ListingFacts = {
  brandId: string | null;
  sublineId: string | null;
  adYear: string | null;
  type: string | null;
  material: string | null;
  model: string | null;
  tokens: Set<string>;
};

/** What a listing states about itself. Null means the seller never said. */
export function factsOf(listing: MatchableListing): ListingFacts;

/** Could these two listings be the same garment? */
export function compareListings(
  a: MatchableListing,
  b: MatchableListing,
): { compatible: boolean; conflict: string | null; agreements?: string[]; words?: number };

/** Group unresolved listings by what they appear to be. Links nothing. */
export function clusterListings<T extends MatchableListing>(
  listings: T[],
  options?: { minSize?: number },
): {
  members: T[];
  shared: {
    brandId: string | null;
    sublineId: string | null;
    adYear: string | null;
    type: string | null;
    material: string | null;
    model: string | null;
  };
  assumptions: string[];
  agreements: string[];
}[];

export declare function admissibleLinks(
  pairs: { listingId: string; itemId: string }[],
  listingsById: Map<string, unknown>,
  items: unknown[],
): { allowed: { listingId: string; itemId: string }[]; refused: string[] };
