// The poll runner.
//
// This is the single place where an observation becomes a status change, and it
// is deliberately adapter-independent: a broken adapter must not be able to
// mass-mark a source as delisted. Every rule below is from the brief's
// correctness section, which calls this the most important correctness area in
// the system, because the historical median that every score depends on is
// built from these inferences.

// A run that returns dramatically fewer results than the last good one is
// suspect, even if it returned 200 OK. Half is a generous threshold; a real
// archive shop does not lose half its catalogue between polls.
export const SHRINK_RATIO = 0.5;
// Below this, shrink ratios are noise rather than signal.
export const SHRINK_MIN_BASELINE = 8;
// A reappearance within this window under a new id, from the same seller with
// the same title, is a relist rather than a new piece.
export const RELIST_WINDOW_DAYS = 30;

/**
 * May this poll write ANYTHING at all?
 *
 * Distinct from statusChangeVeto, and conflating the two cost the platform a
 * whole class of source. Not being able to enumerate a catalogue is a property
 * of some sources rather than a fault in them: a search rather than a
 * catalogue, a results page with no way to know how many follow. Refusing
 * their observations wholesale discards evidence that was gathered correctly.
 * What must never be inferred from a partial read is an ABSENCE, and that is
 * what the other veto still prevents.
 *
 * So incompleteness alone is not an objection here. Everything else is —
 * because the remaining checks are not about scope, they are symptoms of an
 * adapter that has broken. A feed that returns nothing where it returned eight
 * pieces last time has almost certainly changed its endpoint or started
 * refusing us; ingesting its silence would be believing a fault.
 */
export function ingestVeto(result, previousCount = 0) {
  if (!result.ok) return `poll failed: ${result.error ?? 'unknown error'}`;

  const count = result.listings.length;
  if (count === 0 && previousCount > 0) {
    // Zero results after a non-zero baseline is far more often a broken
    // selector, a changed endpoint or a soft block than a shop emptying out.
    return `poll returned 0 results but ${previousCount} were seen previously`;
  }
  if (previousCount >= SHRINK_MIN_BASELINE && count < previousCount * SHRINK_RATIO) {
    return `poll returned ${count} results, down from ${previousCount} — suspiciously fewer`;
  }
  return null;
}

/**
 * Decide whether a fetch result may be used to change listing statuses.
 *
 * Returns a reason string when it may not. This is the guard that stops a
 * silently broken adapter from recording an entire source as gone — and it is
 * strictly stricter than ingestVeto: everything that stops a write also stops
 * an absence, plus incompleteness, which stops only the absence.
 *
 * A partial poll saw some of the catalogue. What it did not see is not
 * evidence of anything, and inferring a disappearance from it would
 * manufacture the strongest evidence tier this platform has out of the weakest
 * possible observation.
 */
export function statusChangeVeto(result, previousCount) {
  if (!result.ok) return `poll failed: ${result.error ?? 'unknown error'}`;
  // Before the count tests, not after. On a partial read the count is a
  // fraction of the catalogue by definition, so "suspiciously fewer" would be
  // the wrong sentence about the right refusal — and it is the sentence that
  // gets printed and acted on.
  if (!result.complete) return 'poll did not enumerate the full catalogue';
  return ingestVeto(result, previousCount);
}

