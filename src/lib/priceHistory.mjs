// Price-history model.
//
// Phase 2 scope: turn an item's snapshot rows into a defensible view of what it
// has been priced at. It deliberately stops short of arbitrage scoring (phase
// 4) — no fees, shipping, VAT or expected profit here.
//
// Two rules from the brief drive the whole design:
//   * Comps are never pooled across condition tiers. A €1,000 mint piece and a
//     €1,000 damaged piece are not the same comp.
//   * Evidence quality is not uniform, and the split must stay visible. A
//     confirmed sale is a fact; a disappearance is a guess.

import { freshnessWeight } from './confidence.mjs';

export const MIN_COMPS = 3;

// A confirmed sale is what someone actually paid. An active ask is what someone
// hopes to get. A disappearance is an inference we may simply have wrong. These
// are not close to equivalent and must not be averaged as if they were.
export const EVIDENCE_WEIGHT = {
  confirmed_sale: 1,
  active_ask: 0.45,
  inferred_disappearance: 0.15,
};

const TIER_ORDER = ['damaged', 'fair', 'good', 'excellent', 'new', 'new_with_tags'];

/**
 * Weighted median: the price at which half the evidence weight sits below.
 * Not a mean — a single mispriced outlier should not drag the centre.
 */
export function weightedMedian(entries) {
  const usable = entries
    .filter((e) => Number.isFinite(e.value) && e.weight > 0)
    .sort((a, b) => a.value - b.value);
  if (!usable.length) return null;

  const total = usable.reduce((sum, e) => sum + e.weight, 0);
  const half = total / 2;
  let running = 0;
  for (let i = 0; i < usable.length; i++) {
    running += usable[i].weight;
    if (running >= half) {
      // Exactly on the boundary with a neighbour: average the two so an even
      // split does not arbitrarily pick the lower side.
      if (running === half && i + 1 < usable.length) {
        return (usable[i].value + usable[i + 1].value) / 2;
      }
      return usable[i].value;
    }
  }
  return usable.at(-1).value;
}

/**
 * Score one observation.
 *
 * Weight combines evidence class with recency: three comps from last month
 * should beat twenty from two years ago. Manual entries additionally decay by
 * how long since you last verified them.
 *
 * `sizeWeight` is the third factor and is attached by the caller rather than
 * computed here, because it is the only one that depends on what is being
 * valued rather than on the observation alone: a comp is not intrinsically the
 * wrong size, it is the wrong size FOR a particular piece. Absent, it is 1 —
 * which is the honest default, since an unread size is compatible with any size
 * and only a stated one that differs is evidence of a difference.
 */
export function observationWeight(obs, now = new Date()) {
  const evidence = EVIDENCE_WEIGHT[obs.evidence] ?? EVIDENCE_WEIGHT.inferred_disappearance;
  const recency = obs.entered_manually
    ? freshnessWeight(obs.last_verified_at ?? obs.date_seen, now)
    : freshnessWeight(obs.date_seen, now);
  const size = Number.isFinite(Number(obs.sizeWeight)) ? Number(obs.sizeWeight) : 1;
  return Number((evidence * recency * size).toFixed(4));
}

