// One-button start.
//
//   ./start.command   (macOS — double-click it in Finder)
//   start.bat         (Windows — double-click it)
//   ./start.sh        (Linux)
//
// All three run this. It does every step the README describes, in order,
// skipping whatever is already done, and opens the app in your browser.
//
// The design rule here is that it must be safe to run twice, and safe to run
// after a pull, and it must never leave you looking at a browser tab that
// silently shows stale or wrong data. So every check either fixes the problem
// or stops and says plainly what is wrong — nothing is assumed to be fine.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

// Nothing from node_modules may be imported at the top of this file.
//
// This script's first job is to INSTALL the dependencies, so on a fresh
// download node_modules does not exist yet — and a static import of `pg` is
// resolved before the first line of code runs. The result was that the
// launcher died with ERR_MODULE_NOT_FOUND before it could reach the very step
// that would have fixed it. Anything from a package is imported dynamically,
// below, after `npm install` has run.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';

// npm and npx that belong to the Node actually running this.
//
// When the launcher had to fetch its own Node into .runtime/, that Node's npm
// is not on PATH — and a machine that needed the download by definition has no
// other npm either, so calling the bare name would fail with "command not
// found" immediately after successfully installing a runtime.
const NODE_DIR = dirname(process.execPath);
function nodeTool(name) {
  const local = join(NODE_DIR, isWin ? `${name}.cmd` : name);
  return existsSync(local) ? local : name;
}
const NPM = nodeTool('npm');
const NPX = nodeTool('npx');

// ---- small helpers ---------------------------------------------------------

const say = (msg) => console.log(msg);
const step = (msg) => console.log(`\n${msg}`);
const warn = (msg) => console.warn(`  ${msg}`);

function die(msg) {
  console.error(`\n${msg}\n`);
  // On Windows a double-clicked window vanishes the instant the process ends,
  // taking the error with it. Hold it open so the message can be read.
  if (isWin) spawnSync('cmd', ['/c', 'pause'], { stdio: 'inherit' });
  process.exit(1);
}

/** Run a command to completion, inheriting stdio. Returns the exit code. */
function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: opts.quiet ? 'pipe' : 'inherit',
    env: { ...process.env, ...opts.env },
    // npm and docker are .cmd shims on Windows and are not directly executable.
    shell: isWin,
  });
  return res.status ?? 1;
}

/** Is this command present at all? */
function have(cmd, args = ['--version']) {
  const res = spawnSync(cmd, args, { stdio: 'pipe', shell: isWin });
  return res.status === 0;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ask a yes/no question on the terminal this was launched in. */
function ask(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', (d) => {
      process.stdin.pause();
      resolve(String(d));
    });
  });
}

// ---- 0. Node version -------------------------------------------------------

const major = Number(process.versions.node.split('.')[0]);
if (major < 22) {
  die(
    `This needs Node 22 or newer; you are on ${process.versions.node}.\n\n` +
      `  Install it from https://nodejs.org (take the LTS build), then run this again.`,
  );
}

say('\n  Resale tracker\n  ─────────────');

// ---- 1. Dependencies -------------------------------------------------------

if (!existsSync(join(ROOT, 'node_modules'))) {
  step('Installing dependencies (first run only, this takes a minute) …');
  if (run(NPM, ['install']) !== 0) die('npm install failed. The output above says why.');
}

// ---- 2. Configuration ------------------------------------------------------
//
// A missing .env.local is the normal first-run state, not an error. It is
// created from the example so the next steps have something to read.

const envPath = join(ROOT, '.env.local');
if (!existsSync(envPath)) {
  const example = join(ROOT, '.env.example');
  if (!existsSync(example)) die('.env.example is missing — the checkout is incomplete.');
  writeFileSync(envPath, readFileSync(example));
  say('\n  Created .env.local from the example.');
}

// Read it ourselves rather than relying on the flag, because this process was
// started by a double-click and not by `npm run`.
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
  if (!m) continue;
  const value = m[2].trim().replace(/^["']|["']$/g, '');
  if (value && !process.env[m[1]]) process.env[m[1]] = value;
}

let DB_URL = process.env.DATABASE_URL;

const {
  findPostgres, startLocalPostgres, writeDatabaseUrl, installer,
} = await import(new URL('./postgres.mjs', import.meta.url));

const { default: pg } = await import('pg');

async function canConnect(url, timeoutMs = 3000) {
  if (!url) return false;
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: timeoutMs });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    try { await client.end(); } catch { /* already down */ }
    return false;
  }
}

// ---- 3. The database -------------------------------------------------------
//
// Docker used to be the first answer here and it was the wrong one for a
// single-user tool: a large install, a daemon that must be running before
// anything works, and a dead end for someone who only wanted to open an app.
// It is now the last resort.

step('Checking the database …');

