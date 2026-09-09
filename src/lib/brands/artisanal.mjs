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
]);

export { brands, sublines, aliases };
