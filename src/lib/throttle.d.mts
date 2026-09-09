export const MAX_FAILURES: number;
export const LOCKOUT_MS: number;
export const RESET_AFTER_MS: number;

export type AttemptState = {
  failures?: number;
  first_failure_at?: Date | string | null;
  last_failure_at?: Date | string | null;
  locked_until?: Date | string | null;
} | null;

export function throttleFor(
  state: AttemptState,
  now?: number,
): { locked: boolean; retryAfterMs: number; delayMs: number; failures: number };

export function afterFailure(
  state: AttemptState,
  now?: number,
): {
  failures: number;
  first_failure_at: Date;
  last_failure_at: Date;
  locked_until: Date | null;
};
