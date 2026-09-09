# Phase 4 — handoff

Arbitrage scoring, on routes rather than bare price differences, with the full
proxy/shipping/VAT stack for the Japan→EU leg.

## What the direction correction forced

Phase 2 pooled every comp for an item regardless of where it came from. Under
the real pipeline that is wrong in a way that flatters bad buys, so scoring
required a change beyond just adding it:

**Resale value is now estimated from exit-venue comps only.** Comparing a
RealReal listing against other RealReal listings tells you what The RealReal
charges, not what the piece realises on Grailed. Pooling the two drags the
estimate toward the acquisition side and shrinks every real spread — or, where
the buying venue is dearer, invents spreads that do not exist.

Three things changed as a consequence:

1. **`resaleEstimate()` filters to `role in (exit, both)`** and refuses
   entirely when there are no exit comps in the piece's condition tier.
2. **The item page splits into two sections** — *Exit-market comps* (which drive
   the estimate) and *Acquisition-side prices* (reference only, deliberately
   excluded). The chart's median line is the exit median and now says so.
3. **The chart encodes role**: filled marks are the exit market, hollow marks
   are what you would pay. The vertical gap between them is the spread. Plotting
   both identically beneath an exit-only median line read as a contradiction.
4. **`scoringCandidates()` only considers acquisition-source listings.** A
   Grailed listing is not something you buy in this pipeline; scoring it would
   model buying at the exit venue and selling into it, a fee-stack loss by
   construction.

The dev fixture was also wrong and is fixed: its "acquisition" rows sat on
Grailed and Vestiaire, which are now exit venues.

## The cost stack

Modelled component by component rather than as a percentage, because the
sequence matters on the route where the margin is thinnest:

- Duty is charged on goods **plus freight to the border**.
- VAT is then charged on that total **including the duty**.
- The proxy service fee and domestic Japanese shipping are added to what you pay
  but **not** to the dutiable value — they are pre-export domestic services, not
  part of the transaction value. That is a modelling choice and a debatable one;
  it is stated in the code rather than buried.

Observed on the fixture: a ¥52,000 (€302) Japanese buy lands at **€481** — a 59%
uplift before a single fee on the selling side. That is the number the brief
wanted made visible.

## What it refuses to do

- **No score below 3 exit comps** in the matching condition tier. It shows the
  specific reason instead of a number.
- **No score without a base-currency price.** A bug caught here: `Number(null)`
  is `0`, not `NaN`, so a listing with no FX rate on file would have been scored
  as if it were free — a spectacular fake profit on exactly the row most likely
  to be acted on.
- **No comps borrowed across condition tiers**, ever.
- **Nothing is "actionable" while a high-severity flag stands.**

## Flags

| Flag | Severity | Meaning |
|---|---|---|
| `steep_discount` | high | More than 50% below the exit median. Disproportionately scams, listing errors, or misrepresented condition. |
| `stale_comps` | high | Freshest exit comp older than 120 days — the score describes a market that may not exist. |
| `stale_listing` | high | The acquisition price itself has not been re-verified recently. |
| `thin_comps` | medium | Exactly at the 3-comp minimum. |
| `no_confirmed_sales` | medium | Rests entirely on asking prices — what sellers hope for, not what buyers paid. |

Confidence is comp confidence discounted by the acquisition listing's own
freshness: both have to hold for the number to mean anything.

## Screens

- **`/opportunities`** — ranked candidates, sortable by profit, spread,
  confidence or discount, with the full chain visible on each row: *buy → landed
  → resale → net*. An explicit "show unscored" list so the gaps are visible
  rather than silent.
- **Item page** — the whole working, both cost tables itemised, plus the split
  comp view.

## What is stubbed or faked

- **Route cost figures are estimates I invented.** You said not to worry about
  exact customs and duties for now; the 12% duty and 21% VAT are placeholders
  and the UI labels them as such throughout. They are one row in `routes` to
  correct when you want to.
- FX rates remain placeholders.
- No confirmed sales exist anywhere yet, so every estimate currently rests on
  asking prices — and says so, on every score.
- No alerting. That is phase 6.

## Still open

- Rakuten's terms remain unread; the shop probe still needs running locally.
- EUR/Belgium, the Play exclusion, Comme Comme, the 14/30-day thresholds, the
  evidence weights, the 3-comp minimum, the 50% discount threshold and the
  120-day staleness limit are all still unconfirmed assumptions.
