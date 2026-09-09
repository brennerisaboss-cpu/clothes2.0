// Boris Bidjan Saberi.
//
// The same trap as CDG Play: "11 by BBS" is the diffusion line and trades at a
// fraction of the mainline. Pooling them would flatter every mainline comp.
//
// "11" alone is deliberately NOT an alias — it would match any listing with a
// size, a year or a measurement in it. Only the full forms resolve.

export const brand = { id: 'bbs', display_name: 'Boris Bidjan Saberi' };

export const sublines = [
  { id: 'bbs-mainline', display_name: 'Boris Bidjan Saberi', mainline: true },
  {
    id: 'bbs-11',
    display_name: '11 by Boris Bidjan Saberi',
    note: 'Diffusion line. Trades well below the mainline — never pool the two.',
  },
  { id: 'bbs-footwear', display_name: 'Boris Bidjan Saberi footwear' },
];

export const aliases = [
  { alias: 'Boris Bidjan Saberi', sub: 'bbs-mainline' },
  { alias: 'Boris Bidjan', sub: 'bbs-mainline' },
  { alias: 'BBS', sub: 'bbs-mainline' },
  { alias: 'ボリスビジャンサベリ', sub: 'bbs-mainline' },

  { alias: '11 by Boris Bidjan Saberi', sub: 'bbs-11' },
  { alias: '11 by BBS', sub: 'bbs-11' },
  { alias: '11byBBS', sub: 'bbs-11' },
  { alias: 'Eleven by Boris Bidjan Saberi', sub: 'bbs-11' },

  { alias: 'Bamba', sub: 'bbs-footwear' },
  { alias: 'Salomon Bamba', sub: 'bbs-footwear' },
];