function summariseTier(tier, observations, now) {
  const priced = observations.filter((o) => Number.isFinite(Number(o.price_base)));
  const entries = priced.map((o) => ({
    value: Number(o.price_base),
    weight: observationWeight(o, now),
    evidence: o.evidence,
    date: o.date_seen,
  }));

  const counts = {
    confirmed_sale: entries.filter((e) => e.evidence === 'confirmed_sale').length,
    active_ask: entries.filter((e) => e.evidence === 'active_ask').length,
    inferred_disappearance: entries.filter((e) => e.evidence === 'inferred_disappearance').length,
  };

  const n = entries.length;
  const sufficient = n >= MIN_COMPS;
  const totalWeight = entries.reduce((s, e) => s + e.weight, 0);

  // Confidence is deliberately three separate, inspectable factors rather than
  // one opaque number, so the UI can show WHY a score is weak.
  const volume = Math.min(1, n / 6);
  const quality = n ? totalWeight / n : 0;
  const ages = entries.map((e) => (now.getTime() - new Date(e.date).getTime()) / 86_400_000);
  const newestAgeDays = ages.length ? Math.min(...ages) : null;
  const oldestAgeDays = ages.length ? Math.max(...ages) : null;
  const recency = ages.length ? Math.max(0, 1 - Math.min(...ages) / 180) : 0;

  const median = n ? weightedMedian(entries) : null;
  const confidence = Number((volume * (0.4 + 0.6 * quality) * recency).toFixed(3));
  // Below the minimum, an estimate still exists but is penalised in proportion
  // to how far short it falls, so a one-comp number can never masquerade as a
  // three-comp one.
  const shortfallPenalty = Math.min(1, n / MIN_COMPS);

  return {
    tier,
    count: n,
    counts,
    sufficient,
    // `median` stays null below the minimum: callers that want a number in that
    // range must reach for `provisionalMedian` and label it, which makes the
    // weakness impossible to render by accident.
    median: sufficient ? median : null,
    provisionalMedian: median,
    provisionalConfidence: n ? Number((confidence * shortfallPenalty).toFixed(3)) : 0,
    reason: sufficient ? null : `insufficient data — ${n} comp${n === 1 ? '' : 's'}, need ${MIN_COMPS}`,
    confidence: sufficient ? confidence : 0,
    factors: {
      volume: Number(volume.toFixed(3)),
      quality: Number(quality.toFixed(3)),
      recency: Number(recency.toFixed(3)),
    },
    newestAgeDays: newestAgeDays == null ? null : Math.floor(newestAgeDays),
    oldestAgeDays: oldestAgeDays == null ? null : Math.floor(oldestAgeDays),
    lowestActive: (() => {
      const active = priced.filter((o) => o.status === 'active');
      if (!active.length) return null;
      return Math.min(...active.map((o) => Number(o.price_base)));
    })(),
  };
}

/**
 * Summarise an item's observations, grouped by condition tier.
 *
 * Observations with no condition tier are kept in their own bucket rather than
 * being folded into a tier they might not belong to.
 *
 * @returns {{ tiers: object[], untiered: object, totals: object }}
 */
export function summariseItem(observations, now = new Date()) {
  const byTier = new Map();
  const untiered = [];

  for (const obs of observations) {
    if (!obs.condition_tier) {
      untiered.push(obs);
      continue;
    }
    if (!byTier.has(obs.condition_tier)) byTier.set(obs.condition_tier, []);
    byTier.get(obs.condition_tier).push(obs);
  }

  const tiers = [...byTier.entries()]
    .map(([tier, obs]) => summariseTier(tier, obs, now))
    .sort((a, b) => TIER_ORDER.indexOf(b.tier) - TIER_ORDER.indexOf(a.tier));

  const allCounts = observations.reduce(
    (acc, o) => {
      acc[o.evidence] = (acc[o.evidence] ?? 0) + 1;
      return acc;
    },
    { confirmed_sale: 0, active_ask: 0, inferred_disappearance: 0 },
  );

  return {
    tiers,
    untiered: untiered.length
      ? { ...summariseTier(null, untiered, now), tier: null }
      : null,
    totals: {
      observations: observations.length,
      counts: allCounts,
      // The split the brief asks to be surfaced: "median from 3 confirmed
      // sales, 11 inferred".
      evidenceSummary: describeEvidence(allCounts),
    },
  };
}

export function describeEvidence(counts) {
  const parts = [];
  if (counts.confirmed_sale) parts.push(`${counts.confirmed_sale} confirmed sale${counts.confirmed_sale === 1 ? '' : 's'}`);
  if (counts.active_ask) parts.push(`${counts.active_ask} active ask${counts.active_ask === 1 ? '' : 's'}`);
  if (counts.inferred_disappearance) parts.push(`${counts.inferred_disappearance} inferred`);
  return parts.length ? parts.join(', ') : 'no observations';
}
