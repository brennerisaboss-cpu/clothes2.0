# Phase 3 — handoff

Generic Shopify adapter, the shared poll runner, the robots.txt probe, and the
arbitrage-direction model.

## The probe (phase 0 (c) and (d))

`npm run probe-shops` — reads `config/shops.json`, writes
`docs/shop-probe-results.md` and `config/shop-probe-results.json`.

It obeys the rules rather than approximating them:

- **robots.txt is fetched and parsed first, every time.** A path robots
  disallows is never requested — the verdict comes from the rules alone.
- **Fails closed.** A robots.txt that returns 403, times out, or 5xxs is
  treated as "do not fetch", never as permission.
- One request per host at a time, ≥1s apart, honouring a stated `Crawl-delay`.
- Backs off on 429 and abandons that host for the run.
- Skips any shop whose `permission_status` is `declined`, permanently.
- Identifies itself honestly in User-Agent with contact details. Set
  `PROBE_CONTACT=you@example.com` so a shop owner can find and ask you to stop.

The robots parser (`src/lib/robots.mjs`) implements the parts of RFC 9309 that
matter: group selection by user-agent with most-specific-wins, Allow/Disallow
with longest-match-wins, `*` and `$` patterns, and Crawl-delay. 16 unit tests.

**I could not run it against real shops.** See "The egress problem" below.

## The adapter interface

`src/lib/adapters/contract.mjs` is the shape every later source must fit. Its
design encodes the correctness rules so an adapter cannot break them:

- **An adapter returns observations, never conclusions.** It cannot mark
  anything sold, delisted or gone. All status inference lives in one shared
  place, so a broken adapter cannot mass-mark a source.
- **An adapter must state `complete`** — did it enumerate the whole catalogue?
  `succeeded()` throws if you forget. A partial poll may never be used to
  conclude anything is gone.
- **An adapter never converts currency, normalises condition, or resolves a
  brand.** Those mappings live in one auditable place.

## The Shopify adapter

Takes a domain and currency from source config, so adding a shop is a config
line. Two refusals worth naming:

- **It will not guess currency.** `/products.json` carries none, and inferring
  it from a TLD would scale every JPY price by ~150x while looking plausible. A
  shop without a configured currency is skipped with an explicit error.
- **It will not fall back to HTML** when a feed is off. That shop is manual-tier
  now, not a scraping target.

`available: false` on Shopify is ambiguous — sold, withdrawn and out-of-stock
are indistinguishable — so it maps to `unknown`, never to a sale.

## The poll runner

`src/lib/pollRunner.mjs`. Verified against a real Postgres and a fixture feed,
13 integration tests. The guard holds in all of these — **nothing changed**:

| Failure | Result |
|---|---|
| HTTP 500 | not applied, listings flagged `last_poll_ok = false` |
| Empty feed after a non-zero baseline | not applied |
| Catalogue shrank by more than half | not applied, `suspect_shrink` recorded |
| Feed switched off (HTML instead of JSON) | not applied |
| 429 rate limit | not applied |
| robots.txt disallows the feed | poll refuses to start |
| Source not cleared for automation | never polled at all |

And when a poll *is* good and complete: a genuinely absent listing becomes
`delisted` with evidence `inferred_disappearance` — never `sold_confirmed`. A
price change writes a new snapshot and preserves the old one.

**A bug this caught:** relist links are keyed by *new* listing id, and I had
checked them against the *prior* id. A relisted listing would have been marked
delisted as well — manufacturing a phantom disappearance right beside the
relist we had just correctly identified. A test found it before it shipped.

## Arbitrage direction (your correction)

You said the profitable pipeline is **The RealReal / Japanese sites /
individual shops → Grailed / Vestiaire**. That contradicts the brief's framing,
which had the big platforms as pure valuation reference and small shops as the
only acquisition surface. Your version is the one modelled:

- `sources.role` — `acquisition` | `exit` | `both`. The RealReal is
  `acquisition`; Grailed and Vestiaire are `exit`. "Big vs small" was the wrong
  axis; the right one is the role a source plays for you.
- `routes` — directed acquisition→exit pairs, each with its own itemised cost
  stack: proxy fee, domestic JP shipping, international shipping, import VAT,
  customs duty, sale commission, payment fee, outbound shipping.

Four routes seeded: TRR→Grailed, TRR→Vestiaire, Japan→Grailed, Japan→Vestiaire.
Visible at `/sources`, with the total drag shown per route.

Phase 4 will score against a route rather than a bare price difference, because
direction is what makes a spread real: the same pair of prices is an
opportunity Tokyo→Grailed and a loss the other way.

## The egress problem — and how to fix it

**I still cannot run the probe from here.** This session's outbound HTTPS is
blocked by an organisation egress policy: the gateway answers `403` to every
CONNECT, including `example.com`. The proxy's own docs say to report that
rather than route around it, so I have not tried to.

To fix it, in order of ease:

1. **Run it locally.** Nothing about the probe needs this container:
   ```bash
   git pull && npm install
   PROBE_CONTACT=you@example.com npm run probe-shops
   ```
   It writes `docs/shop-probe-results.md`; commit that and I will build against
   real verdicts.
2. **Widen the session's egress allowlist** if you administer it — the hosts
   needed are just the shop domains in `config/shops.json`. Claude Code on the
   web configures this per environment; see the network-policy section of
   https://code.claude.com/docs/en/claude-code-on-the-web.
3. **Ask an org admin** if the policy is not yours to change.

Until then, `config/shops.json` holds candidates with platform *inferred from
URL shape*, which is not evidence.

## What is stubbed or faked

- No real shop has been polled. The adapter is proven against a fixture feed
  that mimics Shopify's response shape, not against a live storefront.
- FX rates remain placeholders.
- Route cost figures are **estimates I invented** from typical rates. The
  customs duty of 12% in particular is a placeholder — apparel duty varies by
  material and origin. Correct them before trusting any phase-4 number.
- No scoring, no alerting. Phases 4 and 6.

## Still open

- Rakuten's terms remain unread.
- EUR/Belgium, the Play exclusion, Comme Comme, the 14/30-day thresholds and
  the evidence weights are all still unconfirmed assumptions.
