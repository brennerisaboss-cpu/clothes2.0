// The adapter contract.
//
// Every automated source conforms to this. Getting it right here matters more
// than the Shopify implementation itself, because Rakuten, Yahoo Shopping and
// eBay all have to fit it later.
//
// The shape of the contract encodes the brief's correctness rules so an adapter
// physically cannot break them:
//
//   * An adapter RETURNS OBSERVATIONS. It never decides that something sold,
//     was delisted, or disappeared. It reports what it saw, and `ok: false`
//     when it could not see properly. All status inference lives in one place
//     (src/lib/ingest.mjs) so a broken adapter cannot mass-mark a source.
//
//     The rule is about INFERENCE, and one source does not infer. eBay's
//     Marketplace Insights returns completed sales — an item, a price, a date,
//     stated by the venue — so reporting one is not a conclusion drawn from
//     silence, it is repeating what the source said. That is the only thing
//     `sold_confirmed` has ever been allowed to mean, and `evidence` below is
//     how an adapter says it. Nothing else may set it, and an adapter that
//     merely stops seeing a listing still cannot: absence is handled where it
//     always was.
//
//   * An adapter must report `complete`: did it enumerate the whole catalogue,
//     or only part of it? A partial poll may never be used to conclude that
//     anything is gone.
//
//   * An adapter never converts currency, normalises condition, or resolves a
//     brand. It reports raw values; the shared pipeline normalises them, so a
//     mapping lives in one auditable place rather than per adapter.

/**
 * @typedef {object} RawListing
 * @property {string}  sourceItemId  Stable id within the source.
 * @property {string}  title
 * @property {string=} brandRaw      As the source labels it.
 * @property {number}  price
 * @property {string}  currency      ISO code. Never guessed — see shopify.mjs.
 * @property {string=} sizeRaw
 * @property {string=} conditionRaw
 * @property {string=} url
 * @property {string=} imageUrl
 * @property {string=} sellerId      Used for relist detection.
 * @property {boolean=} available
 * @property {'confirmed_sale'=} evidence
 *   The ONE exception to "an adapter never decides that something sold", and it
 *   is narrow on purpose. Every other source can only ever mean "it stopped
 *   appearing", which is an inference and is representable as
 *   `inferred_disappearance` and nothing stronger. This field is for a source
 *   that states the outcome outright — eBay's Marketplace Insights returns
 *   completed sales with a price and a date — which is the single case the
 *   schema lets `sold_confirmed` describe. Setting it without `soldAt` does
 *   nothing: a sale with no date cannot be weighted for recency, and an undated
 *   sale stamped with today's date is the failure this exists to avoid.
 * @property {Date|string=} soldAt
 *   When the sale happened, from the source's own record. Never when it was
 *   read: a sale is a fact with a timestamp, and dating it to the poll would
 *   let a three-month-old result count as evidence gathered this morning.
 * @property {object=} extra
 */

/**
 * @typedef {object} FetchResult
 * @property {boolean}     ok        False on ANY doubt. A false here must never
 *                                   be allowed to change a listing's status.
 * @property {boolean}     complete  Did this enumerate the whole catalogue?
 * @property {RawListing[]} listings
 * @property {string=}     error
 * @property {number=}     pages
 * @property {string=}     note
 * @property {boolean=}    rateLimited
 *   The source asked to be left alone. Distinct from every other failure,
 *   because every other failure is a reason to try again on the usual schedule
 *   and this one is a reason not to. The runner turns it into a cooldown, so
 *   the next tick skips the source instead of asking again in fifteen minutes —
 *   which is what turns one 429 into a shop that rate-limits even robots.txt.
 * @property {number=}     retryAfterSeconds
 *   What the source said to wait, where it said so. Its own number, not a
 *   guess: a shop that names a delay has told you the answer.
 */

/**
 * @typedef {object} Adapter
 * @property {string} id
 * @property {(config: object, deps: object) => Promise<FetchResult>} fetchListings
 */

/** A failure result. Helper so adapters cannot forget `complete: false`. */
export function failed(error, note, { rateLimited, retryAfterSeconds } = {}) {
  return {
    ok: false, complete: false, listings: [], error: String(error), note,
    rateLimited: rateLimited || undefined,
    retryAfterSeconds: retryAfterSeconds ?? undefined,
  };
}

/** A success result. `complete` must be asserted explicitly, never defaulted. */
export function succeeded(listings, { complete, pages, note, rateLimited, retryAfterSeconds } = {}) {
  if (typeof complete !== 'boolean') {
    throw new Error('adapter must state whether the catalogue enumeration was complete');
  }
  return {
    ok: true, complete, listings, pages, note,
    rateLimited: rateLimited || undefined,
    retryAfterSeconds: retryAfterSeconds ?? undefined,
  };
}

/**
 * What a `Retry-After` header actually asked for, in seconds.
 *
 * Two legal forms and both appear in the wild: a delay in seconds, and an HTTP
 * date. Reading only the first treats "Retry-After: Wed, 21 Oct 2026 07:28:00
 * GMT" as NaN and throws away the one number the source volunteered.
 *
 * Bounded, because a header is something a server sends and not something to
 * obey without limit: a shop asking for a week is asking for longer than any
 * sensible cooldown, and the cap is what stops one bad header parking a source
 * for ever.
 */
export const MAX_RETRY_AFTER_SECONDS = 24 * 60 * 60;

export function retryAfterSeconds(header, now = Date.now()) {
  const raw = String(header ?? '').trim();
  if (!raw) return null;

  const seconds = Number(raw);
  if (Number.isFinite(seconds)) {
    if (seconds <= 0) return null;
    // Rounded UP, never to zero. A source that asked for a fraction of a second
    // asked for something, and rounding that to 0 turns "wait" into "do not".
    return Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(1, Math.round(seconds)));
  }

  const at = new Date(raw).getTime();
  if (!Number.isFinite(at)) return null;
  const delta = Math.round((at - now) / 1000);
  if (delta <= 0) return null;
  return Math.min(MAX_RETRY_AFTER_SECONDS, delta);
}
