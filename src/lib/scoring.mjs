// Arbitrage scoring (phase 4).
//
// Scores a specific purchase on a specific route, never a bare price
// difference. Direction is what makes a spread real: the same pair of prices is
// an opportunity Tokyo→Grailed and a loss the other way, and the fee stack
// differs on each leg.
//
// The correction that reshaped this module: **resale value is estimated from
// EXIT-source comps only.** Phase 2 pooled every comp for an item regardless of
// where it came from. Under the real pipeline
//
//     The RealReal / Japanese sites / individual shops  →  Grailed / Vestiaire
//
// that is wrong in a way that flatters bad buys: comparing a RealReal listing
// against other RealReal listings tells you what RealReal charges, not what the
// piece realises on Grailed. Pooling the two drags the estimate toward the
// acquisition side and makes every spread look smaller than it is — or, when
// the acquisition venue is dearer, invents spreads that do not exist.
//
// Every cost figure here comes from the `routes` table and is an ESTIMATE.
// Nothing is hardcoded, and the UI labels them as estimates throughout.

import { summariseItem, MIN_COMPS } from './priceHistory.mjs';
import { freshnessWeight } from './confidence.mjs';
import { calibrate } from './calibration.mjs';

// A listing far below its own resale median is disproportionately a scam, a
// listing error, or a misrepresented condition. Score it, but never present it
// as actionable without a human look.
export const STEEP_DISCOUNT_RATIO = 0.5;
// Beyond this, the comps behind a score are old enough that the score is about
// a market that may no longer exist.
export const STALE_COMP_DAYS = 120;

const num = (v) => (v == null ? 0 : Number(v));

/**
 * What it actually costs to get the piece into your hands, in base currency.
 *
 * The EU sequence is deliberate rather than a flat percentage: duty is charged
 * on the goods plus transport to the border, and VAT is then charged on that
 * total *including* the duty. Applying both to the bare item price would
 * understate the landed cost on exactly the Japan→EU route where the margin is
 * thinnest.
 *
 * The proxy service fee and domestic Japanese shipping are added to what you
 * pay but NOT to the dutiable value: they are pre-export domestic services, not
 * part of the transaction value of the goods. That is a modelling choice, and a
 * debatable one — customs practice varies — so it is stated rather than buried.
 */
export function landedCost(price, route) {
  const p = price == null ? NaN : Number(price);
  if (!Number.isFinite(p) || p < 0) return null;

  const proxyFee = p * num(route.proxy_fee_pct) + num(route.proxy_fee_flat);
  const domesticShip = num(route.domestic_ship_flat);
  const intlShip = num(route.intl_ship_flat);

  const dutiableValue = p + intlShip;
  const duty = dutiableValue * num(route.customs_duty_pct);
  const vat = (dutiableValue + duty) * num(route.import_vat_pct);

  const total = p + proxyFee + domesticShip + intlShip + duty + vat;

  return {
    total: round(total),
    breakdown: {
      item: round(p),
      proxyFee: round(proxyFee),
      domesticShip: round(domesticShip),
      intlShip: round(intlShip),
      customsDuty: round(duty),
      importVat: round(vat),
    },
  };
}

/** What actually reaches you after the exit venue takes its cut. */
export function netProceeds(resale, route) {
  const r = resale == null ? NaN : Number(resale);
  if (!Number.isFinite(r) || r < 0) return null;

  const saleFee = r * num(route.sale_fee_pct);
  const paymentFee = r * num(route.payment_fee_pct);
  const outboundShip = num(route.outbound_ship_flat);
  const total = r - saleFee - paymentFee - outboundShip;

  return {
    total: round(total),
    breakdown: {
      resale: round(r),
      saleFee: round(-saleFee),
      paymentFee: round(-paymentFee),
      outboundShip: round(-outboundShip),
    },
  };
}

