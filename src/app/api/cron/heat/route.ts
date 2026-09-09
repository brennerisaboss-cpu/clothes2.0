import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { checkCron } from '@/lib/cronAuth';
import { usableContact } from '@/lib/userAgent.mjs';
import { fetchPageviews, MIN_INTERVAL_MS } from '@/lib/adapters/wikipediaPageviews.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Refresh the attention series behind /heat.
 *
 * `vercel.json` was documented as declaring three schedules and declared two,
 * so on a deployment the attention component never gained a point and every
 * heat reading stayed one-legged — which looks exactly like a market with
 * nothing happening in it, and is instead a cron that was never written.
 *
 * The same work `npm run heat` does, and the same refusal: Wikimedia's policy
 * requires a contactable User-Agent and answers 403 without one, so an unset
 * PROBE_CONTACT is reported as a skip with its reason rather than sent as an
 * anonymous scraper-shaped request at a volunteer-funded API.
 */
export async function GET(request: Request) {
  const denied = checkCron(request);
  if (denied) return denied;

  const contact = process.env.PROBE_CONTACT;
  if (!usableContact(contact)) {
    return NextResponse.json({
      skipped:
        'PROBE_CONTACT is not set to a usable contact, and Wikimedia requires one. ' +
        'Set it to an email or URL you read; the other three heat components need no network.',
    });
  }

  const client = await pool.connect();
  try {
    const { rows: subjects } = await client.query(
      `select id, label, wikipedia_title from heat_subjects
        where enabled and wikipedia_title is not null order by id`,
    );

    let points = 0;
    const failures: { subject: string; error: string }[] = [];

    for (const [index, subject] of subjects.entries()) {
      // Courtesy spacing between subjects, as the script does. The adapter
      // states its own documented rate limit; this honours it rather than
      // discovering it as a 429.
      if (index) await new Promise((r) => setTimeout(r, Math.max(1000, MIN_INTERVAL_MS)));

      const result = await fetchPageviews({ title: subject.wikipedia_title, contact });
      if (!result.ok) {
        failures.push({ subject: subject.label, error: result.error });
        continue;
      }
      for (const point of result.points) {
        // Upsert on (subject, source, metric, period): re-running is how this
        // recovers from a partial day, so it must never double-count one.
        await client.query(
          `insert into heat_signals (subject_id, source, metric, value, period_start, period_end)
           values ($1,$2,$3,$4,$5,$6)
           on conflict (subject_id, source, metric, period_start) do update set value = excluded.value`,
          [subject.id, point.source, point.metric, point.value, point.period_start, point.period_end],
        );
        points++;
      }
    }

    return NextResponse.json({ subjects: subjects.length, points, failures });
  } finally {
    client.release();
  }
}
