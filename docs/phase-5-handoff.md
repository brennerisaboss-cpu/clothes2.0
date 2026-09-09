# Phase 5 — handoff (partial)

Yahoo! Shopping only. Rakuten and eBay are **not built**, deliberately — see
below.

## Yahoo! Shopping adapter

`src/lib/adapters/yahooShopping.mjs`, conforming to the phase-3 contract.
Item search v3: application ID only, no Yahoo account linkage, 30 req/min.

Verified through the real poll runner against a real database (8 integration
tests) as well as 13 unit tests:

- **Japanese titles match.** `コムデギャルソン オムプリュス`, `ジュンヤワタナベマン`
  and the rest resolve through the same alias table; an off-brand row is
  filtered out.
- **JPY converts with its rate recorded**, never reconverted later.
- **Every failure mode changes nothing**: 429, 500, empty result set after a
  real baseline, and a suspicious shrink all leave the catalogue untouched.
- The adapter **pushes its own documented rate limit to the limiter** rather
  than leaving the caller to guess.
- A source misconfigured as a non-JPY currency is **refused, not coerced**.

## Proxy-purchase eligibility

The February 2026 Yahoo change, now modelled end to end. An excluded item
**cannot be bought via Buyee or ZenMarket at all**, so a proxy link for one is a
dead end at the moment speed matters.

`listings.proxy_purchasable` is deliberately **three-state**:

| Value | Meaning | Behaviour |
|---|---|---|
| `true` | merchant permits proxy purchase | links shown |
| `false` | merchant excluded it | links **suppressed**, with the reason stated |
| `null` | the source did not say | links shown, with a warning — silence is not permission |

## Proxy links

Generated from the listing id so buying is one click rather than a manual
re-search on the proxy site.

**The URL templates are unverified.** I could not check them against the live
services (outbound HTTPS blocked by policy). They follow each service's
documented item-URL shape, but if a link 404s the fix is one line in
`PROXY_SERVICES` — not a code change.

## What I did NOT build, and why

The brief says not to add a marketplace adapter beyond what is explicitly
cleared. Phase 0 cleared Yahoo Shopping and did not clear these:

- **Rakuten** — its terms are still unread, and the affiliate partner terms it
  is tethered to prohibit affiliate links on sites promoting 転売 (reselling),
  which is the category this tool sits in. Building the adapter would mean
  registering for the ID and accepting those terms first. Unresolved is not
  cleared, so it stays unbuilt.
- **eBay** — production access to the Buy APIs appears to require a manual
  Application Growth Check. That is a real gate, not a code problem, and I
  cannot pass it for you.

Both are cheap to add once cleared: the contract is fixed, and the Yahoo
adapter is the template.

## What is stubbed or faked

- **No live Yahoo call has been made.** The adapter is proven against fixture
  responses shaped like the documented API, not the real endpoint.
- FX rates remain placeholders.
- Proxy link templates unverified, as above.

## To use it

```bash
# https://e.developer.yahoo.co.jp/register
YAHOO_APP_ID=... npm run poll
```

Add a source row with `tier = 'feed'`, `role = 'acquisition'` and config
`{ "adapter": "yahoo_shopping", "currency": "JPY", "query": "コムデギャルソン" }`.