if (await canConnect(DB_URL)) {
  say('  Ready.');
} else {
  // Anything not on this machine is the operator's own database, and is never
  // replaced by one started here — a Supabase that is merely asleep or
  // firewalled must be reported, not quietly swapped for an empty local copy.
  const isLocal = !DB_URL || /@(localhost|127\.0\.0\.1)[:/]/.test(DB_URL);
  if (!isLocal) {
    die(
      `Cannot reach the database at ${DB_URL.replace(/:[^:@/]*@/, ':****@')}\n\n` +
        `  That is a remote database, so check the connection string in .env.local,\n` +
        `  that the server is awake, and that your IP is allowed to connect.`,
    );
  }

  let pgBin = findPostgres();

  // Nothing installed. Offer to install it, since "go and install Postgres"
  // is exactly the errand this launcher exists to spare you.
  if (!pgBin) {
    const how = installer();
    if (how && process.stdin.isTTY) {
      say(`\n  Postgres is not installed. It can be installed now with ${how.name}:`);
      say(`      ${how.cmd} ${how.args.join(' ')}\n`);
      const answer = await ask('  Install it? [Y/n] ');
      if (!/^n/i.test(answer.trim())) {
        step(`Installing Postgres via ${how.name} — this takes a few minutes …`);
        if (run(how.cmd, how.args) === 0) pgBin = findPostgres();
      }
    } else if (how) {
      die(
        `Postgres is not installed.\n\n  Install it with:\n      ${how.cmd} ${how.args.join(' ')}\n\n` +
          `  Then run this again.`,
      );
    }
  }

  if (pgBin) {
    say(`  Using ${pgBin.version || 'the Postgres on this machine'}.`);
    const started = await startLocalPostgres(pgBin, ROOT, say);
    if (!started.ok) die(`Could not start Postgres.\n\n  ${started.error}`);

    DB_URL = started.url;
    process.env.DATABASE_URL = DB_URL;
    // Written down so every other script in the project — poll, fx, the app
    // itself — talks to the same database this launcher just started.
    writeDatabaseUrl(ROOT, DB_URL);

    if (!(await canConnect(DB_URL, 8000))) {
      die(`Postgres started but would not accept a connection on port ${started.port}.`);
    }
    say(`  Ready${started.reused ? ' (already running)' : ''} on port ${started.port}.`);
  } else if (have('docker', ['compose', 'version'])) {
    // Last resort, for a machine with Docker but no Postgres.
    say('  No Postgres installed. Falling back to the bundled Docker one …');
    const compose = spawnSync('docker', ['compose', 'up', '-d'], {
      cwd: ROOT, stdio: 'pipe', shell: isWin, encoding: 'utf8',
    });
    if (compose.status !== 0) {
      if (have('docker', ['info'])) {
        console.error(`${compose.stdout ?? ''}${compose.stderr ?? ''}`);
        die('Could not start Postgres via Docker. The output above says why.');
      }
      die('Docker is installed but not running.\n\n  Start Docker Desktop, then run this again.');
    }
    DB_URL = 'postgresql://postgres:postgres@localhost:5432/clothes';
    process.env.DATABASE_URL = DB_URL;
    writeDatabaseUrl(ROOT, DB_URL);
    let up = false;
    for (let i = 0; i < 40 && !up; i++) { await sleep(1000); up = await canConnect(DB_URL, 1500); }
    if (!up) die('Postgres started in Docker but never accepted a connection. Try: docker compose logs db');
    say('  Ready.');
  } else {
    die(
      'No database, and no way to install one automatically.\n\n' +
        '  Install Postgres from https://postgresapp.com (macOS) or\n' +
        '  https://www.postgresql.org/download, then run this again.',
    );
  }
}

// ---- 4. Schema, roster, exchange rates -------------------------------------
//
// setup.mjs is idempotent — migrations that have run are skipped, the seed
// upserts — so this runs every launch rather than trying to guess whether a
// pull brought a new migration with it.

step('Applying migrations and refreshing rates …');
if (run('node', [join(ROOT, 'scripts', 'setup.mjs')]) !== 0) {
  die('Setup failed. The output above says which step.');
}

// ---- 4b. Sources, and actual data ------------------------------------------
//
// The point of the whole thing. An install with no feed sources configured
// polls nothing and shows an empty grid, which is indistinguishable from
// broken — and was, for a while, exactly what happened: every adapter worked
// and nothing was configured to use one.
//
// So on a first run the candidate shops are probed and the ones with a usable
// public feed are configured, then polled before the browser opens, so the app
// opens with listings in it rather than with an explanation.
//
// Afterwards the poll runs in the BACKGROUND: it is a network round trip per
// shop and there is no reason to sit looking at a terminal for it when the
// already-collected data is right there.

const feeds = await countFeedSources();

