// Refresh external attention signals and report current heat.
//
//   PROBE_CONTACT=you@example.com node scripts/heat.mjs
//
// Internal components (price momentum, turnover, supply) are computed from data
// already held, so they need no network at all. Only the attention component
// reaches out.

import pg from 'pg';
import { fetchPageviews } from '../src/lib/adapters/wikipediaPageviews.mjs';

const contact = process.env.PROBE_CONTACT;
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const { rows: subjects } = await client.query(
  `select * from heat_subjects where enabled and wikipedia_title is not null order by id`,
);

if (!subjects.length) {
  console.log('No heat subjects with a Wikipedia title. Internal heat still computes without them.');
} else {
  for (const subject of subjects) {
    const result = await fetchPageviews({ title: subject.wikipedia_title, contact });
    if (!result.ok) {
      console.warn(`  ${subject.label}: ${result.error}`);
      continue;
    }
    let stored = 0;
    for (const point of result.points) {
      await client.query(
        `insert into heat_signals (subject_id, source, metric, value, period_start, period_end)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (subject_id, source, metric, period_start) do update set value = excluded.value`,
        [subject.id, point.source, point.metric, point.value, point.period_start, point.period_end],
      );
      stored++;
    }
    console.log(`  ${subject.label}: ${stored} daily points${result.note ? ` (${result.note})` : ''}`);
    // Courtesy spacing between subjects.
    await new Promise((r) => setTimeout(r, 1000));
  }
}

await client.end();
