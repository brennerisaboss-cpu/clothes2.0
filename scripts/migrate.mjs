import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'db', 'migrations');

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
});

await client.connect();
await client.query(`
  create table if not exists _migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )
`);

const applied = new Set(
  (await client.query('select name from _migrations')).rows.map((r) => r.name),
);
const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

let count = 0;
for (const file of files) {
  if (applied.has(file)) continue;
  const sql = await readFile(join(dir, file), 'utf8');
  try {
    await client.query('begin');
    await client.query(sql);
    await client.query('insert into _migrations (name) values ($1)', [file]);
    await client.query('commit');
    console.log(`applied ${file}`);
    count++;
  } catch (err) {
    await client.query('rollback');
    console.error(`FAILED ${file}: ${err.message}`);
    process.exitCode = 1;
    break;
  }
}
if (count === 0 && process.exitCode !== 1) console.log('nothing to apply');
await client.end();
