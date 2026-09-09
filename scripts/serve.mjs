// Start the server, bound to somewhere it is safe to be.
//
//   npm run dev
//   npm start
//
// This exists for one line: `-H 127.0.0.1`.
//
// `next dev` and `next start` bind 0.0.0.0 by default — every interface, so
// the LAN, the VPN and any tunnel or port-forward. That is fine for a public
// deployment behind a password and wrong for a personal tool that decides
// whether to ask for one. It also cannot be checked from inside a request: a
// Host header saying "localhost" is written by whoever sent the request, so on
// a 0.0.0.0 bind anyone who can reach the port can claim to be local with one
// curl flag.
//
// So the bind is decided here, and passed on in APP_BIND so the app knows what
// was decided rather than inferring it. Loopback by default; override it
// deliberately, and if you do, the app will insist on APP_PASSWORD.

import { spawn } from 'node:child_process';
import net from 'node:net';

const mode = process.argv[2] === 'dev' ? 'dev' : 'start';
const bind = process.env.APP_BIND || '127.0.0.1';
const isLoopback = ['127.0.0.1', '::1', 'localhost'].includes(bind);
const wanted = Number(process.env.PORT || 3000);

if (!isLoopback && !process.env.APP_PASSWORD) {
  // Not fatal — the app refuses these requests itself — but said here, where
  // it is one line above the URL rather than a 503 discovered later.
  console.error(
    `\n  APP_BIND is ${bind}, so this will be reachable from your network.\n` +
      '  No APP_PASSWORD is set, so it will serve nothing until one is.\n',
  );
}

const free = (port) =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, isLoopback ? '127.0.0.1' : '0.0.0.0');
  });

let port = wanted;
while (port < wanted + 20 && !(await free(port))) port++;
if (port !== wanted) console.error(`  Port ${wanted} was busy, using ${port}.`);

const child = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['next', mode, '-H', bind, '-p', String(port)],
  { stdio: 'inherit', env: { ...process.env, APP_BIND: bind }, shell: process.platform === 'win32' },
);

child.on('exit', (code) => process.exit(code ?? 0));
