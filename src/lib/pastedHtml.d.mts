/** The lines a copied page's HTML flattens to, and the links each line carried. */
export function walkParsedHtml(
  root: unknown,
  options?: { base?: string | null },
): {
  lines: string[];
  links: Array<[number, string | null, string | null]>;
  anchors: number;
};

/** Parse one `text/html` clipboard flavour and walk it. Browser-only. */
export function walkPastedHtml(html: string | null | undefined): {
  lines: string[];
  links: Array<[number, string | null, string | null]>;
  anchors: number;
  /** Why nothing usable came back, when nothing did. Null on success. */
  why: string | null;
};

/** Whether the paste handler should replace the browser's own paste. */
export function shouldTakeOver(
  walked: { lines: string[]; links: Array<[number, string | null, string | null]> },
  nativeText: string,
  looksLikePage: (text: string, links?: unknown[]) => boolean,
): { takeOver: boolean; why: string | null };

/** An href worth keeping: absolute, not a fragment or a script. */
export function usableUrl(raw: string | null | undefined, base?: string | null): string | null;

/** The first real image inside an element, skipping lazy-loading placeholders. */
export function imageWithin(node: unknown, depth?: number, base?: string | null): string | null;
