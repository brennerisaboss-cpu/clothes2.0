// Re-run matching over every unmatched listing.
//
//   node scripts/match.mjs
//   node scripts/match.mjs --accept-safe    also link strong, unassumed matches
//
// The stage between collecting and scoring. Polled listings are matched as they
// land, but everything else — a pasted page, the capture endpoint, an alert
// email read from a mailbox — arrives with no item and stays that way until
// something matches it. A listing with no item pools with nothing, has no
// comps, and can never be scored, so a scheduled install that never runs this
// collects diligently and produces an empty opportunities screen.
//
// Intended between `npm run poll` and `npm run alert`.

import pg from 'pg';
import { runMatching } from '../src/lib/matchRunner.mjs';

const acceptSafeSuggestions = process.argv.includes('--accept-safe');

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  const summary = await runMatching({ client, acceptSafeSuggestions });

  console.log(`considered ${summary.considered} unmatched listing${summary.considered === 1 ? '' : 's'}`);
  console.log(`matched    ${summary.matched} on the alias table`);
  if (acceptSafeSuggestions) {
    console.log(`accepted   ${summary.suggested} strong matches with nothing assumed`);
  }
  console.log(`unmatched  ${summary.skipped.length} — settle these on /unresolved`);

  // Why, grouped: one line per reason beats four hundred lines of titles, and
  // the reason is what says whether the fix is a vocabulary entry or an eye.
  const byReason = new Map();
  for (const s of summary.skipped) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);
  for (const [reason, n] of [...byReason].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${String(n).padStart(5)}  ${reason}`);
  }

  if (!acceptSafeSuggestions && summary.skipped.length) {
    console.log(
      '\n/unresolved proposes what each of these probably is, and accepts the strong\n' +
      'ones in bulk. --accept-safe does the same from here, for the matches that\n' +
      'assume nothing at all.',
    );
  }
} finally {
  await client.end();
}
