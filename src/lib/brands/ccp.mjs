// Carol Christian Poell.
//
// The brief named this one directly: "CCP" = Carol Christian Poell,
// "Scarstitch" = "Scar Stitch" = "SS Derby". Model names carry more meaning
// here than lines do — a piece is identified by its construction, and the
// naming in listings is inconsistent enough that the aliases are the point.
//
// Model aliases resolve to the mainline sub-line and leave the specific model
// to the item's canonical name, which is where your own eye does the work.

export const brand = { id: 'ccp', display_name: 'Carol Christian Poell' };

export const sublines = [
  { id: 'ccp-mainline', display_name: 'Carol Christian Poell', mainline: true },
  { id: 'ccp-footwear', display_name: 'Carol Christian Poell footwear' },
];

export const aliases = [
  { alias: 'Carol Christian Poell', sub: 'ccp-mainline' },
  { alias: 'Christian Poell', sub: 'ccp-mainline' },
  { alias: 'CCP', sub: 'ccp-mainline' },
  { alias: 'C.C.P.', sub: 'ccp-mainline' },
  { alias: 'カルロクリスチャンポエル', sub: 'ccp-mainline' },
  { alias: 'キャロルクリスチャンポエル', sub: 'ccp-mainline' },

  // Footwear models, which is where most of the naming variance lives.
  { alias: 'Scarstitch', sub: 'ccp-footwear' },
  { alias: 'Scar Stitch', sub: 'ccp-footwear' },
  { alias: 'SS Derby', sub: 'ccp-footwear' },
  { alias: 'Drkshdw Scarstitch', sub: 'ccp-footwear' },
  { alias: 'Object Dyed', sub: 'ccp-mainline' },
  { alias: 'Goodyear', sub: 'ccp-footwear' },
  { alias: 'Dauer', sub: 'ccp-footwear' },
  { alias: 'Diagonal Zip', sub: 'ccp-mainline' },
  { alias: 'Overlock', sub: 'ccp-mainline' },
];
