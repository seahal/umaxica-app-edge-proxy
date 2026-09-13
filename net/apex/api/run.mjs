// Runs this unit's HTTP contract suite, and owns the server it needs.
//
// Hurl is a standalone binary with no equivalent of Playwright's `webServer`
// block, so something has to put a server in front of it. That something is
// this file, per unit, for the same reason every unit owns its own
// `vitest.config.ts` and `playwright.config.ts`: a suite that only runs from
// the repository root is not extractable, and `test/deployment-unit-boundaries.test.ts`
// exists to keep that from happening. The two constants below are the only
// lines that differ between the copies.
//
// It is not a third owner of process lifecycle. It reuses a server that is
// already listening and only starts one when nothing answers — the same
// contract as Playwright's `reuseExistingServer`, which is why `pnpm run dev`
// in another terminal still works exactly as it did.

import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = 5201;
const READY_PATH = '/health';
// An unmatched path every unit's Hurl suite hits. Astro's first compile of
// `404.astro` can answer 500 while `/health` is already 200; waiting on this
// path means the suite starts after that compile, not during it.
const WARM_PATH = '/__definitely_not_found__';

// Set EDGE_API_BASE to run the same files against a preview deployment. Nothing
// is spawned or torn down in that case: the target is not ours to manage.
const EXTERNAL_BASE = process.env['EDGE_API_BASE'];
const BASE = EXTERNAL_BASE ?? `http://localhost:${PORT}`;

// Matches the `webServer.timeout` every playwright.config.ts in this repository
// uses. A cold `vite dev` / `wrangler dev` is slow enough that a shorter budget
// reports a timeout where the real answer is "not finished compiling yet".
const READY_TIMEOUT_MS = 240_000;
const POLL_INTERVAL_MS = 500;

const unitDir = new URL('..', import.meta.url);

async function probe(path) {
  try {
    const response = await fetch(new URL(path, BASE), { signal: AbortSignal.timeout(2000) });
    // Drain so the connection is not held open across polls.
    await response.arrayBuffer();
    return response;
  } catch {
    return null;
  }
}

async function isListening() {
  // Any answer proves a server is on the port. A 404 or a 500 is still an
  // answer; asserting on the status is the suite's job, not the probe's.
  return (await probe(READY_PATH)) !== null;
}

async function isReady() {
  // Playwright waits for 2xx on `/health`. Match that, then wait until an
  // unmatched URL is no longer a 5xx compile miss.
  const health = await probe(READY_PATH);
  if (health === null || health.status < 200 || health.status >= 300) return false;
  const missing = await probe(WARM_PATH);
  return missing !== null && missing.status < 500;
}

function startServer() {
  // `detached` puts the server in its own process group. `vite dev` and
  // `wrangler dev` both fork children that outlive a bare `child.kill()`, and an
  // orphaned worker holding the port makes the NEXT run reuse a stale server.
  const server = spawn('pnpm', ['run', 'dev'], {
    cwd: unitDir,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Held rather than streamed: a passing run should not bury Hurl's report
  // under compiler output, but a server that dies has to be able to say why.
  let output = '';
  const capture = (chunk) => {
    output += chunk;
  };
  server.stdout.setEncoding('utf8').on('data', capture);
  server.stderr.setEncoding('utf8').on('data', capture);

  let exited = false;
  server.on('exit', () => {
    exited = true;
  });

  return { server, log: () => output, hasExited: () => exited };
}

async function stopServer(server) {
  if (server.exitCode !== null || server.signalCode !== null) return;
  const ended = new Promise((resolve) => {
    server.once('exit', resolve);
  });
  try {
    // Negative pid signals the whole process group — see `detached` above.
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    return;
  }
  const timedOut = Symbol('timed-out');
  if ((await Promise.race([ended, delay(5000, timedOut)])) === timedOut) {
    try {
      process.kill(-server.pid, 'SIGKILL');
    } catch {
      // Already gone between the check and the signal.
    }
  }
}

function runHurl() {
  return new Promise((resolve) => {
    // `hurl` resolves from this unit's node_modules/.bin: pnpm puts it on PATH
    // for a script run, which is why `test:api` must be invoked through pnpm and
    // not as a bare `node api/run.mjs`. The package providing it is
    // `@orangeopensource/hurl`; `test/deployment-unit-boundaries.test.ts` maps
    // the command word to that name so a unit cannot run a binary it does not
    // declare.
    //
    // `--jobs 1` turns off Hurl's default `--test` parallelism. Parallel files
    // all hit `WARM_PATH` at once and race Astro's first compile of 404.astro,
    // which answers 500 instead of 404. Playwright already uses `workers: 1`.
    const hurl = spawn('hurl', ['--test', '--jobs', '1', '--variable', `base=${BASE}`, 'api'], {
      cwd: unitDir,
      stdio: 'inherit',
    });
    hurl.on('error', (error) => {
      process.stderr.write(`could not run hurl: ${error.message}\n`);
      resolve(127);
    });
    hurl.on('exit', (code, signal) => {
      resolve(signal === null ? (code ?? 1) : 1);
    });
  });
}

async function waitUntilReady({ hasExited, log }) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (!(await isReady())) {
    if (hasExited()) {
      process.stderr.write(`the dev server exited before it answered\n${log()}`);
      return 1;
    }
    if (Date.now() > deadline) {
      process.stderr.write(
        `the dev server did not become ready (${READY_PATH} 2xx, ${WARM_PATH} not 5xx) within ${READY_TIMEOUT_MS / 1000}s\n${log()}`,
      );
      return 1;
    }
    await delay(POLL_INTERVAL_MS);
  }
  return 0;
}

async function main() {
  if (await isListening()) {
    process.stderr.write(`reusing the server already answering on ${BASE}\n`);
    return (await waitUntilReady({ hasExited: () => false, log: () => '' })) || runHurl();
  }

  if (EXTERNAL_BASE !== undefined) {
    // Starting a local dev server would silently test something other than what
    // was asked for.
    process.stderr.write(`nothing is answering on ${EXTERNAL_BASE} (EDGE_API_BASE)\n`);
    return 1;
  }

  process.stderr.write(`starting \`pnpm run dev\` on ${BASE}\n`);
  const { server, log, hasExited } = startServer();

  try {
    const ready = await waitUntilReady({ hasExited, log });
    if (ready !== 0) return ready;
    return await runHurl();
  } finally {
    await stopServer(server);
  }
}

process.exitCode = await main();
