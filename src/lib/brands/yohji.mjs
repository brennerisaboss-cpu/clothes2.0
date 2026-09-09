// Yohji Yamamoto.
//
// The same problem as CDG and worse: the house runs a dozen lines whose resale
// markets differ by an order of magnitude. A POUR HOMME archive coat and a
// Ground Y tee are not comparable, and Y-3 is barely the same business.
//
// Rough value order, which is why the split matters:
//   POUR HOMME archive >> mainline > Y's for men > Y's > Ground Y > S'YTE > Y-3
//
// Y's for men was on hiatus from 2010 and revived in 2023, so the name spans
// two very different markets — noted rather than split, since tags do not
// reliably distinguish them.

export const brand = { id: 'yohji', display_name: 'Yohji Yamamoto' };

export const sublines = [
  { id: 'yy-mainline', display_name: 'Yohji Yamamoto', mainline: true, note: 'Womenswear mainline.' },
  {
    id: 'yy-pour-homme',
    display_name: 'Yohji Yamamoto POUR HOMME',
    note: 'Menswear mainline. The archive line that carries the most value.',
  },
  { id: 'yy-ys', display_name: "Y's" },
  {
    id: 'yy-ys-for-men',
    display_name: "Y's for men",
    note: 'On hiatus 2010–2023. The same name covers two eras with different markets.',
  },
  { id: 'yy-ys-bis', display_name: "Y's bis" },
  { id: 'yy-ys-red-label', display_name: "Y's Red Label" },
  { id: 'yy-ground-y', display_name: 'Ground Y', note: 'Contemporary diffusion, low unit value.' },
  { id: 'yy-syte', display_name: "S'YTE", note: 'Online diffusion, low unit value.' },
  { id: 'yy-regulation', display_name: 'REGULATION Yohji Yamamoto' },
  { id: 'yy-discord', display_name: 'discord Yohji Yamamoto', note: 'Accessories.' },
  { id: 'yy-limi-feu', display_name: 'LIMI feu', note: "Limi Yamamoto's line — a different designer." },
  { id: 'yy-costume-dhomme', display_name: "Costume d'Homme" },
  {
    id: 'yy-y3',
    display_name: 'Y-3',
    monitored: false,
    note: 'adidas collaboration. High volume, low archive value — excluded by default like CDG Play.',
  },
  {
    id: 'yy-pour-homme-noir',
    display_name: 'Yohji Yamamoto + Noir',
    note: 'Confirm you want this tracked separately.',
  },
];

export const aliases = [
  // House level — cannot resolve a line on its own.
  { alias: 'Yohji Yamamoto', sub: null },
  { alias: 'Yohji', sub: null },
  { alias: 'Yamamoto', sub: null },
  { alias: 'YY', sub: null },
  { alias: 'ヨウジヤマモト', sub: null },
  { alias: 'ヨージヤマモト', sub: null },
  { alias: 'ヨウジ', sub: null },

  { alias: 'Yohji Yamamoto Pour Homme', sub: 'yy-pour-homme' },
  { alias: 'Pour Homme', sub: 'yy-pour-homme' },
  { alias: 'YYPH', sub: 'yy-pour-homme' },
  { alias: 'ヨウジヤマモトプールオム', sub: 'yy-pour-homme' },
  { alias: 'プールオム', sub: 'yy-pour-homme' },

  { alias: "Y's for men", sub: 'yy-ys-for-men' },
  { alias: 'Ys for men', sub: 'yy-ys-for-men' },
  { alias: 'ワイズフォーメン', sub: 'yy-ys-for-men' },
  { alias: "Y's bis", sub: 'yy-ys-bis' },
  { alias: "Y's Red Label", sub: 'yy-ys-red-label' },
  { alias: "Y's", sub: 'yy-ys' },
  { alias: 'ワイズ', sub: 'yy-ys' },

  { alias: 'Ground Y', sub: 'yy-ground-y' },
  { alias: 'グラウンドワイ', sub: 'yy-ground-y' },
  { alias: "S'YTE", sub: 'yy-syte' },
  { alias: 'SYTE', sub: 'yy-syte' },
  { alias: 'サイト', sub: 'yy-syte' },
  { alias: 'REGULATION Yohji Yamamoto', sub: 'yy-regulation' },
  { alias: 'Regulation', sub: 'yy-regulation' },
  { alias: 'discord Yohji Yamamoto', sub: 'yy-discord' },
  { alias: 'LIMI feu', sub: 'yy-limi-feu' },
  { alias: 'LIMIfeu', sub: 'yy-limi-feu' },
  { alias: 'リミフゥ', sub: 'yy-limi-feu' },
  { alias: "Costume d'Homme", sub: 'yy-costume-dhomme' },
  { alias: 'Y-3', sub: 'yy-y3' },
  { alias: 'Y3', sub: 'yy-y3' },
  { alias: 'ワイスリー', sub: 'yy-y3' },
];
