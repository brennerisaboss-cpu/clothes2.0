// The matching stage, proved against the real database.
//
// It existed only as a server action behind a button, so everything that does
// not arrive through a poll — a pasted page, the capture endpoint, an alert
// email — sat with `item_id` null until somebody opened a browser. A listing
// with no item pools with nothing, has no comps and can never be scored, so a
// scheduled install collected diligently and produced an empty opportunities
// screen. Now it is a module two callers share, which is worth holding in place.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { runMatching } from '../src/lib/matchRunner.mjs';

const SOURCE = 'test_match_runner';
let client;

const cleanup = async () => {
  await client.query(`delete from listings where source_id = $1`, [SOURCE]);
  await client.query(
    `delete from items where canonical_name like 'Comme des Garçons Homme Plus%'
       and not exists (select 1 from listings l where l.item_id = items.id)`,
  );
  await client.query(`delete from sources where id = $1`, [SOURCE]);
};

before(async () => {
  client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await cleanup();
  await client.query(
    `insert into sources (id, display_name, tier, role, automation_allowed,
                          automation_block_reason, permission_status, marketplace_kind)
     values ($1, 'Match runner fixture', 'manual', 'acquisition', false,
             'fixture source, never polled', 'not_asked', 'secondhand')`,
    [SOURCE],
  );
});

beforeEach(async () => {
  await client.query(`delete from listings where source_id = $1`, [SOURCE]);
});

after(async () => {
  await cleanup();
  await client.end();
});

let seq = 0;
async function listing(title) {
  const { rows } = await client.query(
    // A hand-entered row must carry a verification timestamp: the staleness
    // decay is computed from it, and the schema refuses one without it.
    `insert into listings (source_id, source_item_id, title_raw, price, currency,
                           price_base, fx_rate_at_snapshot, status, evidence,
                           entered_manually, last_verified_at, first_seen_at)
     values ($1, $2, $3, 500, 'EUR', 500, 1, 'active', 'active_ask', true, now(), now())
     returning id`,
    [SOURCE, `M${++seq}`, title],
  );
  return rows[0].id;
}

const itemOf = async (id) => {
  const { rows } = await client.query(
    `select i.identity_key from listings l join items i on i.id = l.item_id where l.id = $1`,
    [id],
  );
  return rows[0]?.identity_key ?? null;
};

test('a listing the alias table can key gets an item', async () => {
  const id = await listing('Comme des Garcons Homme Plus AD2002 wool tailored jacket');

  const summary = await runMatching({ client });
  assert.equal(summary.matched >= 1, true);
  assert.equal(await itemOf(id), 'cdg-homme-plus|ad2002|jacket|wool|?');
});

test('two wordings of one garment land on one item', async () => {
  // The whole point of the stage. Before the season fix the Japanese wording
  // keyed as model "02AW" with an unknown year and became a second item with a
  // comp set of one.
  const a = await listing('Comme des Garcons Homme Plus AD2002 wool tailored jacket');
  const b = await listing('CDG HOMME PLUS 02AW ウール テーラード ジャケット');

  await runMatching({ client });

  const keyA = await itemOf(a);
  assert.equal(keyA, await itemOf(b));
  assert.equal(keyA, 'cdg-homme-plus|ad2002|jacket|wool|?');
});

test('a title the vocabularies cannot read is left alone, not guessed at', async () => {
  const id = await listing('Comme des Garcons something interesting');

  const summary = await runMatching({ client });
  assert.equal(await itemOf(id), null, 'never merged on a guess');
  assert.equal(
    summary.skipped.some((s) => s.title.includes('something interesting')),
    true,
    'and it says why, so /unresolved is a destination rather than a silence',
  );
});

test('by default nothing is linked on a suggestion', async () => {
  // "Nothing is ever linked without you" is a rule this codebase keeps, and a
  // scheduled job is not a person. The suggestion has to be asked for.
  await listing('Comme des Garcons Homme Plus AD2002 wool tailored jacket');
  await runMatching({ client });

  const vague = await listing('Comme des Garçons Homme Plus wool jacket');
  const summary = await runMatching({ client });

  assert.equal(summary.suggested, 0);
  // It keyed exactly, on its own, without needing a suggestion — the sub-line
  // and garment are both stated. What it does NOT do is inherit the AD year.
  assert.equal(await itemOf(vague), 'cdg-homme-plus|ad?|jacket|wool|?');
});

test('re-running matches nothing twice', async () => {
  // Idempotence matters because this is a cron: a listing already carrying an
  // item is no longer a candidate, so a second pass has nothing of its own left
  // to do. Asserted on `matched` rather than `considered`, since whatever else
  // the database holds unmatched is not this test's business.
  const id = await listing('Comme des Garcons Homme Plus AD2002 wool tailored jacket');
  const first = await runMatching({ client });
  assert.equal(first.matched >= 1, true);

  const key = await itemOf(id);
  const second = await runMatching({ client });
  assert.equal(second.matched, 0);
  assert.equal(await itemOf(id), key, 'and the item it landed on does not move');
});
