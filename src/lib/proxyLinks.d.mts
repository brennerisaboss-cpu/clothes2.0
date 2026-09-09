export type ProxyLink = { id: string; label: string; href: string };
export declare const PROXY_SERVICES: {
  id: string; label: string;
  shopping: (code: string) => string;
  auction: (code: string) => string;
}[];
export declare function proxyLinksFor(listing: {
  source_id?: string; sourceId?: string;
  source_item_id?: string | null; sourceItemId?: string | null;
  proxy_purchasable?: boolean | null;
}): { links: ProxyLink[]; suppressed: boolean; reason: string | null };
