'use client';

/**
 * What the screen says when a page throws.
 *
 * There was no boundary at all, so any failure during render reached the
 * browser as Next's own "The destination stream closed early" plus a digest —
 * which names nothing, suggests nothing, and looks like the application is
 * broken. In this app the overwhelmingly likely cause is one thing: the
 * Postgres every page reads from is not running.
 *
 * Next redacts a server error's message in production and passes only the
 * digest, so this cannot rely on reading it. It names the likely cause anyway,
 * because being right most of the time and checkable in one command beats a
 * hexadecimal string that is never either.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const message = error?.message ?? '';
  const looksLikeDatabase =
    /database is not reachable|ECONNREFUSED|ECONNRESET|ENOTFOUND|stream closed early/i.test(message);

  return (
    <div className="mx-auto max-w-[62ch] border border-dashed border-edge-strong p-8">
      <p className="label mb-2">Something failed while rendering this page</p>

      <p className="text-sm text-muted">
        {looksLikeDatabase
          ? 'The database this reads from is not answering.'
          : 'The most common cause by far is that the database this reads from is not running — every page here queries it.'}
      </p>

      <p className="mt-4 text-sm">
        Start the server and its database together:{' '}
        <code className="not-italic text-fg">npm run start:app</code>
      </p>
      <p className="mt-1 text-[12px] text-muted">
        Or check what is blocking, without the app running:{' '}
        <code className="not-italic">npm run status</code>
      </p>

      <button
        onClick={reset}
        className="mt-5 border border-fg px-3 py-1 text-[12px] uppercase tracking-[0.08em] transition-colors hover:bg-fg hover:text-bg"
      >
        Try again
      </button>

      {/* The details, last and quiet: useful when the guess above is wrong,
          and noise when it is right. In production Next redacts the message
          and sends only the digest, so both are shown when present. */}
      {(message || error?.digest) ? (
        <details className="mt-6">
          <summary className="cursor-pointer text-[11px] uppercase tracking-[0.08em] text-muted">
            Details
          </summary>
          {message ? (
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[11px] text-muted">{message}</pre>
          ) : null}
          {error?.digest ? (
            <p className="mt-1 text-[11px] text-muted">digest {error.digest}</p>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}
