/**
 * The shared-FQDN route ownership contract, asserted once for all three Cores.
 *
 * `classifyCorePath` decides which requests to `jp.umaxica.{app,com,org}` reach
 * Rails, which reach the application, and which reach neither. It is duplicated in three
 * `src/lib/core-dispatch.ts` copies, deliberately — `CLAUDE.md` forbids
 * extracting a shared module — and until this file existed nothing checked that
 * the three agreed. Each Core's own `test/core-dispatch.test.ts` covers its own
 * copy against its own table, which is exactly the shape of test that lets three
 * tables drift apart in lockstep with three implementations.
 *
 * So the table below is the contract, held once, and every Core is measured
 * against it by CALLING it — not by reading its source. A copy that returns the
 * right answers is correct however it is written; a copy that reads identically
 * and behaves differently is not, and only execution can tell the difference.
 *
 * The paths where Edge and Rails both have a route are the interesting rows. They
 * are intentional Edge overrides, recorded in
 * `adr/009-rails-health-entrypoint-and-dispatch-operability.md` and in the
 * comment block at the top of each `core-dispatch.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import * as appCore from '../app/core/src/lib/core-dispatch';
import { classifyRailsRouteClass } from '../app/core/src/lib/rails-dispatch-log';
import * as comCore from '../com/core/src/lib/core-dispatch';
import * as orgCore from '../org/core/src/lib/core-dispatch';

const repoRoot = join(import.meta.dirname, '..');
const read = (relativePath: string) => readFileSync(join(repoRoot, relativePath), 'utf8');

const CORES = [
  { brand: 'app', module: appCore },
  { brand: 'com', module: comCore },
  { brand: 'org', module: orgCore },
] as const;

type Ownership = 'rails' | 'blocked' | 'next';

/**
 * The contract. `why` is only present where a reader would otherwise assume the
 * row is an oversight.
 */
const OWNERSHIP: ReadonlyArray<{ path: string; owner: Ownership; why?: string }> = [
  // --- Rails-owned, prefix matched -----------------------------------------
  { path: '/api/v0/session', owner: 'rails' },
  { path: '/api/v0', owner: 'rails' },
  {
    path: '/api/v0/health.json',
    owner: 'next',
    why: 'Edge self-health JSON; remaining /api/v0/* stay Rails',
  },
  {
    path: '/api/v0/revision.json',
    owner: 'next',
    why: 'Edge Workers version metadata; remaining /api/v0/* stay Rails',
  },
  { path: '/web/v0/thing', owner: 'rails' },
  { path: '/web/v0', owner: 'rails' },
  { path: '/edge/v0/widgets', owner: 'rails' },
  { path: '/edge/v0', owner: 'rails' },
  { path: '/oidc/callback', owner: 'rails' },
  { path: '/oidc', owner: 'rails' },

  // --- Rails-owned, exact matched ------------------------------------------
  { path: '/sign/out', owner: 'rails' },
  { path: '/sign/out/complete', owner: 'rails' },
  { path: '/.well-known/jwks.json', owner: 'rails' },
  { path: '/csp-violation-report', owner: 'rails' },

  // --- Intentional Edge overrides of paths Rails also serves ---------------
  {
    path: '/health',
    owner: 'next',
    why: 'Edge text/plain aggregate; Rails also serves /health',
  },
  {
    path: '/health/startups',
    owner: 'next',
    why: 'Kubernetes startupProbe; Edge-owned, not Rails JSON',
  },
  {
    path: '/health/livenesses',
    owner: 'next',
    why: 'Kubernetes livenessProbe; Edge-owned, not Rails JSON',
  },
  {
    path: '/health/readinesses',
    owner: 'next',
    why: 'Kubernetes readinessProbe; Edge-owned, not Rails JSON',
  },
  {
    path: '/health/liveness.json',
    owner: 'blocked',
    why: 'Rails serves it; a Rails-internal health namespace stays off the public FQDN',
  },
  { path: '/health/readiness.json', owner: 'blocked', why: 'as above' },
  { path: '/health/startup.json', owner: 'blocked', why: 'as above' },
  { path: '/health/anything', owner: 'blocked', why: 'the whole namespace, not named paths' },
  { path: '/robots.txt', owner: 'next', why: 'Rails serves it; Edge owns the crawler contract' },
  { path: '/sitemap.xml', owner: 'next', why: 'Rails serves it; Edge owns the crawler contract' },
  {
    path: '/configuration',
    owner: 'next',
    why: 'present on BOTH sides for org — a known collision, recorded not resolved',
  },

  // --- Default, and near-misses that must not be swept into a prefix -------
  { path: '/', owner: 'next' },
  { path: '/rails-health', owner: 'next', why: 'merged into /health; no handler answers it now' },
  { path: '/apiv0-lookalike', owner: 'next' },
  { path: '/api/v0extra', owner: 'next' },
  { path: '/healthz', owner: 'next' },
];