if (feeds === 0) {
  step('Looking for shops with public product feeds …');
  say('  (probing candidates, one per second — this is the slow part of a first run)');
  run('node', [join(ROOT, 'scripts', 'discover.mjs')]);
}

const hasData = await countListings();

if (await countFeedSources()) {
  if (hasData === 0) {
    step('Fetching listings …');
    run('node', [join(ROOT, 'scripts', 'poll.mjs')]);
  } else {
    step(`${hasData} listings already collected; refreshing in the background.`);
    spawn('node', [join(ROOT, 'scripts', 'poll.mjs')], {
      cwd: ROOT, stdio: 'ignore', env: process.env, detached: true,
    }).unref();
  }
} else {
  // Said plainly rather than left as an empty screen to interpret.
  say('\n  No shops with usable public feeds were found.');
  say('  The app still runs; add a source you know of with:');
  say('      npm run add-source -- --domain shop.example --currency EUR');
}

async function countFeedSources() {
  const c = new pg.Client({ connectionString: DB_URL });
  await c.connect();
  const { rows } = await c.query(`select count(*)::int as n from sources where tier = 'feed'`);
  await c.end();
  return rows[0].n;
}

async function countListings() {
  const c = new pg.Client({ connectionString: DB_URL });
  await c.connect();
  const { rows } = await c.query(`select count(*)::int as n from listings`);
  await c.end();
  return rows[0].n;
}

// ---- 5. Build --------------------------------------------------------------
//
// A production build starts fast and stays fast, which is what makes this feel
// like an application rather than a dev server. The cost is a build step, so it
// is skipped whenever the existing build is newer than every source file.

const NEXT_DIR = join(ROOT, '.next');
const BUILD_ID = join(NEXT_DIR, 'BUILD_ID');

function newestSourceMtime() {
  const skip = new Set(['node_modules', '.next', '.git', 'docs', 'test']);
  let newest = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') && entry.name !== '.env.local') continue;
      if (skip.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else newest = Math.max(newest, statSync(full).mtimeMs);
    }
  };
  walk(ROOT);
  return newest;
}

const buildIsCurrent =
  existsSync(BUILD_ID) && statSync(BUILD_ID).mtimeMs >= newestSourceMtime();

if (buildIsCurrent) {
  step('Build is up to date.');
} else {
  step('Building (first run, or the code changed — takes a minute) …');
  if (run(NPM, ['run', 'build']) !== 0) die('The build failed. The output above says why.');
}

// ---- 6. A free port --------------------------------------------------------

function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

let port = 3000;
while (port < 3020 && !(await portFree(port))) port++;
if (port >= 3020) die('No free port between 3000 and 3019. Close whatever is using them.');
if (port !== 3000) say(`\n  Port 3000 was busy, using ${port}.`);

// ---- 7. Serve, and open a window -------------------------------------------

const url = `http://localhost:${port}`;
step(`Starting on ${url} …`);

// Through serve.mjs rather than `next start` directly, so the server binds
// loopback and says so through APP_BIND. On 0.0.0.0 — Next's default — anyone
// on the same café wifi can reach this, and a Host header claiming to be
// localhost is something they can write themselves.
const server = spawn('node', [join(ROOT, 'scripts', 'serve.mjs'), 'start'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, PORT: String(port), APP_BIND: process.env.APP_BIND || '127.0.0.1' },
  shell: isWin,
});

// Only open the browser once the server actually answers. Opening early shows
// a connection error and trains you to reload.
let opened = false;
for (let i = 0; i < 60 && !opened; i++) {
  await sleep(500);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
    if (res.ok || res.status < 500) opened = true;
  } catch { /* not up yet */ }
}

if (opened) {
  openBrowser(url);
  say(`\n  Open at ${url}`);
} else {
  warn(`The server did not answer. Try opening ${url} yourself.`);
}

/**
 * Open the default browser, and never take the server down with it.
 *
 * The opener is absent more often than it looks: xdg-open is not installed on
 * a minimal or headless Linux box, and a failed spawn emits an 'error' event
 * that is fatal when unhandled — so the app would build, migrate, start
 * serving correctly, and then the process would die on the last line, with a
 * stack trace where the URL should have been. Opening a window is a
 * convenience; serving the app is the job.
 */
function openBrowser(target) {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [target]]
    : isWin ? ['cmd', ['/c', 'start', '""', target]]
    : ['xdg-open', [target]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true, shell: isWin });
    child.on('error', () => warn(`Could not open a browser here — go to ${target} yourself.`));
    child.unref();
  } catch {
    warn(`Could not open a browser here — go to ${target} yourself.`);
  }
}

say('  Close this window, or press Ctrl-C, to stop.\n');

// Stop the server with us, rather than leaving an orphan holding the port.
const stop = () => { server.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', (code) => process.exit(code ?? 0));
