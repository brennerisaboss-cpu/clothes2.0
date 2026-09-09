// Is this price plausible for what this platform tracks?
//
// A currency mistake does not look like an error. It looks like a bargain.
//
// A €500 jacket read as ¥500 converts to about €3 and goes straight to the top
// of the opportunities table, above every real find, wearing a 99% margin. The
// same mistake the other way buries a genuine piece at €128,000. Both are
// silent: every downstream number is arithmetically correct, and the platform
// reports them with full confidence.
//
// Detection cannot be relied on to prevent this. Shops state their currency in
// several places that disagree, /products.json is denominated in the shop's
// base currency while its storefront renders the visitor's, and a feed may
// simply not say. So there is a second line of defence that does not depend on
// getting detection right: once converted to base currency, does the number
// look like clothing?
//
// This is deliberately a very wide net. It is not a judgement about whether a
// price is good — that is what the rest of the platform is for. It only
// catches errors of the magnitude a wrong currency produces, which are two or
// three orders out, never a few per cent.

/** Nothing in this market sells for less than this. Below it, suspect a currency. */
export const MIN_PLAUSIBLE_BASE = 15;

/** Above this, a single secondhand garment is possible but must be looked at. */
export const MAX_PLAUSIBLE_BASE = 25_000;

/**
 * @param {number|null} amountBase  Price converted to base currency.
 * @returns {{ plausible: boolean, reason: string|null }}
 */
export function isPlausiblePrice(amountBase) {
  const n = amountBase == null ? NaN : Number(amountBase);
  if (!Number.isFinite(n)) return { plausible: false, reason: 'not a number' };
  if (n <= 0) return { plausible: false, reason: 'not a positive price' };
  if (n < MIN_PLAUSIBLE_BASE) {
    return { plausible: false, reason: `${n.toFixed(2)} is below anything this market sells for` };
  }
  if (n > MAX_PLAUSIBLE_BASE) {
    return { plausible: false, reason: `${n.toFixed(0)} is beyond a single secondhand garment` };
  }
  return { plausible: true, reason: null };
}

/**
 * Judge a whole catalogue at once, which is far more reliable than judging one
 * price. A shop may legitimately sell one £8 pair of socks; a shop whose MEDIAN
 * piece converts to £3 has been read in the wrong currency.
 *
 * The median, not the mean: one mis-keyed price should not condemn a source,
 * and one enormous piece should not rescue one.
 *
 * @param {number[]} pricesBase
 * @param {object} opts { currency, minSample }
 */
export function assessCatalogue(pricesBase, { currency = null, minSample = 4 } = {}) {
  const usable = pricesBase.map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);

  // Too few to judge. Saying "looks fine" here would be a guess dressed as a
  // check, so it reports that it could not tell instead.
  if (usable.length < minSample) {
    return { verdict: 'unknown', median: usable.length ? median(usable) : null, sample: usable.length,
             reason: `only ${usable.length} priced items — too few to judge` };
  }

  const mid = median(usable);
  const { plausible, reason } = isPlausiblePrice(mid);
  if (plausible) return { verdict: 'ok', median: mid, sample: usable.length, reason: null };

  // Name the likely culprit rather than only the symptom. A median 100-200x
  // low against a yen-denominated read is the signature of this exact bug.
  const suspicion = mid < MIN_PLAUSIBLE_BASE
    ? `prices may not really be in ${currency ?? 'the declared currency'} — a stronger currency read as a weaker one looks this cheap`
    : `prices may not really be in ${currency ?? 'the declared currency'} — a weaker currency read as a stronger one looks this expensive`;

  return { verdict: 'implausible', median: mid, sample: usable.length, reason: `median ${reason}; ${suspicion}` };
}

function median(sorted) {
  const i = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2;
}
