# Phase 0 — Research pass (no code)

Status: **partially blocked.** See "Environment limitation" first — it changes how much
of this report you can trust.

---

## Environment limitation (read this before the verdicts)

This session's network egress policy blocks all outbound HTTPS except the search tool.
Direct page fetches fail at the proxy (`EGRESS_BLOCKED`) for every host tested, including
`example.com`. I could run web *searches* but could not open a single page.

Consequences for the four Phase 0 questions:

| Question | Answerable here? |
|---|---|
| (a) Rakuten terms | **Partly.** Could not read the terms document itself. |
| (b) Yahoo developer offering | **Mostly yes.** Changelog/API titles and summaries were legible via search. |
| (c) Independent shops + platform | **Candidates only.** Platform is *inferred from URL shape*, not probed. |
| (d) robots.txt stance per shop | **No.** Requires fetching `/robots.txt`. Zero data. |

I have not guessed at (c) or (d). Nothing below is presented as verified unless it says so.
The fix is a ~40-line probe script you run on your own machine (see "What I need from you").

---

## Source-by-source verdict

| Source | Verdict | Basis |
|---|---|---|
| The RealReal | **Manual-only** | Settled in brief; not re-litigated |
| Vestiaire Collective | **Manual-only** | Settled in brief; not re-litigated |
| Grailed | **Manual-only** | Settled in brief; not re-litigated |
| Yahoo! Shopping API (v3 item search) | **Usable — best-confirmed API source** | Live, actively maintained Feb 2026 |
| Rakuten Ichiba Item Search | **Needs asking / terms unread** | Affiliate-purpose framing unresolved |
| eBay Browse API | **Needs asking** | Production Buy API access likely gated |
| Yahoo! Auctions API | **Dead — remove from brief** | Terminated 2018-01-22 |
| Mercari JP / Rakuma | **Manual tier** | No public API (unchanged) |
| Independent Shopify shops | **Probably usable, unproven here** | Could not probe a single storefront |
| StockX | **Deprioritized** | Unchanged; revisit only on coverage evidence |

---

## (a) Rakuten

**Could not read the terms.** `webservice.rakuten.co.jp/guide/rule` exists (it surfaced in
search results) but is unreachable from here. I will not paraphrase a terms document I
have not read.

What search did establish:

- Rakuten Web Service is consistently described as provided **free for Rakuten Ichiba
  members to use for affiliate purposes** — the framing in your brief is accurate and
  still current. Whether that is a *restriction* or a *description of intent* is exactly
  the ambiguity that needs the actual document.
- One genuinely relevant find from the **Rakuten Affiliate** partner terms (a different
  document, but the one Web Service is tethered to): affiliate links are prohibited on
  sites containing content that promotes **せどり・転売** (reselling / flipping), and
  resale of goods purchased through one's own affiliate links is prohibited.

That last point deserves your attention. It does not obviously bite a private, single-user
tool that places no affiliate links and publishes nothing — but this project is a
resale-arbitrage tool, which is the exact category that clause names. If you ever register
for an affiliate ID to get the Web Service key, you are accepting those partner terms.

**Recommendation:** treat Rakuten as *unresolved*, not *cleared*. It is also the weakest
of the two Japanese APIs on the merits (see the C2C point below), so the cheapest path is
to build Yahoo Shopping first and decide on Rakuten later, with the terms actually read.

**The C2C exclusion, in practice for CDG:** your brief's read is right — Ichiba is B2C
storefronts only, no Rakuma/auction inventory. I could not confirm this from the docs
page directly. What it means concretely: you lose the individual-seller supply entirely,
and keep the Japanese brand-recycle boutiques that run Ichiba storefronts. For CDG that is
a real but shallow surface — the recycle chains (RAGTAG, Komehyo, Trefac, Vector) mostly
push their high-value archive stock through their **own** storefronts, where margins are
better, rather than through Ichiba. My expectation, to be tested rather than trusted: the
Ichiba CDG surface skews Play, wallets, and recent Shirt — the low-value end you were
already planning to exclude. That would make Rakuten a poor acquisition surface and a
mediocre comp surface, which is a further argument for deferring it.

---

## (b) Yahoo! JAPAN — what is actually offered today

**Auctions API: gone.** Terminated **2018-01-22**. There is a dedicated end-of-service
changelog entry for it. There is no current auctions search API for general developers.
Yahoo Auctions is manual tier, permanently. Remove the "check whether it still exists"
item from the brief — it is answered.

