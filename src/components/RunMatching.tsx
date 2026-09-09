'use client';

import { useState, useTransition } from 'react';
import { runMatching } from '@/app/actions';

/**
 * Re-runs the matcher over everything still unmatched.
 *
 * Two passes, and the second is opt-in on purpose. The first is the alias
 * table, which only ever links what it can prove. The second offers the
 * listings that cannot be keyed at all to the matchmaker, and takes only the
 * ones scoring strong against an existing item WITH NOTHING ASSUMED — the same
 * test the bulk-accept button is held to, re-derived on the server from the
 * rows as they are now.
 *
 * "Nothing is ever linked without you" is a rule this codebase keeps, so the
 * checkbox is what makes it your decision. The scheduled matcher never sets it:
 * a cron job is not a person, and the proposals wait here with what they agreed
 * on and what they assumed.
 */
export default function RunMatching() {
  const [result, setResult] = useState<string | null>(null);
  const [acceptSafe, setAcceptSafe] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <div className="shrink-0 text-right">
      <span className="flex flex-wrap items-center justify-end gap-3">
        <label
          className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] text-muted"
          title="Only matches that assume nothing: the listing states its own sub-line and agrees with the item on everything either of them says."
        >
          <input
            type="checkbox"
            checked={acceptSafe}
            onChange={(e) => setAcceptSafe(e.target.checked)}
          />
          accept unassumed matches
        </label>
        <button
          className="btn"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await runMatching(acceptSafe);
              setResult(
                `${r.matched} of ${r.considered} matched` +
                  (r.suggested ? `, ${r.suggested} accepted` : '') +
                  (r.skipped.length ? `, ${r.skipped.length} left for you` : '') +
                  '.',
              );
            })
          }
        >
          {pending ? 'Matching…' : 'Re-run alias matching'}
        </button>
      </span>
      {result ? <p className="mt-1 text-[11px] text-muted">{result}</p> : null}
      {acceptSafe && !result ? (
        <p className="mt-1 text-[11px] text-muted">
          Links only what agrees on everything both sides state. Anything resting on an assumption
          stays below, however high it scores.
        </p>
      ) : null}
    </div>
  );
}
