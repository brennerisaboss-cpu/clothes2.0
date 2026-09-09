// Rick Owens.
//
// Included because it is unavoidable in this space, with the same diffusion
// problem: DRKSHDW is a different market from the mainline, and the adidas
// collaborations are a third.
//
// Season names ("Cyclops", "Sphinx", "Larry") are how collectors actually
// identify pieces, so they resolve to the mainline and leave the season to the
// item name.

export const brand = { id: 'rick', display_name: 'Rick Owens' };

export const sublines = [
  { id: 'ro-mainline', display_name: 'Rick Owens', mainline: true },
  {
    id: 'ro-drkshdw',
    display_name: 'Rick Owens DRKSHDW',
    note: 'Denim-led diffusion. Distinct market from the mainline.',
  },
  { id: 'ro-footwear', display_name: 'Rick Owens footwear' },
  {
    id: 'ro-adidas',
    display_name: 'Rick Owens x adidas',
    monitored: false,
    note: 'Sneaker collaboration — high volume, low archive value. Excluded by default.',
  },
  { id: 'ro-lilies', display_name: 'Rick Owens Lilies' },
];

export const aliases = [
  { alias: 'Rick Owens', sub: 'ro-mainline' },
  { alias: 'RickOwens', sub: 'ro-mainline' },
  { alias: 'リックオウエンス', sub: 'ro-mainline' },
  { alias: 'リックオーエンス', sub: 'ro-mainline' },

  { alias: 'DRKSHDW', sub: 'ro-drkshdw' },
  { alias: 'Dark Shadow', sub: 'ro-drkshdw' },
  { alias: 'ダークシャドウ', sub: 'ro-drkshdw' },
  { alias: 'Rick Owens Lilies', sub: 'ro-lilies' },
  { alias: 'Rick Owens adidas', sub: 'ro-adidas' },

  // Footwear models.
  { alias: 'Geobasket', sub: 'ro-footwear' },
  { alias: 'Ramones', sub: 'ro-footwear' },
  { alias: 'Megatooth', sub: 'ro-footwear' },
  { alias: 'Bauhaus', sub: 'ro-footwear' },
];
