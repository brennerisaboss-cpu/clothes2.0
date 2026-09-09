// What kind of garment is this, and what is it made of?
//
// This exists because of the single most consequential identity question in
// the platform: when is a listing on one marketplace the SAME PIECE as a
// listing on another?
//
// Everything downstream rests on that answer. Resale value is the weighted
// median of an item's exit comps; if two listings of one garment fail to pool,
// each has a comp set of one and nothing can be valued. If two different
// garments wrongly pool, the median is computed across pieces that were never
// comparable and every number derived from it is fiction.
//
// Matching on the raw title cannot work. The same jacket is
//
//   "Comme des Garcons Homme Plus AD2002 wool tailored jacket"
//   "CDG HOMME PLUS 02AW ウール テーラード ジャケット"
//   "comme des garcons homme plus ad2002 wool jacket"
//
// — three titles, three sellers, one garment. Byte equality gives three items
// and no comps.
//
// So identity is built from things that can be PROVEN from controlled
// vocabularies rather than inferred from prose:
//
//   sub-line  (the alias table, already deterministic)
//   AD year   (parsed, and its own bucket when unknown)
//   garment type      (this file)
//   dominant material (this file)
//
// Two listings pool only when all four agree. Where a garment type cannot be
// identified, the listing is NOT matched — it goes to /unresolved for the eye,
// which is the brief's stated fallback and is always better than a wrong merge.
//
// The vocabularies are deliberately coarse. A finer one ("bomber" vs "blouson"
// vs "flight jacket") would split pools that should be together, which costs
// comps; a coarser one would pool a coat with a jacket, which costs accuracy.
// Type plus material is about the level at which resale comps are actually
// drawn by hand.

import { normalizeAlias } from './normalize.mjs';

