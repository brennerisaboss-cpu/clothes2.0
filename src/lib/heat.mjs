// Cultural heat.
//
// Some pieces appreciate because of what they signify rather than what they
// cost to replace. That is real, and it shows up in price late — which is the
// argument for watching it early.
//
// It is also the softest thing in this system, so it is fenced off:
//
//   * Heat NEVER enters the arbitrage score. Profit is comps minus a fee stack,
//     both measurable. Heat is inference from attention. Letting it multiply a
//     profit figure would quietly corrupt the one number built to be honest.
//   * Every component is computed separately and shown separately, so a heat
//     reading can always be traced to what caused it.
//   * It refuses on thin data like everything else here. A trend drawn through
//     two points is a line, not a trend.

export const MIN_OBSERVATIONS = 6;   // per window pair, to call a price trend
export const MIN_SIGNAL_POINTS = 8;  // per external series, to call an attention trend
export const DEFAULT_WINDOW_DAYS = 30;

const DAY = 86_400_000;

function toTime(d) {
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
  return Number.isFinite(t) ? t : null;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Split observations into a recent window and the window before it. */
function splitWindows(rows, dateKey, now, windowDays) {
  const cutRecent = now.getTime() - windowDays * DAY;
  const cutPrior = now.getTime() - windowDays * 2 * DAY;
  const recent = [];
  const prior = [];
  for (const row of rows) {
    const t = toTime(row[dateKey]);
    if (t == null) continue;
    if (t >= cutRecent) recent.push(row);
    else if (t >= cutPrior) prior.push(row);
  }
  return { recent, prior };
}

/**
 * Are exit-market asks rising?
 *
 * Uses exit-venue observations only, for the same reason scoring does:
 * acquisition prices answer a different question.
 */
export function priceMomentum(observations, { now = new Date(), windowDays = DEFAULT_WINDOW_DAYS } = {}) {
  const exit = observations.filter(
    (o) => (o.source_role === 'exit' || o.source_role === 'both') && Number.isFinite(Number(o.price_base)),
  );
  const { recent, prior } = splitWindows(exit, 'date_seen', now, windowDays);

  if (recent.length + prior.length < MIN_OBSERVATIONS || !recent.length || !prior.length) {
    return {
      sufficient: false,
      reason: `needs ${MIN_OBSERVATIONS} exit observations across two ${windowDays}-day windows, saw ${recent.length + prior.length}`,
      change: null, recentMedian: null, priorMedian: null,
      recentCount: recent.length, priorCount: prior.length,
    };
  }

  const recentMedian = median(recent.map((o) => Number(o.price_base)));
  const priorMedian = median(prior.map((o) => Number(o.price_base)));
  if (!priorMedian) {
    return { sufficient: false, reason: 'no usable prior median', change: null, recentMedian, priorMedian };
  }

  return {
    sufficient: true,
    reason: null,
    change: Number(((recentMedian - priorMedian) / priorMedian).toFixed(4)),
    recentMedian, priorMedian,
    recentCount: recent.length, priorCount: prior.length,
  };
}

/**
 * How quickly listings leave the market.
 *
 * Only counts listings that actually left, and only where we know both ends.
 * A short median dwell means things are being taken, which is demand.
 */
export function turnoverVelocity(listings, { now = new Date() } = {}) {
  const closed = listings
    .filter((l) => l.status === 'delisted' || l.status === 'sold_confirmed')
    .map((l) => {
      // first_seen is when the snapshot appeared; closed_at when it left.
      // Falling back to date_seen for first_seen would make every dwell zero,
      // so an absent first_seen discards the row instead.
      const seen = toTime(l.first_seen);
      const gone = toTime(l.closed_at);
      if (seen == null || gone == null || gone < seen) return null;
      return (gone - seen) / DAY;
    })
    .filter((d) => d != null);

  const active = listings.filter((l) => l.status === 'active');

  if (closed.length < 3) {
    return {
      sufficient: false,
      reason: `needs 3 closed listings to judge turnover, saw ${closed.length}`,
      medianDaysListed: null, closed: closed.length, active: active.length,
    };
  }

  return {
    sufficient: true,
    reason: null,
    medianDaysListed: Number(median(closed).toFixed(1)),
    closed: closed.length,
    active: active.length,
    // Turnover ratio: closed against everything seen. High means the market
    // clears; low means listings sit.
    clearRate: Number((closed.length / (closed.length + active.length)).toFixed(3)),
  };
}

/** Is the piece appearing more often than it used to? */
export function supplyTrend(listings, { now = new Date(), windowDays = DEFAULT_WINDOW_DAYS } = {}) {
  const { recent, prior } = splitWindows(listings, 'date_seen', now, windowDays);
  if (recent.length + prior.length < 4) {
    return { sufficient: false, reason: 'too few listings to read a supply trend', change: null, recent: recent.length, prior: prior.length };
  }
  // A prior window of zero would divide by nothing; treat first-appearance as
  // new supply rather than infinite growth.
  if (!prior.length) {
    return { sufficient: true, reason: null, change: 1, recent: recent.length, prior: 0, note: 'first appeared in the recent window' };
  }
  return {
    sufficient: true, reason: null,
    change: Number(((recent.length - prior.length) / prior.length).toFixed(4)),
    recent: recent.length, prior: prior.length,
  };
}

/**
 * Trend in an external attention series (Wikipedia pageviews, say).
 *
 * Compares the mean of the most recent third against the mean of the earliest
 * third, which is less jumpy than endpoint-to-endpoint on a noisy series.
 */
export function attentionTrend(signals, { minPoints = MIN_SIGNAL_POINTS } = {}) {
  const points = signals
    .map((s) => ({ t: toTime(s.period_start), v: Number(s.value) }))
    .filter((p) => p.t != null && Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t);

  if (points.length < minPoints) {
    return {
      sufficient: false,
      reason: `needs ${minPoints} points to call an attention trend, saw ${points.length}`,
      change: null, points: points.length,
    };
  }

  const third = Math.max(1, Math.floor(points.length / 3));
  const mean = (arr) => arr.reduce((s, p) => s + p.v, 0) / arr.length;
  const early = mean(points.slice(0, third));
  const late = mean(points.slice(-third));

  if (!early) {
    return { sufficient: false, reason: 'baseline attention was zero', change: null, points: points.length };
  }

  return {
    sufficient: true, reason: null,
    change: Number(((late - early) / early).toFixed(4)),
    early: Number(early.toFixed(1)), late: Number(late.toFixed(1)),
    points: points.length,
  };
}

// Each component contributes at most its weight. Prices moving is the strongest
// evidence because it is the thing we ultimately care about; attention is the
// earliest but the noisiest, so it is weighted for leading indication rather
// than confirmation.
export const WEIGHTS = { price: 0.4, turnover: 0.25, attention: 0.25, supply: 0.1 };

/** Squash an unbounded ratio into 0..1, with `mid` mapping to 0.5. */
function squash(change, mid) {
  if (change == null) return null;
  return 1 / (1 + Math.exp(-(change / mid)));
}

/**
 * Combine the components into one 0–1 reading, with every part exposed.
 *
 * Components that lack data are OMITTED and the weights renormalised over what
 * remains — they do not score zero. Zero would read as "cold", which is a claim
 * we have not earned.
 */
export function heatScore({ price, turnover, attention, supply }) {
  const parts = [];

  if (price?.sufficient) {
    // A 25% move over a month is a strong signal, so that maps near the top.
    parts.push({ key: 'price', weight: WEIGHTS.price, value: squash(price.change, 0.25), detail: `${(price.change * 100).toFixed(0)}% exit median` });
  }
  if (turnover?.sufficient) {
    // 30 days listed is neutral; faster is hotter. Inverted deliberately.
    const v = squash((30 - turnover.medianDaysListed) / 30, 0.5);
    parts.push({ key: 'turnover', weight: WEIGHTS.turnover, value: v, detail: `${turnover.medianDaysListed}d median on market` });
  }
  if (attention?.sufficient) {
    parts.push({ key: 'attention', weight: WEIGHTS.attention, value: squash(attention.change, 0.5), detail: `${(attention.change * 100).toFixed(0)}% attention` });
  }
  if (supply?.sufficient) {
    // Rising supply is ambiguous — more people selling can mean more people
    // want it, or a trend peaking. Weighted lightest for exactly that reason.
    parts.push({ key: 'supply', weight: WEIGHTS.supply, value: squash(supply.change, 1), detail: `${(supply.change * 100).toFixed(0)}% listings` });
  }

  if (!parts.length) {
    return { sufficient: false, reason: 'no component had enough data', score: null, parts: [], componentsUsed: 0 };
  }

  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
  const score = parts.reduce((s, p) => s + p.weight * p.value, 0) / totalWeight;

  return {
    sufficient: true,
    reason: null,
    score: Number(score.toFixed(3)),
    parts: parts.map((p) => ({ ...p, value: Number(p.value.toFixed(3)), share: Number((p.weight / totalWeight).toFixed(3)) })),
    componentsUsed: parts.length,
    // Fewer components means a thinner reading, and the UI says so rather than
    // presenting a one-legged score as if it were four-legged.
    coverage: Number((totalWeight / Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toFixed(3)),
  };
}

export function describeHeat(score) {
  if (!score?.sufficient) return 'insufficient data';
  if (score.score >= 0.7) return 'rising';
  if (score.score >= 0.55) return 'warm';
  if (score.score >= 0.45) return 'flat';
  return 'cooling';
}
