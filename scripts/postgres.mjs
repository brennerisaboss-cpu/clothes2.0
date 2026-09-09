// Finding, or failing that installing, a Postgres to run against.
//
// Docker was the original answer and it is a poor one for a single-user tool:
// it is a large install, it needs a daemon running before anything works, and
// "Docker Desktop is installed but not started" is a dead end for someone who
// only wanted to open an app.
//
// So Docker becomes the last resort rather than the first. In order:
//
//   1. Whatever DATABASE_URL already points at, if it answers. Someone with a
//      database already set up should never have a second one started for them.
//   2. A Postgres already on this machine. Most Macs with Homebrew have one,
//      as does any Linux box with the postgresql package. Its binaries are used
//      to run a server out of a data directory INSIDE this project, on its own
//      port, so it cannot collide with or disturb an existing installation.
//   3. Install one, with the platform's own package manager, after asking.
//   4. Docker.
//
// Step 2 is the interesting one: `initdb` and `pg_ctl` are all that is needed
// to run a private Postgres, and having the binaries present is far more
// common than having a configured, running server.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, appendFileSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import net from 'node:net';

const isWin = process.platform === 'win32';

/** Directories where a Postgres install hides on each platform. */
function candidateBinDirs() {
  const out = [];
  const globs = [];

  if (process.platform === 'darwin') {
    // Homebrew, both architectures, newest version first.
    globs.push('/opt/homebrew/opt', '/usr/local/opt');
    for (const base of ['/opt/homebrew/opt', '/usr/local/opt']) {
      if (!existsSync(base)) continue;
      for (const name of readdirSync(base)) {
        if (/^postgresql(@\d+)?$/.test(name)) out.push(join(base, name, 'bin'));
      }
    }
    // Postgres.app, which is how a lot of Mac users actually have Postgres.
    const app = '/Applications/Postgres.app/Contents/Versions';
    if (existsSync(app)) {
      for (const v of readdirSync(app).sort().reverse()) out.push(join(app, v, 'bin'));
    }
  }

  if (process.platform === 'linux') {
    const base = '/usr/lib/postgresql';
    if (existsSync(base)) {
      for (const v of readdirSync(base).sort((a, b) => Number(b) - Number(a))) {
        out.push(join(base, v, 'bin'));
      }
    }
  }

  if (isWin) {
    for (const root of ['C:\\Program Files\\PostgreSQL', 'C:\\Program Files (x86)\\PostgreSQL']) {
      if (!existsSync(root)) continue;
      for (const v of readdirSync(root).sort().reverse()) out.push(join(root, v, 'bin'));
    }
  }

  void globs;
  return out;
}

const exe = (name) => (isWin ? `${name}.exe` : name);

/**
 * Locate initdb and pg_ctl, either on PATH or in a known install directory.
 * Both must come from the SAME installation — mixing versions fails in
 * confusing ways, so a directory is accepted only if it has both.
 */
export function findPostgres() {
  // On PATH first: if someone has deliberately put a Postgres there, that is
  // the one they mean.
  const onPath = spawnSync(exe('pg_ctl'), ['--version'], { stdio: 'pipe', shell: isWin });
  if (onPath.status === 0) {
    const initdb = spawnSync(exe('initdb'), ['--version'], { stdio: 'pipe', shell: isWin });
    if (initdb.status === 0) {
      return { initdb: exe('initdb'), pgCtl: exe('pg_ctl'), psql: exe('psql'), version: String(onPath.stdout).trim() };
    }
  }

  for (const dir of candidateBinDirs()) {
    const initdb = join(dir, exe('initdb'));
    const pgCtl = join(dir, exe('pg_ctl'));
    if (existsSync(initdb) && existsSync(pgCtl)) {
      const v = spawnSync(pgCtl, ['--version'], { stdio: 'pipe' });
      return { initdb, pgCtl, psql: join(dir, exe('psql')), version: String(v.stdout).trim() };
    }
  }
  return null;
}

/** A port nothing is listening on. */
export function freePort(from = 5432, to = 5500) {
  return new Promise(async (resolve) => {
    for (let p = from; p <= to; p++) {
      const free = await new Promise((r) => {
        const s = net.createServer();
        s.once('error', () => r(false));
        s.once('listening', () => s.close(() => r(true)));
        s.listen(p, '127.0.0.1');
      });
      if (free) return resolve(p);
    }
    resolve(null);
  });
}

/**
 * Start a Postgres owned by this project, in `.pgdata`, on its own port.
 *
 * Deliberately not the system's own cluster: this must not touch, upgrade or
 * conflict with a database the person already relies on. Its own data
 * directory and its own port mean uninstalling is deleting a folder.
 */
