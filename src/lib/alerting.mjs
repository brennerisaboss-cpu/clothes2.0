// Alert rule evaluation.
//
// Deliberately pure: given a score and a rule, decide whether it fires and why.
// Delivery, deduplication and persistence live elsewhere, so the decision can
// be tested without a webhook or a database.
//
// The framing that matters: an alert is a call to look NOW. That makes it a
// different bar from a dashboard row. A dashboard can afford to show a weak
// signal with a caveat; an alert that cries wolf trains you to ignore the next
// one, which is the failure mode that costs the most.

const num = (v) => (v == null ? null : Number(v));

/**
 * @returns {{ fires: boolean, reason: string, matched: string[] }}
 */
export function evaluateRule(score, rule, listing = {}) {
  const matched = [];

  if (!rule.enabled) return { fires: false, reason: 'rule disabled', matched };
  if (!score?.scored) return { fires: false, reason: 'listing has no score', matched };

  if (score.provisional && !rule.include_provisional) {
    return {
      fires: false,
      reason: 'provisional estimate, and this rule excludes them',
      matched,
    };
  }

  // What the margin rests on.
  //
  // A screen you chose to look at can carry a caveat beside a number. A push
  // notification cannot — it is read as "this is worth acting on now" — so a
  // margin computed entirely from asking prices does not get to send one
  // unless the rule says in as many words that it should.
  if (score.evidenceBasis === 'asks_only' && !rule.include_asks_only) {
    return {
      fires: false,
      reason: 'rests only on asking prices, and this rule excludes them',
      matched,
    };
  }

  const highFlags = (score.flags ?? []).filter((f) => f.severity === 'high');
  if (highFlags.length && !rule.include_flagged) {
    return {
      fires: false,
      reason: `carries ${highFlags.length} high-severity flag(s), and this rule excludes them`,
      matched,
    };
  }

  const minProfit = num(rule.min_profit_base);
  if (minProfit != null) {
    if ((score.profit ?? -Infinity) < minProfit) {
      return { fires: false, reason: `profit below ${minProfit}`, matched };
    }
    matched.push(`profit ≥ ${minProfit}`);
  }

  const minSpread = num(rule.min_spread_pct);
  if (minSpread != null) {
    if ((score.spreadPct ?? -Infinity) < minSpread) {
      return { fires: false, reason: `spread below ${(minSpread * 100).toFixed(0)}%`, matched };
    }
    matched.push(`spread ≥ ${(minSpread * 100).toFixed(0)}%`);
  }

  const minConfidence = num(rule.min_confidence);
  if (minConfidence != null) {
    if ((score.confidence ?? 0) < minConfidence) {
      return { fires: false, reason: `confidence below ${minConfidence}`, matched };
    }
    matched.push(`confidence ≥ ${minConfidence}`);
  }

  if (rule.subline_id && listing.subline_id !== rule.subline_id) {
    return { fires: false, reason: 'sub-line does not match the rule', matched };
  }
  if (rule.source_id && listing.source_id !== rule.source_id) {
    return { fires: false, reason: 'source does not match the rule', matched };
  }
  if (rule.route_id && score.route?.id !== rule.route_id) {
    return { fires: false, reason: 'route does not match the rule', matched };
  }

  // A rule with no thresholds at all would fire on everything scoreable, which
  // is a firehose rather than an alert. Treated as misconfiguration.
  if (!matched.length) {
    return { fires: false, reason: 'rule sets no thresholds — it would match everything', matched };
  }

  return { fires: true, reason: matched.join(', '), matched };
}

/**
 * Latency, in seconds, from the earliest point we can honestly measure.
 *
 * Where the source states a publish time, that is the real clock — it includes
 * however long we took to notice. Where it does not, we can only measure from
 * our own first sighting, which flatters the number, so the two are reported
 * separately rather than conflated.
 */
export function latencyFor(listing, sentAt = new Date()) {
  const sent = sentAt instanceof Date ? sentAt : new Date(sentAt);
  const observed = listing.date_seen ? new Date(listing.date_seen) : null;
  const published = listing.source_published_at ? new Date(listing.source_published_at) : null;

  const secs = (from) =>
    from && Number.isFinite(from.getTime()) ? Math.max(0, (sent.getTime() - from.getTime()) / 1000) : null;

  return {
    observedToSent: secs(observed),
    publishedToSent: secs(published),
    // The honest headline: prefer the source clock when we have it.
    best: secs(published) ?? secs(observed),
    basis: published ? 'source publish time' : 'our first sighting',
  };
}

export function formatLatency(seconds) {
  if (seconds == null) return 'unknown';
  if (seconds < 90) return `${Math.round(seconds)}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  if (seconds < 172800) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}
