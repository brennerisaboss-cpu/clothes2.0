// Ann Demeulemeester.
//
// No diffusion lines, but the ERA is the value driver in the same way an AD
// year is for CDG. Ann designed until 2013; everything after is a different
// hand under the same name, and the archive market prices them very
// differently.
//
//   1985–2013  Ann herself — the archive that carries value
//   2013–2020  Sébastien Meunier
//   2020–2022  in-house studio (Antonioli ownership)
//   2023       Ludovic de Saint Sernin, one season
//   2023–      Stefano Gallici
//
// Era is not a sub-line — the tag does not say it — so it is modelled as
// aliases that sellers actually write, and left to your judgement otherwise.

export const brand = { id: 'ann', display_name: 'Ann Demeulemeester' };

export const sublines = [
  { id: 'ann-mainline', display_name: 'Ann Demeulemeester', mainline: true },
  {
    id: 'ann-era-ann',
    display_name: 'Ann Demeulemeester (Ann era, pre-2013)',
    note: 'Only resolves when a seller says so explicitly. The archive market.',
  },
  {
    id: 'ann-era-meunier',
    display_name: 'Ann Demeulemeester (Meunier era)',
    note: '2013–2020. A different hand under the same name.',
  },
  { id: 'ann-shoes', display_name: 'Ann Demeulemeester footwear' },
];

export const aliases = [
  { alias: 'Ann Demeulemeester', sub: 'ann-mainline' },
  { alias: 'Ann Demeulemester', sub: 'ann-mainline' },   // common misspelling
  { alias: 'Ann Demeleumeester', sub: 'ann-mainline' },  // and another
  { alias: 'Demeulemeester', sub: 'ann-mainline' },
  { alias: 'アンドゥムルメステール', sub: 'ann-mainline' },
  { alias: 'アンドゥムルメスター', sub: 'ann-mainline' },
  // "Ann" alone is far too common a word to match on.
  { alias: 'Ann Demeulemeester Ann era', sub: 'ann-era-ann' },
  { alias: 'Ann era', sub: 'ann-era-ann' },
  { alias: 'Meunier era', sub: 'ann-era-meunier' },
];