// Garment types, most specific first within each family. Order matters: the
// first hit wins, so "long coat" must be reachable before "coat" only where it
// would mean something different — here it does not, so both fold to "coat".
//
// Japanese terms sit alongside the English because a Japanese shop's feed is
// one of the primary acquisition sources and its titles are in Japanese.
//
// ORDER IS LOAD-BEARING, and not in the way it first appears. The comparison
// runs against the COMPACT form, which has had its spaces removed, so one term
// is a substring of another far more often than it looks:
//
//   "t-shirt" -> "tshirt", which contains "shirt"
//   "ショートパンツ" (shorts) contains "パンツ" (trousers)
//
// Both were live bugs before this comment existed: a tee pooled with button-up
// shirts, and Japanese shorts pooled with trousers — quietly, since a wrong
// pool produces plausible numbers rather than an error. So the narrower family
// is always listed above the family whose term it contains, and the tests hold
// each of these pairs in place.
const TYPES = [
  ['jacket',    ['tailoredjacket', 'blazer', 'jacket', 'blouson', 'bomber', 'biker', 'ridersjacket',
                 'ジャケット', 'ブルゾン', 'ライダース']],
  // Hoodies before coats, and this is not a stylistic ordering.
  //
  // パーカー is the Japanese word for a HOODIE, not for a parka, and the coat
  // family used to claim it: every Japanese hoodie in every feed was pooled
  // with overcoats, which is a wrong merge of the exact kind this file exists
  // to prevent — a €90 hoodie voting on the median of a €900 coat. The English
  // "parka" genuinely is a coat and stays there; only the katakana moved.
  //
  // 'hooded' is deliberately absent: "hooded parka" is a coat with a hood, and
  // claiming it here would trade one wrong merge for another.
  ['hoodie',    ['hoodie', 'hoody', 'hoodedsweatshirt', 'hoodedsweat',
                 'パーカー', 'パーカ', 'フーディ']],
  // Before both 'shirt' (which "sweatshirt" contains) and 'coat'.
  // トレーナー is Japanese for a sweatshirt, and has nothing to do with the
  // English "trainer" in the sneaker family below — different scripts, so the
  // two never collide.
  ['sweatshirt', ['sweatshirt', 'crewneck', 'crewnecksweat', 'スウェット', 'トレーナー']],
  ['coat',      ['trenchcoat', 'overcoat', 'longcoat', 'peacoat', 'coat', 'parka', 'anorak',
                 'poncho', 'コート', 'アノラック']],
  ['shorts',    ['shorts', 'ショーツ', 'ショートパンツ', 'ハーフパンツ']],   // before trousers: contains パンツ
  ['trousers',  ['trousers', 'pants', 'slacks', 'jeans', 'denimpant', 'パンツ', 'スラックス', 'デニム']],
  ['tee',       ['tshirt', 'tee', 'cutsew', 'カットソー', 'tシャツ']],       // before shirt: contains shirt
  ['shirt',     ['shirt', 'blouse', 'シャツ', 'ブラウス']],
  ['knit',      ['turtleneck', 'rollneck', 'mockneck', 'knit', 'sweater', 'jumper', 'cardigan',
                 'pullover', 'ニット', 'セーター', 'カーディガン', 'タートルネック']],
  ['tank',      ['tanktop', 'camisole', 'タンクトップ', 'キャミソール']],
  ['jumpsuit',  ['jumpsuit', 'coverall', 'boilersuit', 'overall', 'つなぎ', 'オーバーオール']],
  ['skirt',     ['skirt', 'スカート']],
  ['dress',     ['dress', 'gown', 'ワンピース', 'ドレス']],
  ['vest',      ['vest', 'waistcoat', 'gilet', 'ベスト']],
  // Footwear and bags are split finer than garments, because within one house
  // the models differ far more in price than a jacket differs from a jacket.
  // A Guidi derby and a Guidi boot are not comps for each other, and neither
  // are an M.A+ accordion bag and an M.A+ pouch.
  ['boots',     ['boot', 'ブーツ']],
  ['derby',     ['derby', 'oxford', 'ダービー']],
  ['sneakers',  ['sneaker', 'trainer', 'スニーカー']],
  ['sandals',   ['sandal', 'サンダル']],
  ['moccasin',  ['moccasin', 'モカシン']],
  ['loafers',   ['loafer', 'slipper', 'mule', 'ローファー']],
  ['footwear',  ['shoe', 'シューズ', '靴']],
  ['backpack',  ['backpack', 'rucksack', 'リュック', 'バックパック']],
  ['tote',      ['tote', 'トート']],
  ['accordion bag', ['accordion', 'アコーディオン']],
  ['shoulder bag',  ['shoulderbag', 'crossbody', 'messenger', 'ショルダー']],
  ['pouch',     ['pouch', 'clutch', 'wallet', 'ポーチ', 'クラッチ', '財布']],
  ['bag',       ['bag', 'バッグ']],
  ['scarf',     ['scarf', 'stole', 'muffler', 'マフラー', 'ストール']],
  ['hat',       ['beanie', 'cap', 'hat', 'ハット', 'キャップ']],
  // A kimono-SLEEVED jacket is a jacket, so the garment families all get to
  // claim a title before this one does.
  ['kimono',    ['kimono', 'haori', '着物', '羽織']],
  // Accessories last, and for a load-bearing reason: "belted coat" compacts to
  // "beltedcoat", which contains "belt". Every family that could own the piece
  // has already had its turn by the time these are reached, so only a title
  // that is about the accessory itself can land here.
  ['belt',      ['belt', 'ベルト']],
  ['gloves',    ['glove', 'グローブ', '手袋']],
  ['socks',     ['socks', 'ソックス', '靴下']],
];


