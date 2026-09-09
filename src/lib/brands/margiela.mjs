// Maison Margiela.
//
// Unavoidable in archive resale and structured enough to need its own file:
// the house numbers its lines, and the numbers are markets rather than
// labels. An Artisanal piece and an MM6 piece are three orders of magnitude
// apart, and pooling them would be the same failure as pricing a Homme Plus
// coat against mainline CDG.
//
// TWO ERAS, ONE NAME, AND THE YEAR IS WHAT SEPARATES THEM.
//
// "Maison Martin Margiela" ran to 2015; "Maison Margiela" is the name since.
// Martin Margiela himself left in 2009, and the archive value sits almost
// entirely before that — a 1997 Artisanal piece and a 2022 one share a line, a
// name and nothing else. The tempting fix is a sub-line per era, and it is
// wrong: sellers use the two names interchangeably for the same garment, so
// splitting on the name would split one piece's comps in half on a wording
// nobody is careful about. The era is already a segment of the identity key,
// and season codes now populate it, so it separates them where a title states
// a year and pools them coarsely where none does. That is the honest answer to
// a fact the title may simply not carry.
//
// The line structure follows Rick Owens rather than Yohji: there is a real
// mainline and the diffusion lines are named in titles when they apply, so the
// house name resolves rather than going to /unresolved. The alternative —
// treating every "Maison Margiela wool coat" as unresolvable because the line
// number is on the tag and not in the title — would send most of the house's
// listings to be settled by hand, which is a lot of work to avoid a risk the
// roster already accepts everywhere else.

export const brand = { id: 'margiela', display_name: 'Maison Margiela' };

export const sublines = [
  {
    id: 'mm-mainline',
    display_name: 'Maison Margiela',
    mainline: true,
    note: 'Lines 10 (men) and 14 (men’s wardrobe) unless the title says otherwise. The Martin era, to 2009, is where the archive value is — the year segment separates it.',
  },
  {
    id: 'mm-artisanal',
    display_name: 'Maison Margiela Artisanal',
    note: 'Line 0 / 0 10. Hand-made, one-off, couture-priced. Never a comp for anything else the house makes.',
  },
  {
    id: 'mm-line-1',
    display_name: 'Maison Margiela Line 1',
    note: 'Womenswear collection line.',
  },
  {
    id: 'mm-line-6',
    display_name: 'MM6 Maison Margiela',
    note: 'Diffusion. Real resale market, an order of magnitude below the mainline — separate, not excluded.',
  },
  {
    id: 'mm-line-11',
    display_name: 'Maison Margiela Line 11',
    note: 'Accessories.',
  },
  {
    id: 'mm-footwear',
    display_name: 'Maison Margiela footwear',
    note: 'Line 22. Split from garments for the same reason Guidi is: within one house, shoe models differ far more in price than a jacket differs from a jacket.',
  },
];

export const aliases = [
  // The house name resolves to the mainline, both spellings and both eras.
  { alias: 'Maison Margiela', sub: 'mm-mainline' },
  { alias: 'Maison Martin Margiela', sub: 'mm-mainline' },
  { alias: 'Margiela', sub: 'mm-mainline' },
  { alias: 'MMM', sub: 'mm-mainline' },
  { alias: 'メゾンマルジェラ', sub: 'mm-mainline' },
  { alias: 'マルタンマルジェラ', sub: 'mm-mainline' },
  { alias: 'マルジェラ', sub: 'mm-mainline' },

  { alias: 'Margiela Artisanal', sub: 'mm-artisanal' },
  { alias: 'Artisanal Line', sub: 'mm-artisanal' },
  { alias: 'アーティザナル', sub: 'mm-artisanal' },

  { alias: 'MM6', sub: 'mm-line-6' },
  { alias: 'MM6 Maison Margiela', sub: 'mm-line-6' },
  { alias: 'Margiela 6', sub: 'mm-line-6' },
  { alias: 'エムエムシックス', sub: 'mm-line-6' },

  { alias: 'Margiela 1', sub: 'mm-line-1' },
  { alias: 'Margiela Line 1', sub: 'mm-line-1' },
  { alias: 'Margiela 11', sub: 'mm-line-11' },
  { alias: 'Margiela Line 11', sub: 'mm-line-11' },

  // Footwear models sellers actually name. The Tabi is the house's signature
  // and is priced as its own thing.
  { alias: 'Margiela 22', sub: 'mm-footwear' },
  { alias: 'Tabi', sub: 'mm-footwear' },
  { alias: 'German Army Trainer', sub: 'mm-footwear' },
  { alias: 'Replica Sneaker', sub: 'mm-footwear' },
  { alias: '足袋', sub: 'mm-footwear' },
];