**Shopping API: alive, open, and the strongest confirmed automated source in this project.**

- **商品検索API v3** (item search v3) is current and open to general developers.
- **No Yahoo ID linkage required** — application ID only, which is a materially lower bar
  than eBay or Rakuten.
- Rate limit: **30 requests/minute per application ID**, with a documented path to request
  a higher ceiling via the help form.
- Actively maintained: there are changelog entries dated **February 2026**, so this is not
  a zombie API.

**One finding worth designing around now, not later.** The February 2026 update added a
per-item **"overseas purchase-agency exclusion" flag** (代理購入 exclusion), letting
merchants exclude individual products from overseas proxy-buying services. Terminology
changed too: value `1` = *not excluded* (proxy-purchasable), `0` = *excluded*.

This lands directly on your proxy cost model. An item flagged excluded **cannot be bought
via Buyee/ZenMarket at all** — so generating a proxy link for it is worse than useless, it
sends you to a dead end at the moment speed matters. Capture this flag at ingest, store it
on the listing, and suppress proxy links (and arguably suppress the alert) when set. This
was not in your brief and it is the kind of thing that silently produces phantom
opportunities.

Separately: sandbox support for Store Search / Store Category was dropped 2026-02-27
(now returns 404). Irrelevant to us — those are merchant-side APIs — but it tells you
Yahoo is actively pruning, so pin your assumptions to a dated check.

---

## eBay

Correction to the brief's assumption that eBay is a cheap add-on. Search indicates
production access to the **Buy APIs is gated behind an "Application Growth Check"** — a
manual eBay review, required before a production keyset can call restricted Buy APIs.

I could **not** confirm whether Browse `search` specifically falls inside the restricted
set or is available on a standard production keyset; sources conflate "Buy APIs" and
"Browse API". This needs the developer portal read directly.

Either way, eBay is not a five-minute adapter. Given it was already your lowest-priority
API source, I would not spend the review cycle on it until phases 3–4 are real.

---

## (c) Independent shops carrying CDG — **candidates, unverified**

I could not fetch a single one of these. Platform column is inferred **only** from URL
shape (`/collections/` and `*.myshopify.com` are strong Shopify tells). Treat this as a
list to probe, not a list of findings.

### European / Western archive stockists

| Shop | URL | Platform (inferred) | Signal |
|---|---|---|---|
| Archive Store | `archivestore-official-ec.myshopify.com` | **Shopify — near-certain** | `myshopify.com` domain; has a CDG Homme Plus archive collection |
| DRIEW Garments | `driewgarments.com` | Shopify — likely | `/collections/comme-des-garcons`; carries Homme, Plus, Tricot, Junya, Tao |
| dot COMME | `dotcomme.net` | Unknown | Archival CDG/Junya/Miyake/Yohji specialist; Paris |
| L'OBSCUR | `lobscur.com` | Unknown | Curated avant-garde secondhand |
| Gaijin Paris | `gaijinparis.com` | Unknown | Vintage Japanese designers, CDG included |
| Elegantly Papered | `elegantlypapered.com` | Shopify — likely | `/collections/comme-des-garcons` |

### Japanese brand-recycle boutiques

| Shop | URL | Platform (inferred) | Note |
|---|---|---|---|
| Brand Vintage Life | `life-shop.jp` | Shopify — likely | `/collections/comme-des-garcons` — **best Japanese Shopify candidate** |
| RAGTAG | `ragtag.jp` | Custom — likely | Large chain, dedicated CDG brand pages, deep stock |
| KOMEHYO | `komehyo.jp` | Custom — likely | Largest JP reuse chain; has EN locale; publishes condition grades |
| JAM Trading | `jamtrading.jp` | Custom — likely | Vintage-leaning |
| Vector Park | `vector-park.jp` | Custom — likely | ~350k items |
| Trefac | `trefac.jp` | Custom — likely | Multi-store chain |

**Reading of this list, offered as judgment not fact:** the big Japanese recycle chains are
the *valuable* targets — deep CDG stock, published condition grades, gut-priced — and also
the *least likely* to be on Shopify. If that holds after probing, your Tier-2 "small
independent shops" plan splits in two: a handful of Western Shopify archive stores you can
poll generically, and a set of high-value Japanese chains that are custom-platform and
therefore land in the manual tier or the "just ask them" tier. The email route matters more
than the brief assumes, and KOMEHYO/RAGTAG (professional operations with English support
and existing overseas customers) are the realistic yeses.