// Dominant material. Only fibres that actually move resale value are listed —
// a lining or a trim should not create a separate pool, so the first match in
// this order wins and it runs from the most価格-defining downward.
const MATERIALS = [
  // Shearling before leather: "shearling leather" is a shearling, and it does
  // not price like a plain lambskin.
  ['shearling', ['shearling', 'ムートン', 'ボア']],
  ['leather',  ['lambskin', 'calfskin', 'cowhide', 'horsehide', 'leather', 'suede', 'レザー', '革', 'スエード']],
  // Mohair and cashmere before wool, because a title that names either is
  // naming the fibre that carries the price, and both are routinely written
  // beside the word "wool".
  ['mohair',   ['mohair', 'モヘア']],
  ['cashmere', ['cashmere', 'カシミヤ', 'カシミア']],
  ['alpaca',   ['alpaca', 'アルパカ']],
  ['wool',     ['gabardine', 'melton', 'tweed', 'flannel', 'wool', 'ウール', '毛']],
  ['silk',     ['silk', 'シルク', '絹']],
  ['linen',    ['linen', 'リネン', '麻']],
  ['denim',    ['denim', 'デニム']],
  // Corduroy and velvet are cotton by fibre and are not cotton by price, so
  // they are their own pools and sit above it.
  ['corduroy', ['corduroy', 'コーデュロイ']],
  ['velvet',   ['velvet', 'velour', 'ベルベット', 'ベロア']],
  ['cotton',   ['cotton', 'コットン', '綿']],
  // Named technical fabrics before the generic synthetics: a Gore-Tex shell is
  // not priced as a nylon one.
  ['goretex',  ['goretex', 'ゴアテックス']],
  ['nylon',    ['nylon', 'polyester', 'ナイロン', 'ポリエステル']],
  ['rayon',    ['rayon', 'viscose', 'cupro', 'tencel', 'レーヨン', 'キュプラ']],
];


/**
 * The model code, where the seller gave one.
 *
 * This is the finest identity signal available, and for some houses the only
 * one that matters: Guidi's 788Z is a derby and its PL1 is a boot, and M.A+
 * names bags by code. Two pieces from one house in one material are not comps
 * for each other if they are different models — which is exactly the complaint
 * that produced this function, an accordion bag priced against every other bag
 * the house makes.
 *
 * Recognised as a token mixing letters and digits, because that is what a
 * model code looks like and almost nothing else in a listing title does. The
 * exclusions matter more than the pattern:
 *
 *   AD years    already part of identity, and would double-count
 *   seasons     "02AW", "AW03", "SS19" — the era, not the piece
 *   sizes       "S2", "M1", "EU48" — a size is not a model
 *   measurements "40cm", "3XL"
 *   years       a bare 1998 or 2002 is a season, not a model
 *
 * The season exclusion is the one that cost the most, and it was missing.
 * "02AW" and "AW03" mix letters and digits exactly like a model code does, so
 * every title written the way Japanese shops and Grailed sellers actually
 * write them acquired a model nobody printed on the garment — and a model is
 * the finest segment of the identity key, so those listings pooled with
 * nothing at all. The README's own worked example failed on it: of the three
 * wordings of one CDG jacket, the Japanese one keyed as model "02AW" and sat
 * alone. Seasons belong in the YEAR segment, which parseSeason now puts them
 * in, and a segment cannot be in two places at once.
 *
 * Returns null rather than guessing. A missing model is handled by pooling one
 * level coarser and saying so, which is far better than inventing a
 * distinction between two listings of the same bag.
 */
// Only the letters that actually denote sizes. "M1" and "S2" are sizes; "B7"
// and "P3" are M.A+ model codes, and excluding every letter-plus-digit token
// threw the models away with them.
const SIZE_LIKE = /^(?:[xsml]{1,4}\d?|\d{1,2}[a-z]?|[xsml]\d{1,2})$/i;
// A size quoted with the sizing system it belongs to. "EU48" is the same size
// as "48", and letting the prefixed form become a model split one garment into
// one item per country its sellers happened to size it in.
const REGION_SIZE = /^(?:eu|uk|us|it|fr|jp|de|jpn?)\d{1,3}$/i;
const MEASURE = /^\d+(?:cm|mm|in|inch|kg|g)$/i;
// Season codes, in every shape a listing writes them: SS19, AW03, FW2018,
// 02AW, 2002AW, and the pre-collection prefixes.
const SEASON_LIKE = /^(?:(?:ss|aw|fw|pf|pre|cr|resort)\d{2,4}|\d{2,4}(?:ss|aw|fw))$/i;

