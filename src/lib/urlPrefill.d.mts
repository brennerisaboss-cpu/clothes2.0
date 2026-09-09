/** A configured venue, matched by the host of its base_url. */
export type KnownSource = { id: string; base_url: string | null };

/** Which configured source a host belongs to, if any. */
export declare function sourceForHost(
  hostname: string | null | undefined,
  sources?: KnownSource[],
): string | null;

export declare function prefillFromUrl(
  input: string | null | undefined,
  sources?: KnownSource[],
): {
  ok: boolean;
  sourceId: string | null;
  url: string | null;
  fields: Record<string, string>;
  unresolved: string[];
  note: string;
};
