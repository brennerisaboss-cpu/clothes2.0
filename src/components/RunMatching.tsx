'use client';

import { useState, useTransition } from 'react';
import { runMatching } from '@/app/actions';

/** Re-runs the deterministic alias matcher over everything still unmatched. */
export default function RunMatching() {
  const [result, setResult] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="shrink-0 text-right">
      <button
        className="btn"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await runMatching();
            setResult(
              `${r.matched} of ${r.considered} matched${
                r.skipped.length ? `, ${r.skipped.length} left for you` : ''
              }.`,
            );
          })
        }
      >
        {pending ? 'Matching…' : 'Re-run alias matching'}
      </button>
      {result ? <p className="mt-1 text-[11px] text-muted">{result}</p> : null}
    </div>
  );
}