describe('route ownership contract', () => {
  it.each(OWNERSHIP)('$path is owned by $owner', ({ path, owner }) => {
    for (const { brand, module } of CORES) {
      expect(module.classifyCorePath(path), `${brand}/core disagrees about ${path}`).toBe(owner);
    }
  });

  it('is exercised on every ownership value, so a table that lost a class fails', () => {
    const owners = new Set(OWNERSHIP.map((row) => row.owner));
    expect([...owners].sort()).toEqual(['blocked', 'next', 'rails']);
  });

  it('documents every row where Edge overrides a route Rails also serves', () => {
    // The reason these rows exist. A future reader must not be able to mistake
    // one for a path nobody thought about.
    const overrides = [
      '/health',
      '/health/startups',
      '/health/liveness.json',
      '/robots.txt',
      '/sitemap.xml',
      '/configuration',
    ];
    for (const path of overrides) {
      const row = OWNERSHIP.find((candidate) => candidate.path === path);
      expect(row, `${path} must stay in the contract table`).toBeDefined();
      expect(row?.why, `${path} must say why Edge keeps it`).toBeTruthy();
    }
  });

  it('keeps the exact /health path out of the /health/ block on every Core', () => {
    // BLOCKED is a raw `startsWith('/health/')`, so `/health` itself reaches the
    // application. The three Kubernetes probes are an allow-list; Rails JSON
    // and any other suffix still 404 before either side runs.
    for (const { brand, module } of CORES) {
      expect(module.classifyCorePath('/health'), brand).toBe('next');
      expect(module.classifyCorePath('/health/startups'), brand).toBe('next');
      expect(module.classifyCorePath('/health/livenesses'), brand).toBe('next');
      expect(module.classifyCorePath('/health/readinesses'), brand).toBe('next');
      expect(module.classifyCorePath('/health/'), brand).toBe('blocked');
      expect(module.classifyCorePath('/health/liveness.json'), brand).toBe('blocked');
    }
  });
});

describe('the three Cores stay one implementation', () => {
  /** Normalizes away the one line that differs by design: the public hostname. */
  const normalize = (source: string) => source.replace(/jp\.umaxica\.(app|com|org)/gu, 'jp.HOST');

  it('keeps core-dispatch.ts identical apart from the public hostname', () => {
    const digests = new Set(
      CORES.map(({ brand }) => normalize(read(`${brand}/core/src/lib/core-dispatch.ts`))),
    );
    expect(digests.size, 'the three dispatch modules have diverged').toBe(1);
  });

  it('keeps worker.ts byte-identical across all three', () => {
    // It names no brand precisely so this can hold: the hostname lives in
    // core-dispatch.ts, which is the file that legitimately differs.
    const digests = new Set(CORES.map(({ brand }) => read(`${brand}/core/src/worker.ts`)));
    expect(digests.size, 'the three worker entry points have diverged').toBe(1);
  });

  it('keeps rails-dispatch-log.ts byte-identical across all three', () => {
    const digests = new Set(
      CORES.map(({ brand }) => read(`${brand}/core/src/lib/rails-dispatch-log.ts`)),
    );
    expect(digests.size, 'the three dispatch loggers have diverged').toBe(1);
  });

  it('keeps the per-unit dispatch tests from drifting apart', () => {
    /*
     * Production sources were pinned above; the tests were not, and drifted. One
     * Core asserted five stripped forwarding headers and four preserved
     * application headers while the other two checked two headers and asserted no
     * preservation at all — so two Cores were a weaker gate on identical code.
     */
    for (const file of ['test/core-dispatch.test.ts', 'test/worker.test.ts']) {
      const digests = new Set(
        CORES.map(({ brand }) =>
          read(`${brand}/core/${file}`)
            .replace(/jp\.umaxica\.(app|com|org)/gu, 'jp.HOST')
            .replace(/(app|com|org)\/core/gu, 'BRAND/core'),
        ),
      );
      expect(digests.size, `${file} has diverged between the three Cores`).toBe(1);
    }
  });
});

