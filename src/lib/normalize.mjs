// Text normalisation for alias lookup.
//
// Latin and Japanese need genuinely different treatment and must not share one
// code path. Stripping combining marks is right for Latin ("Garçons" ->
// "garcons") and destructive for Japanese: NFKD decomposes dakuten, so
// "ジュンヤ" would fold to "シュンヤ" and stop matching. So: detect script
// first, then normalise per script.

const JA_RANGE = /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]/;

/** @returns {'ja'|'latin'} */
export function detectScript(input) {
  return JA_RANGE.test(input) ? 'ja' : 'latin';
}

/**
 * Two forms come back, because they answer different questions.
 *
 *  - `spaced`  keeps word gaps, so short risky aliases ("HP", "CDG") can be
 *              matched on a word boundary instead of as a substring of some
 *              longer word.
 *  - `compact` drops them, so run-together forms in real listing titles
 *              ("CDGHP", "コム・デ・ギャルソン") still match.
 *
 * @returns {{ spaced: string, compact: string, script: 'ja'|'latin' }}
 */
export function normalizeAlias(input) {
  const script = detectScript(input);
  if (script === 'ja') {
    // NFKC folds halfwidth katakana to fullwidth and leaves dakuten intact.
    // Japanese has no word gaps, so spaced and compact coincide; interpuncts
    // and spacing are cosmetic ("コム・デ・ギャルソン" === "コムデギャルソン").
    const compact = input
      .normalize('NFKC')
      .replace(/[・･\s　]+/g, '')
      .toLowerCase();
    return { spaced: compact, compact, script };
  }

  const spaced = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // combining marks: ç -> c, é -> e
    .toLowerCase()
    // Keep '+' so "homme+" stays distinguishable from "homme".
    .replace(/[^a-z0-9+]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

  return { spaced, compact: spaced.replace(/ /g, ''), script };
}

// AD tagging began around 1988. A title claiming an earlier AD year is either a
// misreading or a fake, so the range is bounded rather than trusted.
const AD_PATTERN = /\bA\.?D\.?\s*[-:]?\s*((?:19|20)\d{2})\b/i;

/**
 * Pull a Comme des Garçons AD year out of a listing title.
 *
 * Returns a status alongside the year because "no year" is ambiguous on its
 * own: a piece can predate AD tagging, or the seller simply did not mention
 * it. Those are different facts and the caller must be able to tell them apart.
 *
 * @returns {{ adYear: number|null, status: 'known'|'pre_ad_era'|'unknown' }}
 */
export function parseAdYear(title) {
  if (!title) return { adYear: null, status: 'unknown' };
  const match = title.match(AD_PATTERN);
  if (!match) return { adYear: null, status: 'unknown' };

  const year = Number(match[1]);
  // Parsed cleanly but outside the AD era: record the fact, not the number.
  if (year < 1988) return { adYear: null, status: 'pre_ad_era' };
  if (year > new Date().getFullYear() + 1) return { adYear: null, status: 'unknown' };
  return { adYear: year, status: 'known' };
}
