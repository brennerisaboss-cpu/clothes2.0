import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BRANDS, SUBLINES, ALIASES, registryProblems, sublineById } from '../src/lib/brands/index.mjs';
import { resolveBrand } from '../src/lib/resolve.mjs';
import { normalizeAlias } from '../src/lib/normalize.mjs';

test('the registry has no dangling references or duplicate ids', () => {
  assert.deepEqual(registryProblems(), []);
});

test('every sub-line belongs to a brand on the roster', () => {
  const ids = new Set(BRANDS.map((b) => b.id));
  for (const s of SUBLINES) assert.ok(ids.has(s.brand_id), `${s.id} -> ${s.brand_id}`);
});

test('every brand has at least one sub-line, so nothing resolves into a null bucket', () => {
  for (const b of BRANDS) {
    assert.ok(SUBLINES.some((s) => s.brand_id === b.id), `${b.id} has no sub-line`);
  }
});

test('every alias resolves to something', () => {
  for (const a of ALIASES) {
    if (a.sub) assert.ok(sublineById(a.sub), `${a.alias} -> ${a.sub}`);
  }
});

test('aliases that normalise identically point at the same place', () => {
  // Two different sub-lines sharing a normalised alias would make matching
  // order-dependent, which is exactly the ambiguity this table exists to remove.
  const byNorm = new Map();
  for (const a of ALIASES) {
    const { compact, script } = normalizeAlias(a.alias);
    const key = `${script}:${compact}`;
    const prior = byNorm.get(key);
    if (prior && prior.sub !== a.sub) {
      assert.fail(`"${prior.alias}" and "${a.alias}" both normalise to ${key} but resolve differently`);
    }
    byNorm.set(key, a);
  }
});

// --- the roster resolves ------------------------------------------------------

const CASES = [
  ['Ann Demeulemeester leather jacket', 'ann', 'ann-mainline'],
  ['Yohji Yamamoto Pour Homme wool gabardine coat', 'yohji', 'yy-pour-homme'],
  ['Carol Christian Poell scarstitch derby', 'ccp', 'ccp-footwear'],
  ['Guidi PL1 horse leather boot', 'guidi', 'guidi-boots'],
  ['John Alexander Skelton hand dyed smock', 'skelton', 'skelton-mainline'],
  ['Paul Harnden Shoemakers wool coat', 'harnden', 'harnden-mainline'],
  ['Haider Ackermann silk bomber', 'haider', 'haider-mainline'],
  ['DEVOA calf leather jacket', 'devoa', 'devoa-mainline'],
  ['Uma Wang linen trousers', 'umawang', 'umawang-mainline'],
  ['Ziggy Chen cotton shirt', 'ziggychen', 'ziggychen-mainline'],
  ['Boris Bidjan Saberi object dyed hoodie', 'bbs', 'bbs-mainline'],
  ['Greg Lauren deconstructed army jacket', 'greglauren', 'greglauren-mainline'],
  ['Rick Owens DRKSHDW drop crotch denim', 'rick', 'ro-drkshdw'],
  ['Label Under Construction knit', 'luc', 'luc-mainline'],
  ['m.a+ leather jacket', 'maplus', 'maplus-mainline'],
  ['The Viridi-anne cotton parka', 'viridi-anne', 'viridi-anne-mainline'],
  ['JULIUS knit tank', 'julius', 'julius-mainline'],
  ['Werkstatt:München silver ring', 'werkstatt', 'werkstatt-mainline'],
  ['Geoffrey B. Small hand made coat', 'gbs', 'gbs-mainline'],
  ['Aleksandr Manamis wide trousers', 'manamis', 'manamis-mainline'],
];

for (const [title, brandId, sublineId] of CASES) {
  test(`resolves: ${title}`, () => {
    const r = resolveBrand(title);
    assert.equal(r.brandId, brandId, `brand for "${title}"`);
    assert.equal(r.sublineId, sublineId, `sub-line for "${title}"`);
  });
}

// --- diffusion traps ----------------------------------------------------------

test('11 by BBS is never pooled with the Boris mainline', () => {
  assert.equal(resolveBrand('11 by Boris Bidjan Saberi hoodie').sublineId, 'bbs-11');
  assert.equal(resolveBrand('Boris Bidjan Saberi hoodie').sublineId, 'bbs-mainline');
});

test('a bare "11" never resolves — it would match any size or year', () => {
  const r = resolveBrand('wool coat size 11');
  assert.notEqual(r.sublineId, 'bbs-11');
});

test("Y's is distinguished from Y's for men and from the mainline", () => {
  assert.equal(resolveBrand("Y's for men wool jacket").sublineId, 'yy-ys-for-men');
  assert.equal(resolveBrand("Y's cotton blouse").sublineId, 'yy-ys');
  assert.equal(resolveBrand('Yohji Yamamoto Pour Homme coat').sublineId, 'yy-pour-homme');
});

test('Y-3 resolves but is excluded from monitoring, like CDG Play', () => {
  const r = resolveBrand('Y-3 track jacket');
  assert.equal(r.sublineId, 'yy-y3');
  assert.equal(r.monitored, false);
});

test('HOMME PLISSE is not the Issey archive', () => {
  assert.equal(resolveBrand('HOMME PLISSE ISSEY MIYAKE trousers').sublineId, 'im-homme-plisse');
  assert.equal(resolveBrand('Miyake Design Studio 1980s coat').sublineId, 'im-mds');
});

test('a bare house name stays ambiguous where the house has many lines', () => {
  for (const title of ['Yohji Yamamoto coat', 'Issey Miyake top', 'Comme des Garcons jacket']) {
    const r = resolveBrand(title);
    assert.equal(r.ambiguous, true, `"${title}" should need manual resolution`);
    assert.equal(r.sublineId, null);
  }
});

// --- Japanese listings --------------------------------------------------------

const JA = [
  ['ヨウジヤマモトプールオム ウール コート', 'yohji', 'yy-pour-homme'],
  ['アンドゥムルメステール レザー ジャケット', 'ann', 'ann-mainline'],
  ['リックオウエンス ダークシャドウ デニム', 'rick', 'ro-drkshdw'],
  ['デヴォア レザー ジャケット', 'devoa', 'devoa-mainline'],
  ['ボリスビジャンサベリ パーカー', 'bbs', 'bbs-mainline'],
  ['ヴィズヴィム ブーツ', 'visvim', 'visvim-mainline'],
  ['サカイ ブルゾン', 'sacai', 'sacai-mainline'],
  ['グイディ ブーツ', 'guidi', 'guidi-other'],
];

for (const [title, brandId, sublineId] of JA) {
  test(`resolves Japanese: ${title}`, () => {
    const r = resolveBrand(title);
    assert.equal(r.brandId, brandId);
    assert.equal(r.sublineId, sublineId);
  });
}

test('a common English word brand is flagged rather than auto-matched', () => {
  // "Attachment" and "hannibal." are ordinary words; matching them from a title
  // alone would produce constant false positives.
  const r = resolveBrand('ATTACHMENT wool coat');
  assert.equal(r.ambiguous, true);
  assert.equal(r.confident, false);
});