describe('one Rails timeout budget per frame', () => {
  it('matches the dispatch timeout to the Rails client timeout, in every Core', () => {
    /*
     * `dispatchToRails` (browser → Rails) and `rails-client.ts` (server → Rails)
     * are separate on purpose — they forward opposite header sets — but there is
     * no reason for a frame to wait two different lengths of time for the same
     * Rails. Two constants that were meant to agree and silently stopped is the
     * failure this catches.
     */
    for (const { brand } of CORES) {
      const dispatch = /const RAILS_DISPATCH_TIMEOUT_MS = (\d+);/u.exec(
        read(`${brand}/core/src/lib/core-dispatch.ts`),
      )?.[1];
      const client = /const RAILS_FETCH_TIMEOUT_MS = (\d+);/u.exec(
        read(`${brand}/core/src/lib/rails-client.ts`),
      )?.[1];

      expect(dispatch, `${brand}/core declares no dispatch timeout`).toBeDefined();
      expect(client, `${brand}/core declares no client timeout`).toBeDefined();
      expect(dispatch, `${brand}/core waits two different lengths for one Rails`).toBe(client);
    }
  });

  it('bounds every dispatch with an abort signal rather than trusting the upstream', () => {
    for (const { brand } of CORES) {
      expect(read(`${brand}/core/src/lib/core-dispatch.ts`)).toContain(
        'AbortSignal.timeout(RAILS_DISPATCH_TIMEOUT_MS)',
      );
    }
  });
});

describe('log route classes cover the ownership table', () => {
  it('gives every Rails-owned path a class of its own, never the catch-all', () => {
    /*
     * `rails-dispatch-log.ts` holds its own copy of the route table — importing
     * `core-dispatch.ts`'s constants would make the two modules circular, since
     * the dispatcher imports the logger. This is the assertion that keeps them
     * honest: a Rails-owned path that logs as `other` means the tables have
     * drifted, and the log has quietly lost the ability to tell one Rails surface
     * from another.
     */
    const railsPaths = OWNERSHIP.filter((row) => row.owner === 'rails').map((row) => row.path);
    expect(railsPaths.length).toBeGreaterThan(0);

    for (const path of railsPaths) {
      expect(classifyRailsRouteClass(path), `${path} logs as the catch-all`).not.toBe('other');
    }
  });

  it('never lets a non-Rails path claim a Rails route class', () => {
    for (const { path } of OWNERSHIP.filter((row) => row.owner !== 'rails')) {
      expect(classifyRailsRouteClass(path), `${path} claims a Rails route class`).toBe('other');
    }
  });

  it('keeps the class vocabulary small enough to aggregate', () => {
    const classes = new Set(OWNERSHIP.map((row) => classifyRailsRouteClass(row.path)));
    // Eight is the whole vocabulary; a class per path would defeat the point.
    expect(classes.size).toBeLessThanOrEqual(8);
  });
});

describe("Edge's own health does not depend on Rails being up", () => {
  it('keeps the apex workers Rails-blind', () => {
    // Already asserted in test/rails-connection-invariants.test.ts; restated here
    // only as the boundary of the merge. The apexes own the root domain and a
    // Rails outage must not reach them.
    for (const workspace of ['app/apex', 'com/apex', 'net/apex', 'org/apex']) {
      expect(read(`${workspace}/wrangler.jsonc`)).not.toContain('UMAXICA_APPS_EDGE_CF_WORKERS_VPC');
    }
  });

  it('keeps Core /health on the Health API consumer without proxying Rails JSON', () => {
    for (const { brand } of CORES) {
      const source = read(`${brand}/core/src/routes/health.ts`);
      expect(source).toContain('renderAggregateHealth');
      expect(source).toContain('checkRailsHealth');
      expect(source).not.toContain('checkRailsLiveness');
      expect(source).not.toContain('Response.json');
    }
  });
});
