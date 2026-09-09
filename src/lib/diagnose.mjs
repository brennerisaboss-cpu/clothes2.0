// Why is /opportunities empty?
//
// The screen has five ways of being empty and they look identical, which is
// how "nothing is propagating" became a question nobody could answer from the
// screen itself. A listing reaches that page only if all of this holds:
//
//   1. it is matched to an item                    (else it is in /unresolved)
//   2. its source has role acquisition or both     (an exit listing is a comp,
//                                                   never a thing you buy)
//   3. the same item has >= MIN_COMPS observations on an EXIT source, in the
//      same condition tier                         (resale value comes from
//                                                   the selling venue only)
//   4. a route exists from its source to that exit source
//   5. the evidence behind those comps is strong enough for the current view
//
// Each of those failing is a different problem with a different fix, and the
// order matters: fixing 3 while 2 is empty achieves nothing.
//
// This is pure — it takes a census of counts and returns the first thing that
// is genuinely blocking — so /opportunities and `npm run status` can say the
// same sentence, and so it can be tested without a database.

import { MIN_COMPS } from './priceHistory.mjs';

/**
 * @typedef {object} Census
 * @property {number} listings          active listings, all sources
 * @property {number} matched           of those, attached to an item
 * @property {number} acquisitionActive  matched AND on an acquisition/both source
 * @property {number} exitObservations   observations on an exit/both, non-retail source
 * @property {number} routes             configured acquisition→exit routes
 * @property {number} scored             candidates that produced a number
 * @property {number} salesBacked        of those, resting on sales or disappearances
 * @property {number} asksOnly           of those, resting on asking prices alone
 */

/**
 * The first thing that is actually blocking, or null if nothing is.
 *
 * `fix` is what to do. `href` is where the fix lives when it is a click rather
 * than a command — the asks-only case is one toggle away, and telling someone
 * to run a shell script when a link would do is how that case went unnoticed.
 *
 * @param {Census} c
 * @returns {{kind: string, what: string, fix: string, href?: string} | null}
 */
export function firstBlocker(c) {
  const n = (v) => Number(v ?? 0);

  if (n(c.listings) === 0) {
    return {
      kind: 'no_listings',
      what: 'Nothing has been collected yet.',
      fix: 'Paste a search page from The RealReal, Grailed or Vestiaire on /add.',
      href: '/add',
    };
  }

  if (n(c.matched) === 0) {
    return {
      kind: 'nothing_matched',
      what: `All ${n(c.listings)} listings are unmatched, so none of them belongs to an item yet.`,
      fix: 'Open /unresolved and attach them — the suggestions there do most of it.',
      href: '/unresolved',
    };
  }

  // The one that catches a paste-only workflow, and the reason it is worth
  // spelling out: Grailed and Vestiaire are configured as EXIT venues, so
  // pasting a hundred pages from them adds a hundred comps and zero
  // candidates. The screen then looks exactly as it does with no data at all.
  if (n(c.acquisitionActive) === 0) {
    return {
      kind: 'no_buy_side',
      what:
        'Everything you have is on a venue you SELL through, so nothing is a candidate to buy. ' +
        'Grailed and Vestiaire listings are the yardstick this page measures against, never a row on it.',
      fix: 'Paste a page from the buying side — The RealReal, a Japanese site, a shop — on /add.',
      href: '/add',
    };
  }

  if (n(c.exitObservations) === 0) {
    return {
      kind: 'no_comps',
      what:
        'There are pieces to buy but nothing to value them against: no observations on a venue you can sell through.',
      fix: 'Paste the matching search from Grailed or Vestiaire on /add, then link the rows to the same item.',
      href: '/add',
    };
  }

  // A price nothing can compare.
  //
  // price_base is what every comparison reads and it is stamped once at insert,
  // so a listing recorded while its currency had no rate keeps the null for
  // ever — a listing whose price never changes is never re-inserted. Scoring
  // refuses those outright, so they are ABSENT from this screen rather than
  // ranked low, which is why an empty page was the only symptom.
  //
  // Checked before routes because it is the more specific answer: a route
  // cannot help a listing that has no comparable price to put through it.
  if (n(c.unconvertible) > 0 && n(c.unconvertible) >= n(c.acquisitionActive)) {
    return {
      kind: 'unconvertible',
      what:
        `${n(c.unconvertible)} listing${n(c.unconvertible) === 1 ? '' : 's'} have a price but no ` +
        'base-currency price, so nothing can compare them. They are missing from this screen ' +
        'rather than ranked low — that is what an empty page here usually means.',
      fix: 'npm run fx — it repairs these from the rates already on file, with no network needed',
    };
  }

  if (n(c.routes) === 0) {
    return {
      kind: 'no_routes',
      what: 'No route from where you buy to where you sell, so no cost stack can be applied.',
      fix: 'npm run discover — it creates routes for what it finds.',
    };
  }

  if (n(c.scored) === 0) {
    return {
      kind: 'comps_too_thin',
      what:
        `Both sides are present, but no item reaches ${MIN_COMPS} exit comps in the same condition tier as a ` +
        'piece you could buy. Comps in one tier do not value a piece in another.',
      fix: 'Link more of the exit-side listings to the same item on /unresolved, or widen the search you paste.',
      href: '/unresolved',
    };
  }

  // Everything scored and every one of them is a loss.
  //
  // Checked before the evidence question, because it is the more specific
  // answer: telling someone their margins rest on asking prices, when the
  // margins are all negative anyway, sends them to fix the wrong thing.
  if (n(c.scored) > 0 && n(c.profitable) === 0) {
    const unchecked = n(c.routesConfirmed) === 0;
    return {
      kind: 'all_losses',
      what:
        `All ${n(c.scored)} scored ${n(c.scored) === 1 ? 'piece loses' : 'pieces lose'} money once the ` +
        'route is paid for — a loss is not an opportunity, so none of them is listed.' +
        (unchecked
          ? ' And no route\'s costs have been checked yet, so the duty, VAT, fees and shipping ' +
            'subtracted from every one of those figures are the seeded guesses rather than your numbers.'
          : ''),
      fix: unchecked
        ? 'npm run route-costs'
        : 'Show them anyway, to see how far off they are.',
      href: unchecked ? undefined : '/opportunities?losses=1',
    };
  }

  // Everything worked. The rows exist and are being withheld, which is a
  // judgement rather than a fault — but an empty screen never said so.
  if (n(c.salesBacked) === 0 && n(c.asksOnly) > 0) {
    return {
      kind: 'asks_only',
      what:
        `${n(c.asksOnly)} scored ${n(c.asksOnly) === 1 ? 'margin rests' : 'margins rest'} on asking prices alone — ` +
        'what sellers hope for, not what buyers paid. Pasting a live search page can only ever produce asking ' +
        'prices, so on a paste-driven install this is the normal state rather than a passing one.',
      fix:
        'Show them anyway, marked as ask-based — or add a source that reports ' +
        'what pieces actually sold for: npm run add-ebay -- --sold',
      href: '/opportunities?asks=1',
    };
  }

  return null;
}

/**
 * Should the page fall back to ask-based rows?
 *
 * Withholding them is right while there is something better to show. Doing it
 * when there is nothing better — which is every paste-only install, forever —
 * turns the deliberate reticence into a blank screen, and a blank screen is
 * read as broken rather than as cautious. So: the toggle wins if set,
 * otherwise show what there is and label it.
 */
export function showAsks({ requested, salesBacked, asksOnly }) {
  if (requested) return true;
  return Number(salesBacked ?? 0) === 0 && Number(asksOnly ?? 0) > 0;
}
