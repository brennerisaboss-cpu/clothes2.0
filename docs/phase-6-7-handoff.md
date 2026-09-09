# Phases 6 & 7 — handoff

Alerting, the remaining adapters, and cultural heat. Plus the interface prose
strip.

## Alerting

`npm run alert`, intended to run straight after `npm run poll`.

- **Discord webhook** delivery. The embed carries item, price, spread, link,
  flags and data age. Colour encodes posture — red where a flag says verify,
  amber for provisional, green for clean — so a glance at a phone reads before
  the numbers do.
- **Dedup by (rule, listing snapshot)**, claimed in the database *before* the
  webhook fires. A crash mid-send leaves a record marked undelivered rather than
  losing the alert or double-sending it; undelivered rows are retried next run.
- A **re-price alerts again**, because it writes a new snapshot. An unchanged
  listing seen on every poll does not.
- **A rule with no thresholds is treated as misconfigured**, not as match-all. A
  firehose is not an alert.
- **Channel `none`** records without notifying — the way to tune a threshold
  before pointing it at a webhook. Both seeded rules ship on `none`.
- **Digest mode** batches into one message. Seeded but disabled.

### Latency

Measured and shown on `/alerts`, reported separately by basis:

- **from the source's publish time** — the honest figure, including however
  long we took to notice
- **from our own first sighting** — flattering, because it excludes poll
  interval

Adapters populate `listings.source_published_at` where the source states one
(Shopify does; Yahoo does not).

## Adapters added

**Rakuten Ichiba** and **eBay Browse**, both conforming to the phase-3 contract,
20 unit tests between them. Two things each refuses to do:

- Rakuten refuses a non-JPY configuration rather than coercing it, and reports a
  400 as "bad parameters *or* quota" rather than guessing which.
- eBay names the **Application Growth Check** explicitly on a 403 rather than
  retrying, and every eBay listing carries `soldDataAvailable: false` so nothing
  downstream mistakes an eBay comp for a sale.

The two caveats from phase 0 stand and are stated in the code: Rakuten frames
these APIs as being for affiliate use, and its affiliate terms prohibit links on
reselling-oriented sites — registering means accepting that, which is your call.

The three terms-prohibited platforms stay manual. That is a terms constraint
rather than a clearance one, and the schema still enforces it.

## Cultural heat

The idea you raised: some pieces carry value from social capital, and that shows
up in price late — which is the argument for watching it early.

**The design decision that matters: heat is a separate axis and never enters the
arbitrage score.** Profit is comps minus a fee stack, both measurable. Heat is
inference from attention. Letting it multiply a profit figure would quietly
corrupt the one number the whole system exists to keep honest.

Four components, each computed and displayed separately:

| Component | Weight | Signal |
|---|---|---|
| Exit price momentum | 0.40 | Is the exit median rising? Strongest, because it is the thing we ultimately care about |
| Time on market | 0.25 | Median days a listing survives before closing |
| Attention | 0.25 | Wikipedia pageview trend — earliest but noisiest |
| Supply | 0.10 | More listings than before. Lightest, because it is genuinely ambiguous: more sellers can mean more demand, or a trend peaking |

**Components with insufficient data are omitted and the weights renormalised —
they never score zero.** Zero would read as "cold", which is a claim we have not
earned. The page shows how many of the four actually contributed.

### The attention source

Wikipedia pageviews: an official Wikimedia REST API, openly documented, no key,
no auth. The cleanest legitimate proxy for cultural attention available without
scraping anything.

It **refuses to run without `PROBE_CONTACT`** — Wikimedia's policy requires a
contactable User-Agent, and sending an anonymous scraper-shaped request at a
volunteer-funded API is exactly what that policy asks you not to do.

What it is not: a measure of demand for a specific garment. A pageview is
curiosity, not intent, and a spike can be a news cycle or an obituary. One weak
leading indicator among several.

```bash
PROBE_CONTACT=you@example.com npm run heat   # refresh attention signals
```

## Interface prose

Stripped the standing explanatory paragraphs from every page. What stayed is
text that carries live state — counts, warnings, the specific reason a thing is
missing — which is information rather than exposition.

## What is stubbed or faked

- **No live call to Rakuten, eBay or Wikipedia has been made.** All three are
  proven against fixture responses shaped like the documented APIs.
- No Discord webhook has been posted to; delivery is tested against a fake.
- FX rates remain placeholders; proxy link templates remain unverified.
- Heat has almost no real data yet — 2 of 4 components on the best subject.
  It needs months of observations before it says anything.

## Still open

- The shop probe still needs a local run.
- The design is a partial reading of your references; a closer pass is next.
