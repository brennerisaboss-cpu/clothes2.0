// What currency does this Shopify shop price in?
//
// The product feed does not say. That is the single most consequential thing a
// shop can leave unstated: a ¥128,000 coat read as €128,000 is not a slightly
// wrong number, it is a 150x error that would sit at the top of every
// opportunity table looking like the find of the year.
//
// The adapter therefore refuses to guess and demands currency as config. That
// is right, but it also means adding a shop requires knowing its billing
// currency, which is a research errand per shop and the reason the candidate
// list sat unused with no currency against any entry.
//
// So: ask the shop. Every Shopify storefront states its own currency in two
// places, and both are read here before falling back to refusing.

const CODE = /^[A-Z]{3}$/;

/**
 * @returns {{ currency: string|null, via: string|null, error?: string }}
 */
export async function detectCurrency(base, { fetchImpl = fetch, userAgent } = {}) {
  const headers = { 'user-agent': userAgent ?? 'resale-tracker/0.1', accept: 'application/json, text/html' };

  // 1. /meta.json — a small public document many Shopify shops expose, whose
  //    whole purpose is naming the shop and its currency.
  try {
    const res = await fetchImpl(`${base}/meta.json`, { headers, signal: AbortSignal.timeout(15000) });
    if (res.ok) {
      const body = await res.json();
      const found = String(body?.currency ?? '').toUpperCase();
      if (CODE.test(found)) return { currency: found, via: 'meta.json' };
    }
  } catch { /* not every shop serves it */ }

  // 2. The storefront, but only the one signal that means what we need.
  //
  // This fallback caused a real 150x error and is now deliberately narrow.
  //
  // The first mistake was a regex matching any "currency":"XXX" in 200KB of
  // markup. A Shopify storefront is full of them — the currency selector lists
  // every market it serves, analytics blobs carry their own, and structured
  // data carries one per product. It matched whichever appeared first, which
  // is not the shop's currency but merely a currency.
  //
  // The second mistake was subtler and worse. /products.json returns prices in
  // the shop's BASE currency, while the storefront renders the visitor's
  // PRESENTMENT currency. A Japanese shop selling into Europe shows € to a
  // European browser while its feed stays in ¥ — so reading the storefront
  // answers a different question than the one the prices are denominated in,
  // and does so most confidently on exactly the international shops where it
  // is wrong.
  //
  // Shopify.currency.active is the closest thing the page has to an answer,
  // and it is still presentment. It is used only as a last resort, and it is
  // reported as such so the caller can weigh it — and so the magnitude check
  // in isPlausiblePrice can veto it.
  try {
    const res = await fetchImpl(base, { headers, signal: AbortSignal.timeout(15000) });
    if (res.ok) {
      const html = (await res.text()).slice(0, 200_000);
      const m = html.match(/Shopify\.currency\s*=\s*\{[^}]*?"active"\s*:\s*"([A-Z]{3})"/);
      if (m && CODE.test(m[1])) {
        return { currency: m[1], via: 'storefront (presentment — verify)', presentment: true };
      }
    }
  } catch { /* fall through to the honest answer */ }

  return { currency: null, via: null, error: 'the shop does not state its currency' };
}
