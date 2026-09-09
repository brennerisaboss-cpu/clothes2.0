// The Japanese roster.
//
// Katakana aliases matter more here than anywhere: these labels are sold
// domestically under their Japanese names, and a Latin-only matcher would miss
// most of the listings that make the Japan route worth running at all.

import { expand } from './_simple.mjs';

const { brands, sublines, aliases } = expand([
  {
    id: 'devoa',
    name: 'DEVOA',
    aliases: ['Devoa'],
    ja: ['デヴォア', 'デボア'],
  },
  {
    id: 'julius',
    name: 'JULIUS',
    aliases: ['Julius_7', 'JULIUS_7', 'Julius 7'],
    ja: ['ユリウス'],
    extraSublines: [
      {
        id: 'julius-nilos',
        name: 'NILoS',
        aliases: ['Nilos'],
        note: 'Sister line to JULIUS. Distinct market.',
      },
    ],
  },
  { id: 'viridi-anne', name: 'The Viridi-anne', aliases: ['Viridi-anne', 'Viridianne'], ja: ['ヴィリジアン'] },
  {
    id: 'attachment',
    name: 'ATTACHMENT',
    aliases: ['Attachment Kazuyuki Kumagai'],
    ja: ['アタッチメント'],
    ambiguous: true,
    note: 'A common English word — confirm by hand rather than trusting a title match.',
  },
  { id: 'kiryuyrik', name: 'KIRYUYRIK', aliases: ['Kiryuyrik'], ja: ['キリュウキリュウ'] },
  { id: 'taichi', name: 'Taichi Murakami', aliases: ['Murakami Taichi'], ja: ['タイチムラカミ'] },
  { id: 'sulvam', name: 'sulvam', aliases: ['Sulvam Teppei Fujita'], ja: ['サルバム'] },
  {
    id: 'undercover',
    name: 'UNDERCOVER',
    aliases: ['Under Cover', 'Jun Takahashi'],
    ja: ['アンダーカバー'],
    extraSublines: [
      { id: 'undercover-undercoverism', name: 'UNDERCOVERISM', aliases: ['Undercoverism'] },
      { id: 'undercover-johnundercover', name: 'John UNDERCOVER', aliases: ['JohnUNDERCOVER'] },
    ],
  },
  {
    id: 'numbernine',
    name: 'Number (N)ine',
    aliases: ['Number Nine', 'NumberNine', 'N(N)', 'Takahiro Miyashita'],
    ja: ['ナンバーナイン'],
    note: 'Miyashita-era archive is the market; the 2018 revival is separate.',
    extraSublines: [
      { id: 'nn-soloist', name: 'TheSoloist.', aliases: ['The Soloist', 'Soloist'], note: "Miyashita's later line." },
    ],
  },
  { id: 'kapital', name: 'KAPITAL', aliases: ['Kapital Kountry', 'Kountry'], ja: ['キャピタル'] },
  { id: 'visvim', name: 'visvim', aliases: ['Visvim', 'Hiroki Nakamura'], ja: ['ヴィズヴィム', 'ビズビム'] },
  {
    id: 'sacai',
    name: 'sacai',
    aliases: ['Sacai', 'Chitose Abe'],
    ja: ['サカイ'],
  },
  { id: 'nhoolywood', name: 'N.Hoolywood', aliases: ['N Hoolywood', 'Daisuke Obana'], ja: ['エヌハリウッド'] },
  { id: 'ffixxed', name: 'Ffixxed Studios', aliases: ['Ffixxed'] },
  { id: 'yuki-hashimoto', name: 'Yuki Hashimoto', aliases: ['YUKI HASHIMOTO'] },
]);

export { brands, sublines, aliases };
