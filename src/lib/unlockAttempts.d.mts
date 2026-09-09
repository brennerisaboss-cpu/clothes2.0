import type pg from 'pg';

/** Check one password attempt under a row lock, applying and recording the throttle. */
export function attemptUnlock(
  pool: pg.Pool,
  client: string,
  check: () => boolean,
): Promise<{ ok: boolean; locked: boolean; retryAfterMs: number; failures: number }>;

/**
 * Which counter an attempt belongs to. Never derived from a header unless a
 * trusted proxy is declared — a key the caller can vary is not a limit.
 */
export function clientKey(
  headers: Headers,
  options?: { bind?: string | null; trustProxy?: string | null },
): string;