export function modelCode(title) {
  const raw = String(title ?? '');
  const tokens = raw.split(/[\s,/()[\]]+/).filter(Boolean);

  for (const token of tokens) {
    const t = token.replace(/^[#.\-]+|[.,;:]+$/g, '');
    if (t.length < 2 || t.length > 10) continue;
    if (!/[a-z]/i.test(t) || !/\d/.test(t)) continue;      // must mix both
    if (/^ad\d{2,4}$/i.test(t)) continue;                   // an AD year
    if (/^(?:19|20)\d{2}[a-z]{0,2}$/i.test(t)) continue;    // a year or season
    if (SEASON_LIKE.test(t)) continue;                      // a season, not a model
    if (MEASURE.test(t)) continue;
    if (SIZE_LIKE.test(t)) continue;
    if (REGION_SIZE.test(t)) continue;
    return t.toUpperCase();
  }
  return null;
}

/** First vocabulary entry whose term appears in the compact form. */
function firstHit(vocab, compact) {
  for (const [label, terms] of vocab) {
    for (const term of terms) {
      if (compact.includes(term)) return { label, term };
    }
  }
  return null;
}

/**
 * Identify the garment behind a title.
 *
 * @param {string} title
 * @returns {{ type: string|null, material: string|null, matchedType: string|null,
 *             matchedMaterial: string|null, identified: boolean }}
 *
 * `identified` is false when no garment type is recognised. That listing must
 * not be pooled with anything — an unrecognised type means the title said
 * something this vocabulary has never seen, and pooling on the remainder
 * (sub-line and year alone) would merge a coat with a pair of trousers.
 */
export function describeGarment(title) {
  const { compact } = normalizeAlias(String(title ?? ''));
  const type = firstHit(TYPES, compact);
  const material = firstHit(MATERIALS, compact);

  return {
    type: type?.label ?? null,
    material: material?.label ?? null,
    model: modelCode(title),
    matchedType: type?.term ?? null,
    matchedMaterial: material?.term ?? null,
    identified: Boolean(type),
  };
}

/**
 * The identity of a garment, independent of who is selling it or how they
 * worded the title.
 *
 * An unstated material is its own bucket ("?") rather than a wildcard. A wool
 * coat and a coat of unstated fibre are not known to be the same coat, and
 * treating them as the same would let an unlabelled cotton piece drag down the
 * median for a wool one.
 */
export function garmentKey({ sublineId, adYear, type, material, model }) {
  return [
    sublineId ?? '?',
    adYear == null ? 'ad?' : `ad${adYear}`,
    type ?? '?',
    material ?? '?',
    // Last on purpose. An unknown segment means "pool one level coarser", and
    // model is the segment most often absent, so it must be the one that falls
    // away first.
    model ?? '?',
  ].join('|');
}

/**
 * A readable name for an item, generated rather than borrowed from one
 * seller's title.
 *
 * Using the first-seen title as the item's name means the item is named after
 * whichever listing happened to arrive first, and reads as though that listing
 * IS the item. A generated name says exactly what the item is defined as —
 * which is precisely the four fields that decide pooling, and nothing else.
 */
export function garmentName({ sublineName, adYear, adYearStatus, type, material, model }) {
  const era =
    adYear != null ? `AD${adYear}` : adYearStatus === 'pre_ad_era' ? 'pre-AD' : null;
  // A sub-line named for what it makes already says the type: "Guidi boots"
  // plus type "boots" reads as a stutter, not as precision.
  const name = String(sublineName ?? '');
  const redundant = type && new RegExp(`\\b${type}\\b`, 'i').test(name);
  return [name, era, model, material, redundant ? null : type].filter(Boolean).join(' ');
}