export async function startLocalPostgres(pgBin, root, log = console.log) {
  const dataDir = join(root, '.pgdata');
  const logFile = join(root, '.pgdata.log');

  // Postgres refuses to run as root, which is a sensible refusal but a fatal
  // one in a container. Nothing can be done about it here except say so.
  if (!isWin && typeof process.getuid === 'function' && process.getuid() === 0) {
    return { ok: false, error: 'Postgres refuses to run as root. Run this as a normal user.' };
  }

  if (!existsSync(dataDir)) {
    log('  Creating a database for this project (first run only) …');
    const init = spawnSync(pgBin.initdb, ['-D', dataDir, '-U', 'postgres', '--auth=trust', '-E', 'UTF8'], {
      stdio: 'pipe', encoding: 'utf8',
    });
    if (init.status !== 0) {
      return { ok: false, error: `initdb failed: ${(init.stderr || init.stdout || '').trim().split('\n').pop()}` };
    }
  }

  // Is one already running from a previous launch?
  //
  // Asked with `pg_ctl status` rather than inferred from a failed start. A
  // start against a live server exits non-zero complaining that the lock file
  // exists — which reads as a failure and is not one, and pattern-matching
  // that message was wrong on the second launch every time.
  const status = spawnSync(pgBin.pgCtl, ['-D', dataDir, 'status'], { stdio: 'pipe', encoding: 'utf8' });
  const pidFile = join(dataDir, 'postmaster.pid');

  if (status.status === 0) {
    // Line 4 of postmaster.pid is the port it actually bound. Read it rather
    // than assume, or we would hand back a URL to a server on another port.
    const running = Number((readFileSync(pidFile, 'utf8').split('\n')[3] ?? '').trim());
    if (Number.isFinite(running) && running > 0) {
      return { ok: true, url: urlFor(running), port: running, dataDir, reused: true };
    }
  } else if (existsSync(pidFile)) {
    // Not running, but a pid file is lying around — the usual result of the
    // machine being shut down without stopping the server. Left in place it
    // blocks every future start.
    try { unlinkSync(pidFile); } catch { /* it may already be gone */ }
  }

  const port = await freePort();
  if (!port) return { ok: false, error: 'no free port between 5432 and 5500' };

  // Loopback only. This is a personal tool holding your buying positions; it
  // has no business listening on a network interface.
  const start = spawnSync(
    pgBin.pgCtl,
    ['-D', dataDir, '-l', logFile, '-o', `-p ${port} -k "${dataDir}" -h 127.0.0.1`, '-w', '-t', '60', 'start'],
    { stdio: 'pipe', encoding: 'utf8' },
  );

  if (start.status !== 0) {
    const tail = existsSync(logFile)
      ? readFileSync(logFile, 'utf8').trim().split('\n').slice(-3).join('\n  ')
      : `${start.stderr ?? ''}`.trim();
    return { ok: false, error: `could not start Postgres.\n  ${tail}` };
  }

  return { ok: true, url: urlFor(port), port, dataDir };
}

const urlFor = (port) => `postgres://postgres@127.0.0.1:${port}/postgres`;

/** Stop a project-owned Postgres. */
export function stopLocalPostgres(pgBin, root) {
  const dataDir = join(root, '.pgdata');
  if (!existsSync(join(dataDir, 'postmaster.pid'))) return;
  spawnSync(pgBin.pgCtl, ['-D', dataDir, '-m', 'fast', 'stop'], { stdio: 'pipe' });
}

/**
 * Persist the chosen URL so every other script in the project agrees with the
 * launcher about which database it is talking to.
 */
export function writeDatabaseUrl(root, url) {
  const envPath = join(root, '.env.local');
  const line = `DATABASE_URL=${url}`;
  if (!existsSync(envPath)) {
    writeFileSync(envPath, `${line}\n`);
    return;
  }
  const text = readFileSync(envPath, 'utf8');
  if (text.includes(line)) return;
  if (/^\s*DATABASE_URL\s*=/m.test(text)) {
    writeFileSync(envPath, text.replace(/^\s*DATABASE_URL\s*=.*$/m, line));
  } else {
    appendFileSync(envPath, `${text.endsWith('\n') ? '' : '\n'}${line}\n`);
  }
}

/** The command that would install Postgres here, if there is an obvious one. */
export function installer() {
  if (process.platform === 'darwin' && spawnSync('brew', ['--version'], { stdio: 'pipe' }).status === 0) {
    return { name: 'Homebrew', cmd: 'brew', args: ['install', 'postgresql@16'] };
  }
  if (process.platform === 'linux' && spawnSync('apt-get', ['--version'], { stdio: 'pipe' }).status === 0) {
    return { name: 'apt', cmd: 'sudo', args: ['apt-get', 'install', '-y', 'postgresql'] };
  }
  if (isWin && spawnSync('winget', ['--version'], { stdio: 'pipe', shell: true }).status === 0) {
    return { name: 'winget', cmd: 'winget', args: ['install', '-e', '--id', 'PostgreSQL.PostgreSQL.16'] };
  }
  return null;
}
