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

/**
 * Which currency WOULD make this catalogue look like clothing?
 *
 * The veto stops a wrong currency reaching the table, and then said
 * `--currency XXX` — a literal placeholder, on the one screen where the
 * operator has least to go on. They know the shop; they do not necessarily know
 * that a Japanese-looking domain quotes euros, which is exactly the case that
 * produces this.
 *
 * The arithmetic is available and trivial. The raw prices are known, and the
 * rate table says what every candidate currency converts at, so the question
 * "which of these would put the median where clothing actually sits" has an
 * answer rather than a guess. Where exactly one candidate fits, it is named;
 * where several do, they are all named, because narrowing eight possibilities
 * to two is most of the work even when it does not finish it.
 *
 * It is a suggestion and is worded as one. Nothing applies it: `fix-currency`
 * re-converts every snapshot a source ever wrote, which is not something to do
 * on an inference from a median.
 *
 * @param {number[]} rawPrices        as the shop quoted them, unconverted
 * @param {Map<string, number>} rates candidate currency -> rate into base
 * @returns {{ currency: string, medianBase: number }[]} best fit first
 */
export function currenciesThatWouldFit(rawPrices, rates) {
  const prices = (rawPrices ?? []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (!prices.length || !rates?.size) return [];

  const sorted = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

  // The middle of the plausible band, geometrically: the band spans three
  // orders of magnitude, so the arithmetic midpoint would sit almost at the top
  // of it and rank a £24,000 median as a better fit than a £200 one.
  const ideal = Math.sqrt(MIN_PLAUSIBLE_BASE * MAX_PLAUSIBLE_BASE);

  return [...rates.entries()]
    .map(([currency, rate]) => ({ currency, medianBase: median * Number(rate) }))
    .filter(({ medianBase }) => isPlausiblePrice(medianBase).plausible)
    .sort((a, b) => Math.abs(Math.log(a.medianBase / ideal)) - Math.abs(Math.log(b.medianBase / ideal)));
}

/** The sentence to print when a poll is vetoed for an implausible catalogue. */
export function describeCurrencyFix(sourceId, configured, fits) {
  if (!fits.length) {
    return (
      `Fix with: npm run fix-currency -- --source ${sourceId} --currency <code>. ` +
      `No currency on file would put this catalogue in a plausible range, so the ` +
      `prices themselves may be the problem rather than the currency.`
    );
  }

  const named = fits
    .slice(0, 4)
    .map((f) => `${f.currency} → ${Math.round(f.medianBase)}`)
    .join(', ');

  // Listed, not ranked. Several currencies put a median in the plausible band
  // and the arithmetic cannot tell them apart — presenting one as the answer
  // would dress a shortlist as a finding, on the screen where being wrong costs
  // a re-conversion of every snapshot the source ever wrote.
  return (
    `Configured as ${configured}. A median in these would be plausible instead: ${named}. ` +
    `Check the shop, then: npm run fix-currency -- --source ${sourceId} --currency <code>`
  );
}
