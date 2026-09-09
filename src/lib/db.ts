import pg from 'pg';

// Numeric columns come back as strings from node-postgres by default, which is
// correct for arbitrary precision but wrong for money we are about to compare.
// Parse them once, here, rather than sprinkling Number() through the UI.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)));

declare global {
  // eslint-disable-next-line no-var
  var __clothesPool: pg.Pool | undefined;
}

function makePool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set — copy .env.example to .env.local');
  }
  return new pg.Pool({ connectionString, max: 5 });
}

// Reuse across dev hot reloads instead of leaking a pool per reload.
export const pool = globalThis.__clothesPool ?? makePool();
if (process.env.NODE_ENV !== 'production') globalThis.__clothesPool = pool;

/**
 * Connection failures, said in words.
 *
 * A dead Postgres surfaces inside a React Server Component as "The destination
 * stream closed early" plus a digest — which names neither the database nor
 * anything to do about it, and is what every page in this app turns into the
 * moment the server stops. The driver's own `ECONNREFUSED 127.0.0.1:5433` is
 * closer but still leaves the reader to know what is on that port.
 */
function explain(err: unknown): unknown {
  const code = (err as { code?: string })?.code;
  if (!['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', '57P01', '57P03'].includes(code ?? '')) {
    return err;
  }
  const where = (process.env.DATABASE_URL ?? '').replace(/\/\/[^@]*@/, '//');
  const wrapped = new Error(
    `The database is not reachable (${code}) at ${where || 'DATABASE_URL'}. ` +
      'Nothing is wrong with the page — the Postgres this reads from is not running. ' +
      'Start it with `npm run start:app`, which launches it alongside the server.',
  );
  (wrapped as { cause?: unknown }).cause = err;
  return wrapped;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  try {
    const result = await pool.query<T>(text, params);
    return result.rows;
  } catch (err) {
    throw explain(err);
  }
}

export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
