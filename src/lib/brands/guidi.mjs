// Guidi.
//
// A tannery before it was a label, and the identifiers that matter are the
// model code and the leather, not a line. PL1 and 788Z in horse are different
// markets; the same code in calf is a third. Codes are the aliases.
//
// "Guidi" is also a common Italian surname, so the house alias is kept
// unambiguous by pairing it with a model wherever a listing does.

export const brand = { id: 'guidi', display_name: 'Guidi' };

export const sublines = [
  { id: 'guidi-boots', display_name: 'Guidi boots' },
  { id: 'guidi-derbies', display_name: 'Guidi derbies & shoes' },
  { id: 'guidi-bags', display_name: 'Guidi bags & accessories' },
  { id: 'guidi-other', display_name: 'Guidi (unspecified)', mainline: true },
];

export const aliases = [
  { alias: 'Guidi', sub: 'guidi-other' },
  { alias: 'Guidi Rosellini', sub: 'guidi-other' },
  { alias: 'グイディ', sub: 'guidi-other' },

  // Boot models.
  { alias: 'PL1', sub: 'guidi-boots' },
  { alias: 'PL2', sub: 'guidi-boots' },
  { alias: 'PL0', sub: 'guidi-boots' },
  { alias: '788Z', sub: 'guidi-boots' },
  { alias: '788ZX', sub: 'guidi-boots' },
  { alias: '5305V', sub: 'guidi-boots' },
  { alias: '996', sub: 'guidi-boots' },
  { alias: '210', sub: 'guidi-boots' },

  // Derbies and low shoes.
  { alias: '992X', sub: 'guidi-derbies' },
  { alias: '992', sub: 'guidi-derbies' },
  { alias: '6006', sub: 'guidi-derbies' },
  { alias: '109', sub: 'guidi-derbies' },

  { alias: 'Guidi bag', sub: 'guidi-bags' },
];