/** Normalise a title for relist comparison. */
function relistKey(listing) {
  const title = String(listing.title_raw ?? listing.title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  const seller = String(listing.seller_id ?? listing.sellerId ?? '').toLowerCase();
  return `${seller}|${title}`;
}

/**
 * Match newly-seen listings against recently-vanished ones.
 *
 * A relist is not a sale. Recording one as a sale would log a transaction that
 * never happened at a price nobody paid, and then use it as a comp — the exact
 * bias the brief warns about. So a same-seller, same-title reappearance under a
 * new source id is linked to its predecessor and the price history carries
 * forward.
 *
 * @returns {Map<string, string>} new listing sourceItemId -> prior listing id
 */
export function detectRelists(incoming, recentlyGone, now = new Date()) {
  const cutoff = now.getTime() - RELIST_WINDOW_DAYS * 86_400_000;
  const byKey = new Map();

  for (const prior of recentlyGone) {
    const seen = new Date(prior.date_seen).getTime();
    if (!Number.isFinite(seen) || seen < cutoff) continue;
    const key = relistKey(prior);
    // Keep the most recent candidate per key.
    const existing = byKey.get(key);
    if (!existing || seen > new Date(existing.date_seen).getTime()) byKey.set(key, prior);
  }

  const links = new Map();
  for (const listing of incoming) {
    const key = relistKey(listing);
    const prior = byKey.get(key);
    // A listing that kept its id is the same listing, not a relist.
    if (!prior || prior.source_item_id === listing.sourceItemId) continue;
    links.set(listing.sourceItemId, prior.id);
    byKey.delete(key); // one prior listing can only be relisted once
  }
  return links;
}

/**
 * Work out what to do with listings that were active but are absent now.
 *
 * The only conclusion permitted is `delisted` — "it is no longer listed" — and
 * only from a poll that is known good and known complete. It never becomes
 * `sold_confirmed`, because absence is not evidence of a sale.
 */
export function planAbsences(previousActive, seenIds, relinked) {
  const seen = new Set(seenIds);
  // `relinked` maps NEW sourceItemId -> PRIOR listing id, so the ids to exclude
  // are its values, not its keys. Getting this backwards marks a relisted
  // listing as delisted as well, manufacturing a phantom disappearance beside
  // the relist we just correctly identified.
  const supersededIds = new Set(relinked.values());
  return previousActive
    .filter((l) => !seen.has(l.source_item_id))
    // A listing whose successor we identified is a relist, not a disappearance.
    .filter((l) => !supersededIds.has(l.id))
    .map((l) => ({
      id: l.id,
      status: 'delisted',
      // Explicitly NOT a sale, and recorded as such so a later reader cannot
      // mistake it for one.
      evidence: 'inferred_disappearance',
      reason: 'absent from a complete, successful poll',
    }));
}

/**
 * Which sources are due, and which have asked to be left alone.
 *
 * Two clauses that were both missing, and between them they are why a busy shop
 * ends up rate-limiting even robots.txt.
 *
 * CADENCE. `poll_interval_minutes` has been in the schema since the first
 * migration, and scripts/poll.mjs opens by explaining why it matters — "a fast
 * marketplace turns over in minutes, a one-person archive shop in weeks, and
 * applying one schedule to both is either rude or useless". It then selected
 * every feed source and polled all of them on every tick. A shop configured for
 * twice a day was read ninety-six times a day.
 *
 * COOLDOWN. A 429 is the one failure that is the source telling you the
 * schedule is the problem, so it is the one failure that must not be answered
 * by keeping the schedule.
 *
 * Measured from the last ATTEMPT rather than the last good poll. A source that
 * can never report a complete catalogue — a search, a results page — never
 * updates `last_good_poll_at`, so pacing off that would leave exactly the
 * sources that cannot enumerate being polled on every tick for ever, which is
 * the population most likely to rate-limit.
 *
 * `--source x` and a manual run bypass this deliberately: asking for one source
 * by name is a person deciding, and a cooldown is guidance for a schedule.
 */
export const DUE_FOR_POLL = `
  (s.cooldown_until is null or s.cooldown_until <= now())
  and not exists (
    select 1 from poll_runs pr
     where pr.source_id = s.id
       and pr.started_at > now() - (coalesce(s.poll_interval_minutes, 360) || ' minutes')::interval
  )
`;

/** How long to leave a source alone when it rate-limits and names no delay. */
export const DEFAULT_COOLDOWN_MINUTES = 60;

/**
 * When a source may next be polled, after it answered 429.
 *
 * The shop's own number where it gave one, bounded at both ends: a `Retry-After`
 * of two seconds is not a cooldown worth recording, and one of a fortnight is a
 * header parking a source indefinitely. Neither bound overrides a shop that
 * asked for something reasonable, which is almost all of them.
 */
export const MIN_COOLDOWN_MINUTES = 5;
export const MAX_COOLDOWN_MINUTES = 24 * 60;

export function cooldownMinutes(retryAfterSeconds) {
  const asked = Number(retryAfterSeconds);
  if (!Number.isFinite(asked) || asked <= 0) return DEFAULT_COOLDOWN_MINUTES;
  const minutes = Math.ceil(asked / 60);
  return Math.min(MAX_COOLDOWN_MINUTES, Math.max(MIN_COOLDOWN_MINUTES, minutes));
}
