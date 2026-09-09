/** A node shaped the way walkParsedHtml reads one. */
export type HtmlNode = {
  nodeType: number;
  nodeName: string;
  childNodes: HtmlNode[];
  textContent: string;
  getAttribute?: (name: string) => string | null;
};

/** Parse a document or fragment into a walkable tree. */
export function parseHtml(html: string | null | undefined): HtmlNode;

/** Undo HTML escaping, decoding `&amp;` last. */
export function decodeEntities(text: string): string;