**Shopify `/products.json` in 2026:** still the default-public endpoint on Shopify
storefronts, but **merchants can and do disable it**, and Shopify has acknowledged internal
discomfort with all products being publicly listable. So design the adapter to treat a
404/403 on `products.json` as "this shop is not a feed shop" and fall through to the manual
tier — not as an error to retry, and never as a reason to reach for HTML scraping.

---

## (d) robots.txt stance per shop

**No data.** Every fetch blocked. This is the cleanest gap in the report and I am not going
to fill it with inference — a robots.txt verdict is precisely the kind of thing that is
worthless unless actually read.

---

## Corrections to the brief

Things that turned out wrong, missing, or worth changing — flagged now rather than
absorbed silently.

1. **Yahoo Auctions is settled, not open.** Dead since 2018. Drop the investigation item.
2. **Yahoo Shopping should outrank Rakuten in build order.** Your brief lists Rakuten
   first. Yahoo has a lower access bar (no ID linkage), no affiliate-purpose ambiguity
   surfaced so far, confirmed active maintenance, and a documented rate limit. Rakuten has
   an unread terms document and a reselling-adjacent clause in the affiliate terms it is
   tethered to. Recommend swapping the order in phase 5.
3. **eBay is not cheap.** Production Buy API access appears to require a manual eBay review.
4. **New required field: proxy-purchase eligibility.** Per the Feb 2026 Yahoo change.
   Suppress proxy links when an item is flagged excluded.
5. **AD year is identity, not annotation.** The AD tag was introduced ~1988 — pre-1988
   pieces have none, so absence is meaningful (early archive, missing tag, or fake) and
   must be distinguishable from "not yet parsed". More importantly: two listings of the
   same model from different AD years are **different items** with different values, so AD
   year belongs in the item's identity key, not in `season_year (nullable)` as an
   afterthought. Suggest `ad_year` on `items`, participating in matching, with an explicit
   `ad_year_unknown` state.
6. **Sub-line list is incomplete.** Missing from your skeleton, and each is its own market:
   - **Comme des Garçons Noir** (distinct from BLACK Comme des Garçons — routinely conflated)
   - **Homme Plus Sport**, **Homme Plus Evergreen**
   - **Shirt Girl** (you have Shirt Boy)
   - **Comme des Garçons Comme des Garçons** ("Comme Comme", tagged CDG CDG) — please
     confirm; if real for your purposes it is a matching nightmare, since the string
     contains the mainline name twice and collides with the ambiguous `CDG` diffusion line
   - Junya sub-variants (MAN PINK, MAN EYE) if you care about them
7. **Tao and Ganryu are discontinued lines** (Tao ~2011 with a later return; Ganryu ended).
   Supply is archive-only and thin, so they will chronically sit under your 3-comp minimum
   and show "insufficient data". That is the system working correctly — but you should
   expect it rather than read it as a bug.
8. **Play: I agree with excluding it** from monitoring, for the reasons you gave. Confirm
   and I will hard-exclude it in the alias table rather than merely deprioritizing.

---

## What I need from you before Phase 1

1. **Unblock the probe, or run it yourself.** I can write a standalone script that, for a
   list of shop domains, fetches `/robots.txt`, fingerprints the platform (Shopify /
   WooCommerce / Squarespace / other), and checks whether `/products.json` returns a
   usable payload — one request per host per second, backing off on 429. That closes (c)
   and (d) properly. Say go and I will write it; it is throwaway research tooling, not
   Phase 1 app code.
2. **Confirm the Play exclusion.**
3. **Confirm or correct the sub-line additions in item 6**, especially Comme Comme.
4. **Decide Rakuten**: defer it (my recommendation) or read the terms yourself and tell me
   the answer.
5. **Your base currency and shipping origin** — brief implies EUR/Belgium; confirm for the
   cost model in phase 4.

---

## Decision log

**2026-09-04 — build order changed, approved.** Phase 5 now runs Yahoo Shopping
first, then Rakuten, then eBay, rather than the brief's Rakuten-first ordering.
Rationale in "Corrections to the brief" above: Yahoo has the lower access bar
(application ID only, no Yahoo ID linkage), confirmed active maintenance, a
documented rate limit, and no unresolved affiliate-purpose ambiguity. Rakuten
stays unresolved pending a reading of its actual terms.

All non-negotiable constraints, the manual-tier-first ordering, and the
correctness rules are unchanged by this.
