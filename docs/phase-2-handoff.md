# Phase 2 — handoff

Item matching and the price-history model, running on manually entered data
alone. Plus the on-demand re-verify override you asked for.

## The re-verify override

The 14/30-day thresholds are now a *prompt*, not a gate.

- A **Re-verify** button on every manual listing card and on the listing detail
  page, available whether or not the entry is due.
- **Show all manual entries** on `/verify`, so you can pull anything into the
  queue early.
- Confirming resets the clock. A different price writes a new snapshot linked to
  the one it supersedes — the history is never overwritten.

One deliberate limit, stated in the UI rather than implied away: this **cannot
fetch anything**. The manual tier exists because those sources prohibit
automated collection, so "refresh" means you looked and told the app what you
saw. The button says so.

## Matching

Layer 1 only — the deterministic alias table, as the brief specified. It
resolves what it can prove and refuses everything else:

- Confident sub-line → find-or-create the canonical item and link.
- Ambiguous name ("CDG"), unrecognised brand, or an unmonitored sub-line (Play)
  → left unmatched and surfaced in `/unresolved`.
- **Re-run alias matching** backfills everything still unmatched.

`/unresolved` is the manual path, and it is built as the primary one: each
listing shows its photo with **Google Lens / Yandex / TinEye** links beside a
sub-line picker, an AD-year field, and a *link to an existing item* dropdown.
Reverse-image links are plain URLs you click — nothing is fetched or automated.

**I have not built the embedding/LLM fallback**, per the brief. Nothing so far
suggests it is needed: every unmatched listing in testing was unmatched for a
reason the alias table got *right* (genuinely ambiguous, or deliberately
excluded), not because it failed. I will tell you what changed before building
it.

## Price-history model

Per item, grouped by condition tier and never pooled across tiers:

- **Weighted median**, not a mean, so one mispriced outlier cannot drag the centre.
- **Evidence weighting**: confirmed sale 1.0, active ask 0.45, inferred
  disappearance 0.15. Multiplied by a recency factor.
- **Refuses to score below 3 comps** — shows "insufficient data — 1 comp, need 3"
  rather than a number.
- **Confidence broken into three inspectable factors** (volume, quality,
  recency) rather than one opaque score, so you can see *why* it is weak.
- **Data age surfaced** on every tier: "newest observation 3d old, oldest 40d".

Observed on the fixture: the `excellent` tier reports €354 from 4 comps at
confidence 0.382; the `good` tier reports insufficient data from 1 comp and does
**not** borrow from the excellent pool.

## The chart

Dot plot over time, coloured and shaped by evidence class, with a dashed median
rule. Palette is categorical slots 1–3, validated against this app's actual
chart surface with `--pairs all`: all six checks pass (worst CVD ΔE 9.4, worst
normal-vision ΔE 20.9). Evidence is encoded by **shape as well as colour**, so
identity never rests on colour alone.

One deliberate choice: **lines connect only snapshots of the same listing.** Two
separate listings are not a trend, and drawing a line between them would imply a
continuity that does not exist.

## What is stubbed or faked

- FX rates are still placeholders (`placeholder_seed`).
- `confirmed_sale` remains unreachable — nothing in the manual tier supplies one
  yet, so every comp is currently an active ask. The weighting path is built and
  tested; it has nothing to weight differently until a source confirms a sale.
- `inferred_disappearance` is likewise unused: the only way to mark something
  gone is you telling it, which is a delisting, not an inference.
- No adapters, no scoring, no alerting. Phases 3, 4, 6.
- `scripts/dev-fixture.mjs` creates sample data. Opt-in only.

## What turned out awkward

- **Two listings of the same garment do not auto-merge** if the titles differ
  ("wool jacket" vs "wool tailored jacket"). That is correct for a deterministic
  matcher, and it is exactly why *link to an existing item* exists — but it does
  mean the alias table alone will never consolidate comps across sources. Your
  eyes do that work, as the brief anticipated.
- **Marks clipped at the plot edge** on the first chart render; the time axis
  now insets by a marker width.
- The `.mjs` domain modules needed `.d.mts` declarations to be properly typed
  from the TypeScript side. Added for all of them.

## Still open

- The shop platform / robots.txt probe still cannot run here (egress blocked).
- Rakuten's terms remain unread.
- Assumptions from phase 1 still unconfirmed: EUR/Belgium, the Play exclusion,
  Comme Comme, and the 14/30-day thresholds.
