// Add a shop that has no feed and no API, by pointing at its results page.
//
//   node scripts/add-page.mjs --url https://shop.example/collections/archive
//
//     --currency EUR       fallback only; the page's own symbol always wins
//     --name "Display Name"
//     --id my_shop
//     --role acquisition|exit|both     default acquisition
//     --every 720          poll interval in minutes, default 720
//     --dry-run            fetch, parse, print, write nothing
//
// Why this exists
// ---------------
// The obstacle for the long tail of archive dealers is not that a key is hard
// to obtain — it is that there is no key, no feed and no API to have one for.
// Every supported platform needed an adapter written against its documentation;
// a hand-built Squarespace shop has no documentation to write against.
//
// So this does what parse.bot-style services do, minus the part that cannot be
// done honestly: it reads the results page itself. No selectors to write, no
// recipe to maintain when the shop restyles — the page is flattened to lines
// exactly as COPYING it would flatten it, and handed to the same parser that
// already reads pasted RealReal, Grailed and Vestiaire pages.
//
// What it will not do, and no flag will make it do:
//
//   * fetch a path robots.txt excludes — checked here and again on every poll
//   * retry a 403 wearing a different user agent, address or fingerprint
//   * touch The RealReal, Grailed or Vestiaire, whose terms prohibit it
//
// A page that answers a plain, identified request is a page that permits one.
// A page that does not is a page to paste, and pasting is a supported route.
//
// And what it gives up in exchange, which matters: it reads ONE page of
// results with no way to know how many there are, so it always reports the
// catalogue as incomplete. It can add pieces and re-price them. It can never
// conclude that a piece has gone, so this source contributes no disappearance
// evidence — the strongest kind. Where a real feed exists, use add-source.

import pg from 'pg';
import * as page from '../src/lib/adapters/page.mjs';

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const url = flag('url');
const dryRun = has('dry-run');

if (!url) {
  console.error(`
Usage: node scripts/add-page.mjs --url https://shop.example/collections/archive

  --currency EUR    fallback only — a price with its own symbol wins
  --name "Name"     defaults to the host
  --id my_shop      defaults to a slug of the host
  --role acquisition|exit|both    default acquisition
  --every 720       poll interval in minutes, default 720
  --dry-run         fetch, parse and print; write nothing

Point it at the page you would look at yourself: a collection, or a search
you have already narrowed. Try --dry-run first and read the prices.
`);
  process.exit(1);
}

let target;
try {
  target = new URL(url);
} catch {
  console.error(`"${url}" is not a URL.`);
  process.exit(1);
}

const BLOCKED = ['grailed.com', 'vestiairecollective.com', 'therealreal.com'];
if (BLOCKED.some((b) => target.hostname === b || target.hostname.endsWith(`.${b}`))) {
  console.error(
    `\n${target.hostname} is manual-tier permanently — its terms prohibit automated
access, and that does not change because the request is made differently.

Paste its pages on /add instead. That route is fully supported and is where
most of the parser's work has gone.\n`,
  );
  process.exit(1);
}

const currency = flag('currency')?.toUpperCase() ?? null;
if (currency && !/^[A-Z]{3}$/.test(currency)) {
  console.error(`"${currency}" is not an ISO 4217 code.`);
  process.exit(1);
}

const id = flag('id') ?? target.hostname.replace(/^www\./, '').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
const name = flag('name') ?? target.hostname.replace(/^www\./, '');
const role = flag('role', 'acquisition');
const every = Number(flag('every', '720'));

if (!['acquisition', 'exit', 'both'].includes(role)) {
  console.error('--role must be acquisition, exit or both.');
  process.exit(1);
}
if (!Number.isFinite(every) || every < 15) {
  console.error('--every must be at least 15 minutes. Polling a small shop faster than it changes is rude and pointless.');
  process.exit(1);
}

const CONTACT = process.env.PROBE_CONTACT;
if (!CONTACT) {
  console.error(`
PROBE_CONTACT is not set.

A shop owner who notices these requests should be able to find out who is
making them and ask you to stop. Set it to an email you read.
`);
  process.exit(1);
}
const UA = `resale-tracker/0.1 (personal price tracker; ${CONTACT})`;

// ---- Read it, exactly as a poll would ---------------------------------------
//
// Same adapter, same robots check, same parser. Nothing about this rehearsal
// is a special case, so what it prints is what would be ingested.
console.log(`\nReading ${target.href} …`);
const probe = await page.fetchListings({ url: target.href, currency, userAgent: UA }, {});

if (!probe.ok) {
  console.error(`\n  ${probe.error}`);
  if (probe.note) console.error(`  ${probe.note}`);

  // The advice has to match the refusal. "It is probably rendered by script"
  // is right for an empty parse and wrong — misleading, even — for a shop that
  // has just said no: there is nothing to work around there.
  const refused = /robots\.txt|refused|rate limited/i.test(probe.error);
  console.error(
    refused
      ? `
Not added, and that is the shop's answer rather than a fault to route around.
Paste its pages on /add instead — that route is fully supported.
`
      : `
Not added. If the page loads fine in a browser but not here, its results are
almost certainly rendered by script after load — nothing here executes any, on
purpose. Paste that page on /add instead.
`,
  );
  process.exit(1);
}

console.log(`  ${probe.listings.length} listings read`);
if (probe.note) console.log(`  ${probe.note}`);

// A currency mistake is invisible in a count and obvious in a price.
console.log('\n  What would be ingested:\n');
for (const l of probe.listings.slice(0, 8)) {
  console.log(
    `    ${String(l.price).padStart(10)} ${l.currency}  ${String(l.title).slice(0, 52).padEnd(52)}` +
      `${l.url ? '' : '   NO LINK'}`,
  );
}
const missing = probe.listings.filter((l) => !l.url).length;
if (missing) {
  console.log(`\n  ${missing} of ${probe.listings.length} have no link back to the listing.`);
}
console.log(`\n  Do those prices and names look right? If not, stop — a wrong currency
  puts every price out by a factor of a hundred and fifty.`);

if (dryRun) {
  console.log('\n--dry-run: nothing written.\n');
  process.exit(0);
}

// The schema requires a currency on every feed source, and it is right to:
// price_base is stamped once, at insert, and a listing stored unconvertible
// stays that way. Take the one the page itself used where they agree.
const observed = [...new Set(probe.listings.map((l) => l.currency))];
if (observed.length > 1) {
  console.error(`\n  The page quotes ${observed.join(' and ')}. Not added — this cannot price a mixed shop.\n`);
  process.exit(1);
}
const declared = currency ?? observed[0];

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

await client.query(
  `insert into sources
     (id, display_name, tier, role, automation_allowed, base_url,
      permission_status, poll_interval_minutes, config)
   values ($1, $2, 'feed', $3, true, $4, 'not_asked', $5,
           jsonb_build_object('adapter', 'page', 'url', $6::text,
                              'domain', $7::text, 'currency', $8::text))
   on conflict (id) do update set
     display_name = excluded.display_name,
     role = excluded.role,
     base_url = excluded.base_url,
     poll_interval_minutes = excluded.poll_interval_minutes,
     config = excluded.config`,
  [id, name, role, target.origin, every, target.href, target.hostname, declared],
);

console.log(`
Added "${name}" as ${id}, reading ${target.href} every ${every} minutes, in ${declared}.

  npm run poll -- --source ${id}

It will add and re-price. It will never report anything as gone: one page of
results is not a catalogue, and this says so on every run.
`);

await client.end();
