import type { PoolClient } from 'pg';

export function runMatching(opts: {
  client: PoolClient;
  acceptSafeSuggestions?: boolean;
}): Promise<{
  considered: number;
  matched: number;
  suggested: number;
  skipped: { title: string; reason: string }[];
}>;
