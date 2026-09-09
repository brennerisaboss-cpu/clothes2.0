# Phase 1 — handoff

## What works end to end

Verified against a real Postgres 16 and a real browser, not asserted.

- **Schema.** 001_init.sql applies cleanly. Seven correctness rules were tested
  by trying to violate each one; all seven were rejected by the database.
- **Manual entry form.** Paste a URL → source, listing id and title prefill;
  sub-line and AD year resolve live as you type; ⌘↵ saves and returns focus to
  the URL field for the next entry. Currency persists between entries.
- **URL prefill.** Grailed, Vestiaire and The RealReal URL shapes. Tracking
  query strings are stripped so one listing has one URL.
- **Bulk paste.** Alert-email blocks and tab/semicolon-delimited rows parse into
  an editable draft table. Nothing is written until confirmed.
- **Re-check queue.** Manual entries surface after 14 days and decay to a
  confidence floor at 30. Confirming resets the clock; entering a different
  price writes a *new* snapshot linked to the one it supersedes.
- **Grid.** Photo-forward, filterable by sub-line, source, condition, size
  region, price range and freshness; sortable. Shows head-of-chain only.
- **Detail view.** Full snapshot history with the FX rate that applied to each.

Observed live: ¥48,000 → €278.40 at 0.0058 and £450 → €526.50 at 1.17, each
storing its own rate; AD2002 and AD1998 parsed from titles into item identity;
"CDG cargo trousers" correctly left unresolved.

## What is stubbed or faked

- **FX rates are placeholders**, seeded with `source = 'placeholder_seed'` and
  visible as such. No live feed. Replace before any scoring rests on them.
- **No image re-hosting** (by design) — image URLs render directly, so a source
  that hotlink-blocks will show a broken image.
- **No adapters at all.** No Shopify, no APIs. That is phases 3 and 5.
- **No scoring, no matching beyond the alias table, no alerting.** Phases 2, 4, 6.
- **`sold_confirmed` and `confirmed_sale` are unreachable in phase 1** — nothing
  yet supplies a confirmed sale. The path exists so phase 4 can use it.

## What I assumed

State these back if any are wrong; each is cheap to change now.

1. **Base currency EUR, shipping to Belgium.** Implied by the brief, never
   confirmed. Set via `BASE_CURRENCY`.
2. **Play is excluded from monitoring**, implemented as `monitored = false` on
   the sub-line rather than a hard exclusion — Play listings still resolve and
   are filtered, so they cannot silently pool into mainline comps. One field
   flip re-enables it.
3. **Re-check thresholds of 14 and 30 days**, floor weight 0.1. Invented; tune.
4. **Condition mapping rounds DOWN** where a source grade straddles two tiers.
   Overstating condition manufactures fake arbitrage, so the bias is deliberate.
5. **Comme des Garçons Comme des Garçons is included but flagged ambiguous**,
   pending your confirmation that you want it tracked at all.

## What turned out wrong or awkward

- **Short aliases are dangerous as substrings.** "HP" matched inside unrelated
  words, so aliases of three characters or fewer now require a word boundary.
- **"Homme+" was being truncated to "Homme"**, silently downgrading Homme Plus
  to Homme — a real instance of the sub-line pooling error the brief warns
  about, caught by a test rather than in production.
- **Japanese cannot share Latin's normalisation path.** NFKD decomposes dakuten,
  folding ジュンヤ to シュンヤ. Script detection happens before normalisation.
- **The snapshot log needs a head-of-chain filter for display.** Without it, a
  re-priced listing appeared twice in the grid. The log stays complete; only the
  grid collapses it.
- **`season_year (nullable)` in the brief's data model is not adequate for AD
  year.** AD year is identity-forming, so it participates in item lookup and
  carries a status distinguishing "pre-1988", "absent from tag" and "unknown".

## Still open from phase 0

Unchanged and still blocking phase 3:

- The shop platform / robots.txt probe could not run — this session's egress
  policy blocks all outbound HTTPS except search. Say the word and I will write
  the probe script for you to run locally.
- Rakuten's terms remain unread.
