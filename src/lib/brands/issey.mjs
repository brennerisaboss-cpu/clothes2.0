// Issey Miyake.
//
// Adjacent to the artisanal cluster rather than in it, but included because the
// archive overlaps and the line structure is the usual trap: HOMME PLISSÉ and
// Pleats Please are high-volume contemporary lines, while the 80s–90s mainline
// and the Miyake Design Studio archive are a different market entirely.

export const brand = { id: 'issey', display_name: 'Issey Miyake' };

export const sublines = [
  { id: 'im-mainline', display_name: 'Issey Miyake', mainline: true },
  {
    id: 'im-mds',
    display_name: 'Miyake Design Studio',
    note: 'The archive proper. Where the value sits.',
  },
  { id: 'im-men', display_name: 'Issey Miyake Men' },
  {
    id: 'im-homme-plisse',
    display_name: 'HOMME PLISSÉ ISSEY MIYAKE',
    note: 'Contemporary, high volume. Distinct market from the archive.',
  },
  { id: 'im-pleats-please', display_name: 'Pleats Please Issey Miyake' },
  { id: 'im-me', display_name: 'me ISSEY MIYAKE', monitored: false, note: 'Low unit value.' },
  { id: 'im-bao-bao', display_name: 'BAO BAO ISSEY MIYAKE', monitored: false, note: 'Bags, high volume.' },
  { id: 'im-132-5', display_name: '132 5. ISSEY MIYAKE' },
  { id: 'im-apoc', display_name: 'A-POC' },
];

export const aliases = [
  { alias: 'Issey Miyake', sub: null },
  { alias: 'Miyake', sub: null },
  { alias: 'イッセイミヤケ', sub: null },
  { alias: 'イッセイ', sub: null },

  { alias: 'Miyake Design Studio', sub: 'im-mds' },
  { alias: 'MDS', sub: 'im-mds' },
  { alias: 'Issey Miyake Men', sub: 'im-men' },
  { alias: 'HOMME PLISSE', sub: 'im-homme-plisse' },
  { alias: 'Homme Plisse Issey Miyake', sub: 'im-homme-plisse' },
  { alias: 'オムプリッセ', sub: 'im-homme-plisse' },
  { alias: 'Pleats Please', sub: 'im-pleats-please' },
  { alias: 'プリーツプリーズ', sub: 'im-pleats-please' },
  { alias: 'me ISSEY MIYAKE', sub: 'im-me' },
  { alias: 'BAO BAO', sub: 'im-bao-bao' },
  { alias: 'バオバオ', sub: 'im-bao-bao' },
  { alias: '132 5', sub: 'im-132-5' },
  { alias: 'A-POC', sub: 'im-apoc' },
  { alias: 'APOC', sub: 'im-apoc' },
];
