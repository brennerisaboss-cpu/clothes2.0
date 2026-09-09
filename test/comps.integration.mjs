// What a piece is compared against, proved against the real database.
//
// Borrowing is the only part of the valuation that can be wrong without
// anything looking wrong. A crash announces itself; comps drawn from the wrong
// garments produce a number, a comp count and a confidence figure, all of them
// well-formed and all of them about something else. So the rule gets its own
// test, run against Postgres, using the same SQL the application runs.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { VISIBLE_ITEMS_CTE } from '../src/lib/comps.mjs';

const PREFIX = 'test-comps';
let client;

const cleanup = async () => {
  await client.query(`delete from items where identity_key like $1`, [`${PREFIX}|%`]);
};

before(async () => {
  client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await cleanup();
});

after(async () => {
  await cleanup();
  await client.end();
});

/**
 * An item with the given identity, created if it is not already there.
 *
 * The identity key's first segment is what the borrowing rule pools on, so the
 * test's own prefix stands in for a subline and gives every row here a bucket
 * of its own, away from whatever else is in the database.
 */
async function item(rest) {
  const key = `${PREFIX}|${rest}`;
  const { rows } = await client.query(
    `insert into items (brand_id, subline_id, canonical_name, ad_year_status, identity_key)
     values ('ann', null, $1, 'unknown', $1)
     on conflict (identity_key) do update set identity_key = excluded.identity_key
     returning id`,
    [key],
  );
  return { id: rows[0].id, key };
}

/** The items whose observations would be attributed to `id`, by identity. */
async function lenders(id) {
  const { rows } = await client.query(
    `with ${VISIBLE_ITEMS_CTE}
     select i.identity_key, v.borrowed
       from visible v join items i on i.id = v.from_item
      order by i.identity_key`,
    [[id]],
  );
  return rows.map((r) => `${r.identity_key}${r.borrowed ? ' (borrowed)' : ''}`);
}

test('an item that states everything uses only its own listings', async () => {
  const known = await item('ad2002|jacket|wool|?');
  await item('ad2002|jacket|wool|x1');
  await item('ad2002|jacket|leather|?');

  assert.deepEqual(await lenders(known.id), [
    `${PREFIX}|ad2002|jacket|wool|?`,
    `${PREFIX}|ad2002|jacket|wool|x1 (borrowed)`,
  ]);

  // And the direction holds: the one that names its model does not take comps
  // from the one that does not, or a named piece would be valued against the
  // unnamed pool it was supposed to be distinguished from.
  const named = await item('ad2002|jacket|wool|x1');
  assert.deepEqual(await lenders(named.id), [`${PREFIX}|ad2002|jacket|wool|x1`]);
});

// The case the audit named. It is the one that matters, because the unknown
// segment is not the last one.
test('a known model is not thrown away because the material is unknown', async () => {
  const bag = await item('ad?|bag|?|b7');
  const sameModel = await item('ad?|bag|leather|b7');
  await item('ad?|bag|leather|p3');
  await item('ad?|bag|canvas|tote');

  const from = await lenders(bag.id);
  assert.ok(
    from.includes(`${PREFIX}|ad?|bag|leather|b7 (borrowed)`),
    `the same model in a stated material must lend: ${from.join(', ')}`,
  );
  assert.ok(
    !from.some((k) => /p3|tote/.test(k)),
    `a different model must not lend — that is pricing a B7 as "a bag": ${from.join(', ')}`,
  );
  assert.equal(from.length, 2, from.join(', '));
  assert.ok(sameModel.id);
});

test('an unstated year is a bucket of its own, not a wildcard', async () => {
  // An unstated year keys as `ad?`, which is deliberately NOT the `?` token
  // and so never widens anything. In archive clothing the year is the single
  // largest driver of what a piece is worth — an AD1998 CDG coat and an AD2011
  // one are different objects at different prices — so a coat whose year
  // nobody stated is left alone rather than valued against a specific year's.
  //
  // It costs nothing for the houses that never dated anything: every Guidi
  // boot keys `ad?`, so they all pool with each other exactly as before.
  const anyYear = await item('ad?|coat|wool|?');
  await item('ad2011|coat|wool|?');
  await item('ad2011|jacket|wool|?');

  assert.deepEqual(await lenders(anyYear.id), [`${PREFIX}|ad?|coat|wool|?`]);
});

test('an unidentified garment does not draw on the whole table', async () => {
  // The first segment is the line. If that is unknown there is nothing to pool
  // on, and pooling anyway would value it against every piece ever collected.
  const { rows } = await client.query(
    `insert into items (brand_id, subline_id, canonical_name, ad_year_status, identity_key)
     values ('ann', null, 'unknown piece', 'unknown', '?|ad?|jacket|wool|?')
     on conflict (identity_key) do update set identity_key = excluded.identity_key
     returning id`,
  );
  await item('ad2002|jacket|wool|?');

  const { rows: seen } = await client.query(
    `with ${VISIBLE_ITEMS_CTE} select count(*)::int as n from visible`,
    [[rows[0].id]],
  );
  assert.equal(seen[0].n, 1, 'itself only');
  await client.query(`delete from items where identity_key = '?|ad?|jacket|wool|?'`);
});

test('borrowing is flagged, so a valuation can say where its comps came from', async () => {
  const vague = await item('ad2005|trousers|?|?');
  await item('ad2005|trousers|wool|?');

  const from = await lenders(vague.id);
  assert.equal(from.filter((k) => k.includes('(borrowed)')).length, 1);
  assert.equal(from.filter((k) => !k.includes('(borrowed)')).length, 1, 'its own row is not borrowed');
});
