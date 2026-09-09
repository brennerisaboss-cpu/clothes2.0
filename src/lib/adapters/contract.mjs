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
 */

/**
 * @typedef {object} Adapter
 * @property {string} id
 * @property {(config: object, deps: object) => Promise<FetchResult>} fetchListings
 */

/** A failure result. Helper so adapters cannot forget `complete: false`. */
export function failed(error, note) {
  return { ok: false, complete: false, listings: [], error: String(error), note };
}

/** A success result. `complete` must be asserted explicitly, never defaulted. */
export function succeeded(listings, { complete, pages, note } = {}) {
  if (typeof complete !== 'boolean') {
    throw new Error('adapter must state whether the catalogue enumeration was complete');
  }
  return { ok: true, complete, listings, pages, note };
}
