'use client';

import { useState, useTransition } from 'react';
import { applySuggestions } from '@/app/actions';

/**
 * Accept every strong proposal at once.
 *
 * Offered because the alternative is not "click each one" but "do none of
 * them": a paste is a hundred rows, and a suggestion that costs a click each
 * is a suggestion that goes unused, which leaves the listings pooling with
 * nothing exactly as before.
 *
 * Only the strong ones, and only the best per listing. What each of them
 * agreed on and assumed is on the row beneath this button — this changes how
 * many decisions it takes, not how much you are told.
 */
export default function AcceptSuggestions({
  pairs,
}: {
  pairs: { listingId: string; itemId: string }[];
}) {
  const [result, setResult] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!pairs.length) return null;

  return (
    <span className="flex items-center gap-2">
      <button
        className="btn"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await applySuggestions(pairs);
            setResult(
              `Linked ${res.linked}${res.failed.length ? `, ${res.failed.length} failed` : ''}.`,
            );
          })
        }
      >
        {pending ? 'Linking…' : `Accept ${pairs.length} strong match${pairs.length === 1 ? '' : 'es'}`}
      </button>
      {result ? <span className="text-[12px] text-ok">{result}</span> : null}
    </span>
  );
}
