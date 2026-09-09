// Item identity, end to end against the real database.
//
// The unit tests prove the key is computed correctly. What only the database
// can prove is that the key actually POOLS: that two listings from different
// venues, worded differently, land on one item and become comps for each
// other — and that the unique index stops two code paths creating two items
// for one garment.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { planMatch } from '../src/lib/matching.mjs';

const ACQ = 'test_identity_acq';
const EXIT = 'test_identity_exit';
let client;

const cleanup = async () => {
  await client.query(
    `delete from listings where source_id = any($1::text[])`, [[ACQ, EXIT]],
  );
  await client.query(`delete from items where identity_key like 'cdg-homme-plus|ad2011|%'`);
  await client.query(`delete from sources where id = any($1::text[])`, [[ACQ, EXIT]]);
};

before(async () => {
  client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await cleanup();
  await client.query(
    `insert into sources (id, display_name, tier, role, automation_allowed, automation_block_reason)
     values ($1,'Test Acq','manual','acquisition',false,'test'),
            ($2,'Test Exit','manual','exit',false,'test')`,
    [ACQ, EXIT],
  );
});

after(async () => {
  await cleanup();
  await client.end();
});

async function itemFor(title) {
  const plan = planMatch({ title_raw: title });
  assert.equal(plan.matchable, true, `"${title}" should be matchable: ${plan.reason}`);
  const { rows } = await client.query(
    `insert into items (brand_id, subline_id, canonical_name, ad_year, ad_year_status,
                        ad_year_basis, identity_key)
     values ((select brand_id from sublines where id = $1), $1, $2, $3, $4, $5, $6)
     on conflict (identity_key) do update set identity_key = excluded.identity_key
     returning id, canonical_name`,
    [
      plan.sublineId, plan.canonicalName, plan.adYear, plan.adYearStatus,
      // The schema makes the year and its provenance travel together, so a
      // fixture states it the same way the application does.
      plan.adYear == null ? null : (plan.adYearBasis ?? 'ad_tag'),
      plan.key,
    ],
  );
  return rows[0];
}

test('two venues wording one garment differently land on one item', async () => {
  const a = await itemFor('Comme des Garcons Homme Plus AD2011 wool tailored jacket');
  const b = await itemFor('CDG HOMME PLUS AD2011 ウール ジャケット');

  assert.equal(a.id, b.id, 'the same garment must not become two items');
  // And it is named from its identity, not from whichever title arrived first.
  assert.equal(a.canonical_name, 'Comme des Garçons Homme Plus AD2011 wool jacket');
});

test('a different garment from the same line and year stays separate', async () => {
  const jacket = await itemFor('Comme des Garcons Homme Plus AD2011 wool tailored jacket');
  const trousers = await itemFor('Comme des Garcons Homme Plus AD2011 wool trousers');
  assert.notEqual(jacket.id, trousers.id);
});

test('the unique index refuses a second item for one identity', async () => {
  const { id } = await itemFor('Comme des Garcons Homme Plus AD2011 wool tailored jacket');
  // A plain insert, as a second code path racing the first would attempt.
  await assert.rejects(
    () =>
      client.query(
        `insert into items (brand_id, subline_id, canonical_name, ad_year, ad_year_status,
                        ad_year_basis, identity_key)
         values ('cdg','cdg-homme-plus','duplicate',2011,'known','ad_tag','cdg-homme-plus|ad2011|jacket|wool|?')`,
      ),
    /unique|duplicate key/i,
    'the database must be what stops an item being split in two',
  );
  assert.ok(id);
});