function round(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Estimate resale value from exit-source comps in one condition tier.
 *
 * Comps from acquisition sources are excluded entirely rather than
 * down-weighted: they answer a different question. A tier with fewer than
 * MIN_COMPS exit observations returns no estimate at all.
 */
export function resaleEstimate(observations, conditionTier, now = new Date(), exitSourceId = null) {
  // Retail is excluded outright, before role is even considered.
  //
  // A boutique's full price for a current-season piece is not a comp for a
  // fifteen-year-old archive jacket — it is a ceiling nobody pays on the resale
  // market. Mixed into the pool it drags every estimate upward, inventing
  // margin that does not exist, which is the direction of error that costs
  // money rather than opportunities.
  const resaleMarket = observations.filter((o) => o.marketplace_kind !== 'retail');

  const sellable = resaleMarket.filter(
    (o) => o.source_role === 'exit' || o.source_role === 'both',
  );

  // Comps from the venue actually being sold on, where there are enough.
  //
  // A route names the venue the piece exits through and charges that venue's
  // fees, so estimating its resale from a pool of every venue answers a
  // different question than the one asked — and venues genuinely differ, which
  // is the whole reason this platform exists.
  //
  // Where that venue lacks a comp set the wider pool is used rather than
  // refusing: an approximate answer labelled as one beats no answer. Which
  // happened is reported, so a figure drawn from other venues never reads as
  // though the exit venue produced it.
  // Comps borrowed from a coarser pool — other models of the same kind of
  // piece, when this one's model is unknown. Usable, but not the same claim as
  // a like-for-like comp, and it must never read as one.
  const borrowedCount = sellable.filter((o) => o.borrowed).length;

  let venueScoped = false;
  let exitComps = sellable;
  if (exitSourceId) {
    const own = sellable.filter((o) => o.source_id === exitSourceId);
    if (own.length >= MIN_COMPS) {
      exitComps = own;
      venueScoped = true;
    }
  }

  const summary = summariseItem(exitComps, now);
  let assumedTier = null;
  let tier =
    summary.tiers.find((t) => t.tier === conditionTier) ??
    // An untiered comp pool is usable only when the listing is also untiered;
    // otherwise a mint comp could price a damaged piece.
    (conditionTier == null ? summary.untiered : null);

  // A listing whose condition nobody stated, priced against tiered comps.
  //
  // This is the normal case for an automated feed: a shop's product JSON says
  // what a piece is and what it costs, almost never what condition it is in.
  // Refusing to value those at all would mean the entire automated half of the
  // platform produced listings that could never be compared — which is most of
  // the point of having it.
  //
  // So it is valued against the CHEAPEST tier available, never the dearest.
  // The error is then bounded in the safe direction: an unknown piece that
  // turns out to be mint was undervalued, which costs an opportunity, while
  // one valued at mint that turns out to be thrashed costs actual money. The
  // assumption is reported so the UI can show it, and confidence is cut,
  // because this is a weaker claim than a like-for-like comparison.
  if (!tier && conditionTier == null) {
    const usable = summary.tiers.filter((t) => (t.median ?? t.provisionalMedian) != null);
    if (usable.length) {
      tier = usable.reduce((lo, t) =>
        (t.median ?? t.provisionalMedian) < (lo.median ?? lo.provisionalMedian) ? t : lo,
      );
      assumedTier = tier.tier;
    }
  }

  if (!tier) {
    return {
      sufficient: false,
      reason: `no exit-market comps in condition tier "${conditionTier ?? 'unknown'}"`,
      value: null,
      comps: 0,
      confidence: 0,
      exitCompsTotal: exitComps.length,
    };
  }

  // Halved, not merely nudged: this is a guess about condition standing in for
  // an observation of it, and the number should not read as though it were the
  // same kind of claim as a like-for-like comp.
  const confidence = tier.sufficient ? tier.confidence : tier.provisionalConfidence;

  return {
    sufficient: tier.sufficient,
    reason: assumedTier
      ? `condition unstated — valued against the cheapest tier ("${assumedTier}")`
      : tier.reason,
    assumedTier,
    venueScoped,
    // How many of the comps behind this figure are other models rather than
    // this one. All of them, and the number is about a category, not a piece.
    borrowedComps: exitComps.filter((o) => o.borrowed).length,
    borrowedTotal: borrowedCount,
    exitSourceId,
    // `value` is the number scoring uses. Below the minimum it falls back to
    // the provisional median, and the score is stamped `provisional` so the UI
    // can never render it as a settled figure.
    value: tier.median ?? tier.provisionalMedian,
    settled: tier.median != null,
    comps: tier.count,
    counts: tier.counts,
    confidence: assumedTier ? confidence / 2 : confidence,
    factors: tier.factors,
    newestAgeDays: tier.newestAgeDays,
    oldestAgeDays: tier.oldestAgeDays,
    exitCompsTotal: exitComps.length,
  };
}

/**
 * Score one candidate purchase against one route.
 *
 * Refuses rather than guesses. Below MIN_COMPS exit comps it returns
 * `scored: false` with a reason, because a confident-looking number derived
 * from one comp is worse than no number — it gets acted on.
 */
export function scoreOpportunity({
  listing, observations, route, now = new Date(), calibration = null, brandId = null,
}) {
  const flags = [];

  // Number(null) is 0, not NaN. Without the null check a listing with no FX
  // rate on file would be scored as if it were free, producing a spectacular
  // fake profit on the one row most likely to be acted on.
  const price = listing.price_base == null ? NaN : Number(listing.price_base);

  if (!Number.isFinite(price)) {
    return { scored: false, reason: 'listing has no base-currency price (no FX rate on file)', flags };
  }
  if (!route) {
    return { scored: false, reason: 'no route configured from this source to an exit venue', flags };
  }

  const estimate = resaleEstimate(observations, listing.condition_tier, now, route.exit_source);

  // Correct by what pieces of this brand actually fetched on this venue, where
  // enough sales have been recorded to know. Below three it does nothing: a
  // ratio from two sales is an anecdote, and letting an anecdote move every
  // number is worse than leaving the estimate alone.
  const measured = calibration?.get?.(`${brandId ?? '?'}|${route.exit_source}`) ?? null;
  const corrected = calibrate(estimate.value, measured);

  const resale = {
    ...estimate,
    value: corrected.value ?? estimate.value,
    // Both numbers kept: a correction you cannot see is one you cannot check.
    uncalibrated: estimate.value,
    calibration: corrected,
  };

  // Zero exit comps means there is genuinely nothing to estimate from — no
  // amount of labelling makes a number out of no data.
  if (resale.value == null) {
    return {
      scored: false,
      reason: resale.reason ?? `no exit-market comps (need ${MIN_COMPS})`,
      resale,
      route,
      flags,
    };
  }

  // One or two comps: score it, but stamp it. The operator asked to see these
  // rather than have them withheld, which is a reasonable call for a
  // single-user tool — a thin signal you can judge beats a silent gap. The
  // guardrails stay: the estimate is labelled provisional everywhere, its
  // confidence is penalised in proportion to the shortfall, and it can never
  // be "actionable".
  const provisional = !resale.sufficient;
  if (provisional) {
    flags.push({
      kind: 'provisional_estimate',
      severity: 'high',
      message: `Only ${resale.comps} exit comp${resale.comps === 1 ? '' : 's'} — below the ${MIN_COMPS} needed for a settled estimate. Treat this as a lead to investigate, not a number to act on.`,
    });
  }

  const cost = landedCost(price, route);
  const proceeds = netProceeds(resale.value, route);
  const profit = round(proceeds.total - cost.total);
  // Return on what you actually lay out, not on the sticker price.
  const spreadPct = cost.total > 0 ? profit / cost.total : null;

  // Steep discounts are disproportionately scams, listing errors or
  // misrepresented condition. Flagged, never auto-trusted.
  if (price < resale.value * STEEP_DISCOUNT_RATIO) {
    flags.push({
      kind: 'steep_discount',
      severity: 'high',
      message: `Priced ${Math.round((1 - price / resale.value) * 100)}% below the exit median. Steep discounts are disproportionately scams, listing mistakes or misrepresented condition — verify before acting.`,
    });
  }

  if (resale.newestAgeDays != null && resale.newestAgeDays > STALE_COMP_DAYS) {
    flags.push({
      kind: 'stale_comps',
      severity: 'high',
      message: `The freshest exit comp is ${resale.newestAgeDays} days old. This score describes a market that may no longer exist.`,
    });
  }

  if (!provisional && resale.comps === MIN_COMPS) {
    flags.push({
      kind: 'thin_comps',
      severity: 'medium',
      message: `Exactly ${MIN_COMPS} comps — the minimum. One unusual sale moves this materially.`,
    });
  }

  // Is this profit a checkable fact, or an inference from hopes?
  //
  // A comp that is an ASK is what one seller wants. A comp that is a CONFIRMED
  // SALE is what a buyer actually paid. A margin computed from asks alone is
  // arithmetic on two wishes, and it reads on screen exactly like one computed
  // from evidence — which is what made every number here feel invented.
  //
  // It is not withheld: an ask-based estimate is genuinely informative, and
  // for thin archive pieces it is often all there is. But the two must be
  // distinguishable at a glance and sortable apart, so a decision is never
  // made on the belief that a number was checked when it was not.
  const confirmedSales = resale.counts?.confirmed_sale ?? 0;
  const disappearances = resale.counts?.inferred_disappearance ?? 0;

  // Three tiers, not two.
  //
  // Gating on confirmed sales alone would have left this screen permanently
  // empty, because nothing in the automated path ever writes one — and rightly
  // so: a poll that stops seeing a listing cannot know it sold. Only a sale you
  // record yourself is confirmed.
  //
  // But a piece that vanished at a price is not nothing. Somebody took it off
  // the market at that number, and while it might have been withdrawn or
  // reserved, across a pool of comps most of them sold. That is materially
  // better evidence than an asking price, which nobody has agreed to at all.
  //
  // So: sales are best, disappearances count as evidence a piece moved, and
  // asks alone are held back — the distinction that matters is between numbers
  // somebody acted on and numbers somebody merely hoped for.
  const evidenceBasis =
    confirmedSales > 0 ? 'confirmed_sales'
    : disappearances > 0 ? 'disappearances'
    : 'asks_only';

  if (evidenceBasis === 'asks_only') {
    flags.push({
      kind: 'no_confirmed_sales',
      severity: 'medium',
      message:
        'No confirmed sales behind this estimate — it rests entirely on asking ' +
        'prices, which are what sellers hope for, not what buyers paid.',
    });
  }

  // Has anyone ever checked what this route actually costs?
  //
  // Every route ships with a plausible cost stack — 21% VAT, 12% duty, a 5%
  // proxy fee — written to exercise the arithmetic. They are guesses, and on a
  // €600 piece they move the profit figure by more than most of the things
  // this screen sorts on.
  //
  // Which is the argument for HIGH, and it was shipped as medium. Medium meant
  // `actionable` stayed true, so on a fresh install — where no route has been
  // confirmed — every opportunity the engine produced was marked actionable on
  // a cost stack nobody had checked, with the caveat competing for attention
  // against thin_comps and no_confirmed_sales. On a screen whose whole premise
  // is that "actionable" means something, that is the premise failing.
  //
  // So: high, and nothing is actionable until the route it runs through has
  // been confirmed once. It is the cheapest flag on this screen to clear —
  // `npm run route-costs -- --route <id> --confirm` — and unlike thin comps it
  // is cleared by knowing your own fees rather than by waiting for the market.
  if (!route.costs_confirmed_at) {
    const deductions = round(cost.total - price + (resale.value - proceeds.total));
    flags.push({
      kind: 'estimated_costs',
      severity: 'high',
      message:
        `About ${Math.round(deductions)} of fees, shipping, duty and VAT are subtracted here ` +
        'from a cost stack nobody has confirmed, so this profit is arithmetic on guesses. ' +
        'Check it against a real order and a real payout: npm run route-costs',
    });
  }

  // The acquisition listing's own freshness matters as much as the comps': a
  // cheap price observed nine days ago may not exist any more.
  const listingFreshness = listing.entered_manually
    ? freshnessWeight(listing.last_verified_at ?? listing.date_seen, now)
    : freshnessWeight(listing.date_seen, now);
  if (listingFreshness < 0.5) {
    flags.push({
      kind: 'stale_listing',
      severity: 'high',
      message: 'This price has not been confirmed recently. Re-verify before acting on it.',
    });
  }

  // Overall confidence is the comp confidence discounted by how stale the
  // acquisition-side price itself is. Both have to hold for the number to mean
  // anything.
  const confidence = round(resale.confidence * listingFreshness);

  return {
    scored: true,
    // Whether the margin above rests on sales or on asking prices.
    evidenceBasis,
    confirmedSales,
    disappearances,
    provisional,
    route,
    price,
    resale,
    cost,
    proceeds,
    profit,
    spreadPct,
    confidence,
    listingFreshness: round(listingFreshness),
    dataAgeDays: resale.newestAgeDays,
    flags,
    // Anything flagged high is presented as "verify", never as "act".
    actionable: profit > 0 && !flags.some((f) => f.severity === 'high'),
  };
}

/**
 * Score a listing against every route leaving its source, and return them best
 * first. Which exit venue wins is not obvious in advance — Vestiaire's higher
 * commission can still beat Grailed if its comps are stronger.
 */
export function scoreAllRoutes({
  listing, observations, routes, now = new Date(), calibration = null, brandId = null,
}) {
  const applicable = routes.filter((r) => r.acquisition_source === listing.source_id && r.active !== false);
  if (!applicable.length) {
    return {
      best: { scored: false, reason: `no route configured from ${listing.source_id} to an exit venue`, flags: [] },
      all: [],
    };
  }

  const scored = applicable
    .map((route) => scoreOpportunity({ listing, observations, route, now, calibration, brandId }))
    .sort((a, b) => {
      if (a.scored !== b.scored) return a.scored ? -1 : 1;
      return (b.profit ?? -Infinity) - (a.profit ?? -Infinity);
    });

  // Calibration creates a comparison that flatters ignorance.
  //
  // Correcting a venue's estimate downward — because sales there really do come
  // in below its comps — ranks that venue BELOW one with no recorded sales at
  // all, whose estimate is not better but merely unadjusted. Left alone, the
  // ranking would steer every decision toward whichever venue is least
  // understood, and more strongly the more honestly sales were recorded. That
  // is precisely backwards.
  //
  // Not fixed by inventing a correction for the unknown venue, which would be a
  // guess dressed as a measurement. Made visible instead.
  // A figure built entirely from other models is about a category, not a
  // piece. It is still worth showing — an accordion bag with no comps at all
  // tells you nothing — but the row must say what it rests on.
  for (const sc of scored) {
    const r = sc.resale;
    if (sc.scored && r && r.comps > 0 && r.borrowedComps === r.comps) {
      sc.flags.push({
        kind: 'other_models',
        severity: 'medium',
        message:
          'every comp is a different model of the same kind of piece — this ' +
          'prices the category, not this exact piece',
      });
    }
  }

  if (scored.some((sc) => sc.resale?.calibration?.applied)) {
    for (const sc of scored) {
      if (sc.scored && !sc.resale?.calibration?.applied) {
        sc.flags.push({
          kind: 'uncalibrated_venue',
          severity: 'medium',
          message:
            'no recorded sales on this venue — its estimate is unadjusted rather ' +
            'than verified, and outranks venues corrected by real outcomes',
        });
      }
    }
  }

  return { best: scored[0], all: scored };
}
