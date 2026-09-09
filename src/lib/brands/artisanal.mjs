// The artisanal / avant-garde roster — European and other.
//
// Small houses, mostly one designer and one line. What varies is spelling, so
// the aliases are the substance here.

import { expand } from './_simple.mjs';

const { brands, sublines, aliases } = expand([
  {
    id: 'skelton',
    name: 'John Alexander Skelton',
    aliases: ['JA Skelton', 'J.A. Skelton', 'Skelton'],
    note: 'Small runs, hand-dyed. Collection numbers rather than seasons.',
  },
  {
    id: 'harnden',
    name: 'Paul Harnden',
    aliases: ['Paul Harnden Shoemakers', 'Harnden', 'PHS'],
    ja: ['ポールハーデン'],
    note: 'No labels on much of the output; identification is by construction.',
  },
  {
    id: 'haider',
    name: 'Haider Ackermann',
    aliases: ['Haider Ackerman', 'Ackermann'],
    ja: ['ハイダーアッカーマン'],
  },
  { id: 'umawang', name: 'Uma Wang', ja: ['ウマワン'] },
  { id: 'ziggychen', name: 'Ziggy Chen', ja: ['ジギーチェン'] },
  {
    id: 'maplus',
    name: 'm.a+',
    aliases: ['ma+', 'M.A+', 'Maurizio Amadei', 'm a plus'],
    ja: ['エムエークロス'],
  },
  {
    id: 'luc',
    name: 'Label Under Construction',
    aliases: ['LUC', 'Label Under Constructions'],
  },
  {
    id: 'individual-sentiments',
    name: 'Individual Sentiments',
    aliases: ['Individual Sentiment', 'IS'],
    // "IS" is far too common a word to match on; kept out of the alias list
    // deliberately and the full name required.
  },
  {
    id: 'werkstatt',
    name: 'Werkstatt:München',
    aliases: ['Werkstatt Munchen', 'Werkstatt München', 'Werkstatt'],
  },
  { id: 'gbs', name: 'Geoffrey B. Small', aliases: ['Geoffrey B Small', 'GBS'] },
  { id: 'manamis', name: 'Aleksandr Manamis', aliases: ['Alexandr Manamis', 'Manamis'] },
  { id: 'forme', name: "forme d'expression", aliases: ['forme dexpression', 'forme d expression'] },
  { id: 'sellam', name: 'Isaac Sellam', aliases: ['Isaac Sellam Experience', 'Sellam'] },
  { id: 'layer0', name: 'Layer-0', aliases: ['Layer 0', 'LayerZero'] },
  { id: 'masnada', name: 'Masnada', aliases: ['Daniela Gregis Masnada'] },
  { id: 'nostrasantissima', name: 'Nostrasantissima', aliases: ['Nostra Santissima'] },
  { id: 'poeme', name: 'Poème Bohémien', aliases: ['Poeme Bohemien'] },
  { id: 'janjan', name: 'Jan-Jan Van Essche', aliases: ['Jan Jan Van Essche', 'Van Essche'] },
  { id: 'caseycasey', name: 'Casey Casey', aliases: ['Casey-Casey'] },
  { id: 'sftm', name: 'Song for the Mute', aliases: ['Song For The Mute', 'SFTM'] },
  {
    id: 'hannibal',
    name: 'hannibal.',
    aliases: ['hannibal', 'Hannibal Berlin'],
    ambiguous: true,
    note: 'A common given name; confirm by hand rather than trusting a title match.',
  },
  { id: 'boris-lab', name: 'Boris Saberi Object', aliases: ['BBS Object'], note: 'Objects and leather goods.' },
  {
    id: 'greglauren',
    name: 'Greg Lauren',
    aliases: ['GregLauren'],
    ja: ['グレッグローレン'],
    note: 'Deconstructed military and workwear; one-of-one pieces are common, which makes comps thin.',
  },
  { id: 'taiga', name: 'Taiga Takahashi', aliases: ['Taiga'] },
  { id: 'ziggy-kollar', name: 'Kollar', aliases: ['Kollar Clothing'], ambiguous: true },

  // Two houses whose archive is unavoidable on these venues and which the
  // roster simply did not carry, so every listing of either resolved to
  // nothing and went to /unresolved for ever.
  {
    id: 'raf',
    name: 'Raf Simons',
    aliases: ['RafSimons', 'Raf Simons Archive'],
    ja: ['ラフシモンズ'],
    note: 'The mainline archive, roughly 1995–2005, is what carries value. His work at other houses is those houses, not this one, and is not modelled here.',
    extraSublines: [
      {
        id: 'raf-adidas',
        name: 'Raf Simons x adidas',
        aliases: ['Raf Simons adidas', 'Raf Adidas', 'Ozweego'],
        monitored: false,
        note: 'Sneaker collaboration — high volume, low archive value. Excluded by default, like Y-3 and Rick Owens x adidas.',
      },
    ],
  },
  {
    id: 'helmut',
    name: 'Helmut Lang',
    aliases: ['HelmutLang'],
    ja: ['ヘルムートラング'],
    // Deliberately one line rather than an archive/modern split.
    //
    // The house has two eras that share a name and almost nothing else: Lang
    // himself left in 2005, and the value sits overwhelmingly before that. The
    // tempting fix is a sub-line per era, and it cannot work from a title —
    // "Helmut Lang" is what a seller writes for both, so the split would land
    // on whether someone happened to type "archive" rather than on when the
    // piece was made. The era is a segment of the identity key and season codes
    // now populate it, so a title stating a year separates the two properly and
    // one stating none pools coarsely. That is the fact the title carries,
    // reported as it is.
    note: 'Two eras under one name; the pre-2005 archive is where the value is. The year segment separates them where a title states one.',
  },
]);

export { brands, sublines, aliases };
