// Comme des Garçons vocabulary.
//
// The sub-line is the single biggest driver of value in this house, so it is
// modelled explicitly and comps are never pooled across sub-lines. Where a name
// is genuinely ambiguous in listing titles it is marked `ambiguous` and must be
// resolved by hand rather than auto-matched.
//
// Treat this as a skeleton to correct, not a finished taxonomy.

export const brand = { id: 'cdg', display_name: 'Comme des Garçons' };

export const sublines = [
  { id: 'cdg-mainline', display_name: 'Comme des Garçons', monitored: true, mainline: true },
  { id: 'cdg-homme', display_name: 'Comme des Garçons Homme', monitored: true },
  { id: 'cdg-homme-plus', display_name: 'Comme des Garçons Homme Plus', monitored: true },
  { id: 'cdg-homme-deux', display_name: 'Comme des Garçons Homme Deux', monitored: true },
  {
    id: 'cdg-homme-plus-sport',
    display_name: 'Comme des Garçons Homme Plus Sport',
    monitored: true,
    note: 'Sub-variant of Homme Plus; kept separate because valuation differs.',
  },
  {
    id: 'cdg-homme-plus-evergreen',
    display_name: 'Comme des Garçons Homme Plus Evergreen',
    monitored: true,
  },
  { id: 'cdg-shirt', display_name: 'Comme des Garçons Shirt', monitored: true },
  { id: 'cdg-shirt-boy', display_name: 'Comme des Garçons Shirt Boy', monitored: true },
  { id: 'cdg-shirt-girl', display_name: 'Comme des Garçons Shirt Girl', monitored: true },
  {
    id: 'cdg-black',
    display_name: 'Black Comme des Garçons',
    monitored: true,
    note: 'Routinely conflated with CDG Noir. Distinct line, distinct market.',
  },
  {
    id: 'cdg-noir',
    display_name: 'Comme des Garçons Noir',
    monitored: true,
    note: 'Not BLACK CDG. Added in phase 0 review; confirm you want it tracked.',
  },
  { id: 'cdg-tricot', display_name: 'Tricot Comme des Garçons', monitored: true },
  {
    id: 'cdg-robe-de-chambre',
    display_name: 'Robe de Chambre Comme des Garçons',
    monitored: true,
  },
  { id: 'cdg-girl', display_name: 'Comme des Garçons Girl', monitored: true },
  { id: 'noir-kei-ninomiya', display_name: 'Noir Kei Ninomiya', monitored: true },
  { id: 'junya-watanabe', display_name: 'Junya Watanabe', monitored: true },
  { id: 'junya-watanabe-man', display_name: 'Junya Watanabe MAN', monitored: true },
  {
    id: 'tao',
    display_name: 'Tao',
    monitored: true,
    note: 'Discontinued line; archive-only supply, so expect thin comp counts.',
  },
  {
    id: 'ganryu',
    display_name: 'Ganryu',
    monitored: true,
    note: 'Discontinued line; archive-only supply, so expect thin comp counts.',
  },
  {
    id: 'cdg-comme-comme',
    display_name: 'Comme des Garçons Comme des Garçons',
    monitored: true,
    ambiguous: true,
    note: 'Tagged CDG CDG, called "Comme Comme". Contains the mainline name twice, so substring matching against mainline is unsafe. Awaiting your confirmation.',
  },
  {
    id: 'cdg-diffusion',
    display_name: 'CDG (diffusion line)',
    monitored: true,
    ambiguous: true,
    note: '"CDG" is both this line and the common abbreviation for the whole house. Never auto-match; always resolve by hand.',
  },
  {
    id: 'cdg-play',
    display_name: 'Comme des Garçons Play',
    monitored: false,
    note: 'Excluded from monitoring per phase 0: high volume, low unit value, most-counterfeited line. Still resolvable so Play listings are recognised and filtered rather than polluting mainline comps. Flip `monitored` to re-enable.',
  },
];

