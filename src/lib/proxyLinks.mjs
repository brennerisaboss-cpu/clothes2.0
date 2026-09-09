// Proxy-buying links for Japanese sources.
//
// The friction this removes is small but real: without it, finding a piece on
// Yahoo and then buying it means re-searching for it by hand on the proxy site,
// which is exactly where a fast listing gets lost.
//
// !! THE URL TEMPLATES BELOW ARE UNVERIFIED. !!
// They could not be checked against the live services from the environment this
// was written in (outbound HTTPS blocked by policy). They follow the documented
// shape of each service's item URL, but if a link 404s, the fix is one line in
// PROXY_SERVICES — not a code change. Verify before relying on them.

export const PROXY_SERVICES = [
  {
    id: 'zenmarket',
    label: 'ZenMarket',
    // Yahoo Shopping items use a different entry point from auctions.
    shopping: (code) => `https://zenmarket.jp/en/yahooshopping.aspx?itemCode=${encodeURIComponent(code)}`,
    auction: (code) => `https://zenmarket.jp/en/auction.aspx?itemCode=${encodeURIComponent(code)}`,
  },
  {
    id: 'buyee',
    label: 'Buyee',
    shopping: (code) => `https://buyee.jp/item/yahoo/shopping/${encodeURIComponent(code)}`,
    auction: (code) => `https://buyee.jp/item/yahoo/auction/${encodeURIComponent(code)}`,
  },
];

/** Sources that a proxy service can actually buy from. */
const PROXYABLE = new Set(['yahoo_shopping', 'yahoo_auctions', 'mercari_jp', 'rakuma']);

/**
 * Build proxy links for a listing.
 *
 * Returns `{ links: [], suppressed, reason }`. Links are suppressed — not just
 * omitted — when the source states the item is excluded from proxy purchase,
 * and the reason is surfaced so the absence reads as information rather than a
 * missing feature.
 */
export function proxyLinksFor(listing) {
  const sourceId = listing?.source_id ?? listing?.sourceId;
  const code = listing?.source_item_id ?? listing?.sourceItemId;

  if (!PROXYABLE.has(sourceId)) {
    return { links: [], suppressed: false, reason: null };
  }
  if (!code) {
    return { links: [], suppressed: false, reason: 'no source item id to build a link from' };
  }

  // An explicit false is the merchant saying no. Honour it.
  if (listing.proxy_purchasable === false) {
    return {
      links: [],
      suppressed: true,
      reason:
        'The merchant has excluded this item from overseas purchase-agency services, so no proxy can buy it. A link here would be a dead end.',
    };
  }

  const kind = sourceId === 'yahoo_auctions' ? 'auction' : 'shopping';
  const links = PROXY_SERVICES.map((service) => ({
    id: service.id,
    label: service.label,
    href: service[kind](code),
  }));

  return {
    links,
    suppressed: false,
    // Null eligibility is not permission. Say so rather than implying it works.
    reason:
      listing.proxy_purchasable == null
        ? 'This source did not state proxy eligibility — confirm on the proxy site before committing.'
        : null,
  };
}