// `sub: null` means the alias identifies the house but NOT the sub-line, so it
// cannot resolve a listing on its own.
export const aliases = [
  // --- House-level, Latin. Ambiguous by nature. ---
  { alias: 'Comme des Garçons', sub: null },
  { alias: 'Comme des Garcons', sub: null },
  { alias: 'Comme des Garçon', sub: null },
  { alias: 'Commes des Garcons', sub: null }, // common misspelling in listings
  { alias: 'CDG', sub: null },
  { alias: 'CdG', sub: null },
  { alias: 'C.D.G.', sub: null },
  { alias: 'Comme', sub: null },
  { alias: 'Garcons', sub: null },
  { alias: 'Garçons', sub: null },

  // --- House-level, Japanese. ---
  { alias: 'コムデギャルソン', sub: null },
  { alias: 'コム・デ・ギャルソン', sub: null },
  { alias: 'コムデギャルソン', sub: null },
  { alias: 'ギャルソン', sub: null },

  // --- Sub-line specific, Latin. ---
  { alias: 'Comme des Garcons Homme', sub: 'cdg-homme' },
  { alias: 'CDG Homme', sub: 'cdg-homme' },

  { alias: 'Comme des Garcons Homme Plus', sub: 'cdg-homme-plus' },
  { alias: 'Homme Plus', sub: 'cdg-homme-plus' },
  { alias: 'Homme+', sub: 'cdg-homme-plus' },
  { alias: 'HP', sub: 'cdg-homme-plus' },
  { alias: 'CDGHP', sub: 'cdg-homme-plus' },

  { alias: 'Comme des Garcons Homme Deux', sub: 'cdg-homme-deux' },
  { alias: 'Homme Deux', sub: 'cdg-homme-deux' },

  { alias: 'Homme Plus Sport', sub: 'cdg-homme-plus-sport' },
  { alias: 'Homme Plus Evergreen', sub: 'cdg-homme-plus-evergreen' },

  { alias: 'Comme des Garcons Shirt', sub: 'cdg-shirt' },
  { alias: 'CDG Shirt', sub: 'cdg-shirt' },
  { alias: 'Shirt Boy', sub: 'cdg-shirt-boy' },
  { alias: 'Shirt Girl', sub: 'cdg-shirt-girl' },

  { alias: 'Black Comme des Garcons', sub: 'cdg-black' },
  { alias: 'BLACK CDG', sub: 'cdg-black' },
  { alias: 'Comme des Garcons Noir', sub: 'cdg-noir' },

  { alias: 'Tricot Comme des Garcons', sub: 'cdg-tricot' },
  { alias: 'Tricot', sub: 'cdg-tricot' },
  { alias: 'Robe de Chambre', sub: 'cdg-robe-de-chambre' },
  { alias: 'Comme des Garcons Girl', sub: 'cdg-girl' },

  { alias: 'Noir Kei Ninomiya', sub: 'noir-kei-ninomiya' },
  { alias: 'Kei Ninomiya', sub: 'noir-kei-ninomiya' },

  { alias: 'Junya Watanabe', sub: 'junya-watanabe' },
  { alias: 'Junya', sub: 'junya-watanabe' },
  { alias: 'Junya Watanabe MAN', sub: 'junya-watanabe-man' },
  { alias: 'JW MAN', sub: 'junya-watanabe-man' },

  { alias: 'Tao Comme des Garcons', sub: 'tao' },
  { alias: 'Tao Kurihara', sub: 'tao' },
  { alias: 'Ganryu', sub: 'ganryu' },
  { alias: 'Fumito Ganryu', sub: 'ganryu' },

  { alias: 'Comme des Garcons Comme des Garcons', sub: 'cdg-comme-comme' },
  { alias: 'Comme Comme', sub: 'cdg-comme-comme' },
  { alias: 'CDG CDG', sub: 'cdg-comme-comme' },

  { alias: 'Comme des Garcons Play', sub: 'cdg-play' },
  { alias: 'CDG Play', sub: 'cdg-play' },
  { alias: 'Play Comme des Garcons', sub: 'cdg-play' },

  // --- Sub-line specific, Japanese. ---
  { alias: 'コムデギャルソンオム', sub: 'cdg-homme' },
  { alias: 'コムデギャルソンオムプリュス', sub: 'cdg-homme-plus' },
  { alias: 'オムプリュス', sub: 'cdg-homme-plus' },
  { alias: 'コムデギャルソンオムドゥ', sub: 'cdg-homme-deux' },
  { alias: 'オムドゥ', sub: 'cdg-homme-deux' },
  { alias: 'コムデギャルソンシャツ', sub: 'cdg-shirt' },
  { alias: 'ブラックコムデギャルソン', sub: 'cdg-black' },
  { alias: 'トリコ', sub: 'cdg-tricot' },
  { alias: 'トリコットコムデギャルソン', sub: 'cdg-tricot' },
  { alias: 'ローブドシャンブル', sub: 'cdg-robe-de-chambre' },
  { alias: 'ノワールケイニノミヤ', sub: 'noir-kei-ninomiya' },
  { alias: 'ジュンヤワタナベ', sub: 'junya-watanabe' },
  { alias: 'ジュンヤワタナベマン', sub: 'junya-watanabe-man' },
  { alias: 'タオクリハラ', sub: 'tao' },
  { alias: 'ガンリュウ', sub: 'ganryu' },
  { alias: 'プレイコムデギャルソン', sub: 'cdg-play' },
];
