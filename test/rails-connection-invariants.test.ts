/**
 * Static guardrails for the Rails ↔ Edge connection.
 *
 * Two transports, one per bundler family:
 *
 * - The twelve TanStack Start public content cells reach Rails over one Cloudflare Workers VPC
 *   binding (`adr/005-rails-edge-workers-vpc-connection.md`, amended by
 *   `adr/006-development-workers-vpc-transport.md`), declared per tier that
 *   needs it — the top level (which IS production), `env.development` and
 *   `env.vpc`, never `env.test`.
 * - The three TanStack Start Cores reach Rails over the public internet with the
 *   Worker's own `fetch`, at the `RAILS_ORIGIN` var in their own
 *   `wrangler.jsonc` (`adr/018-core-rails-direct-internet.md`). They hold no VPC
 *   binding at all.
 *
 * Both send paths to Rails exactly as given, with no frame prefix, and the apex
 * workers hold no Rails dependency.
 *
 * Fifteen frames each own a copy of the client (deliberately — `CLAUDE.md`
 * forbids extracting a shared module), so the failure mode is drift: one copy
 * edited and the rest left behind, or a new frame added without a client at all.
 * Nothing at runtime notices either. These assertions read the files directly,
 * so they need no container and no Cloudflare credentials.
 *
 * `test/compose-tunnel-invariants.test.ts` already asserts the fifteen clients
 * exist and strip the `cf-access-client-*` headers; that is not repeated here.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readWranglerConfig as readWrangler } from '../tools/lib/wrangler-config.mjs';

const repoRoot = join(import.meta.dirname, '..');
const read = (relativePath: string) => readFileSync(join(repoRoot, relativePath), 'utf8');

const BRANDS = ['app', 'com', 'org'] as const;
const FRAMES = ['core', 'docs', 'news', 'help', 'info'] as const;
const APEX_WORKSPACES = ['app/apex', 'com/apex', 'net/apex', 'org/apex'] as const;

const VPC_BINDING = 'UMAXICA_APPS_EDGE_CF_WORKERS_VPC';

/** The fifteen frames that reach Rails, as `<brand>/<frame>` paths. */
const RAILS_FRAMES = BRANDS.flatMap((brand) =>
  FRAMES.map((frame) => ({ brand, frame, workspace: `${brand}/${frame}` })),
);

/*
 * Which bundler a frame builds through, read from disk rather than listed.
 *
 * Every frame builds with Vite today, so `isNextFrame` returns false for all
 * fifteen. The branch is kept because what is under test does not depend on it
 * — one Rails transport per frame, one `/health` that reports both halves,
 * credentials stripped outbound — and the bundler only decides where a file
 * sits, never what it has to say. See `adr/013-frames-tanstack-start.md`.
 */
function isNextFrame(workspace: string): boolean {
  return existsSync(join(repoRoot, workspace, 'next.config.ts'));
}

/** The twelve public content cells: TanStack Start, Rails over Workers VPC. */
function isVpcCell(workspace: string): boolean {
  return ['docs', 'help', 'info', 'news'].includes(workspace.split('/')[1] ?? '');
}

/** Where this frame answers `/health`, per bundler. */
function healthRouteOf(workspace: string): string {
  if (isNextFrame(workspace)) return `${workspace}/src/app/health/route.ts`;
  return `${workspace}/src/routes/health.ts`;
}

const NEXT_FRAMES = RAILS_FRAMES.filter(({ workspace }) => isNextFrame(workspace));
const VPC_CELLS = RAILS_FRAMES.filter(({ workspace }) => isVpcCell(workspace));
const VITE_FRAMES = RAILS_FRAMES.filter(
  ({ workspace }) => !isNextFrame(workspace) && !isVpcCell(workspace),
);

/**
 * Source with comments removed.
 *
 * These files explain what they deliberately do NOT do — probe readiness, publish
 * an `errorMessage` — by naming it. A plain `toContain` would then match the
 * explanation and fail on the very file that documents the invariant, so the
 * assertions below read code only.
 */
function code(relativePath: string): string {
  return read(relativePath)
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/\/\/.*$/gmu, '');
}

/** Read a `const NAME = <value>;` declaration out of a client copy. */
function readConstant(source: string, name: string): string | undefined {
  return new RegExp(`const ${name} = (.+);`, 'u').exec(source)?.[1];
}

/**
 * Read the `TIMEZONE_AWARE_TIMESTAMP` regex literal, which `readConstant`
 * cannot: it is declared over two lines, and the pattern itself contains the
 * `;` and `=` that a single-line reader keys on.
 */
function readTimestampPattern(source: string): string | undefined {
  return /const TIMEZONE_AWARE_TIMESTAMP =\s*(\/.+\/u);/u.exec(source)?.[1];
}

interface WranglerVars {
  vars?: Record<string, unknown>;
}

/** A Core's `RAILS_ORIGIN` at one tier, `undefined` when that tier names none. */
function railsOriginAt(workspace: string, tier: 'top' | 'local' | 'development' | 'test') {
  const { config } = readWrangler(`${workspace}/wrangler.jsonc`);
  const block: WranglerVars | undefined = tier === 'top' ? config : config?.env?.[tier];
  return block?.vars?.['RAILS_ORIGIN'];
}

describe('rails client layout', () => {
  it.each(RAILS_FRAMES)('$workspace owns a complete Rails surface', ({ workspace }) => {
    // A frame with a client but no surface exposes nothing; a surface with no
    // client fails to compile. Both halves must be present in every frame.
    for (const file of [
      `${workspace}/src/lib/rails-client.ts`,
      `${workspace}/src/lib/rails-health.ts`,
    ]) {
      expect(existsSync(join(repoRoot, file)), `missing ${file}`).toBe(true);
    }
  });

  it.each(RAILS_FRAMES)(
    '$workspace reports Rails through /health, not /rails-health',
    ({ workspace }) => {
      /*
       * One shape across all fifteen frames — a Route Handler answering
       *
       *   { status, timestamp, edge: {...}, rails: { liveness: {...} } }
       *
       * 200 when both halves are ok and 503 otherwise.
       *
       * This used to be two routes. `/health` reported Edge alone and
       * `/rails-health` reported Rails alone, so neither could answer whether the
       * surface as a whole was serving — and `/health` collided by name with
       * Rails' own `/health` while `core-dispatch.ts` blocks `/health/*` at the
       * edge, leaving Rails' health namespace unreachable through the public FQDN.
       * The merge is `adr/009-rails-health-entrypoint-and-dispatch-operability.md`.
       *
       * Both former shapes are asserted absent, not merely unmentioned: an HTML
       * status page (removed earlier; `docs/design/rails-health-page.md` records
       * what it did) and the JSON Route Handler that replaced it.
       */
      const health = healthRouteOf(workspace);
      const route = `${workspace}/src/app/rails-health/route.ts`;
      const page = `${workspace}/src/app/(page)/rails-health/page.tsx`;

      expect(existsSync(join(repoRoot, health)), `${health} is missing`).toBe(true);
      expect(existsSync(join(repoRoot, route)), `${route} was merged into /health`).toBe(false);
      expect(existsSync(join(repoRoot, page)), `${page} must not come back per-frame`).toBe(false);
    },
  );

  /*
   * Byte-identity within each bundler family.
   *
   * The failure mode it exists to catch is drift between owned copies: one
   * edited, the rest left behind, with nothing at runtime noticing.
   */
  it('keeps public content cell /health on the Rails Health API consumer, not a JSON proxy', () => {
    for (const { workspace } of VPC_CELLS) {
      const source = code(healthRouteOf(workspace));
      expect(source, `${workspace} must consume rails-health`).toContain('checkRailsHealth');
      expect(source, `${workspace} must not proxy Rails JSON`).not.toContain('Response.json');
      expect(source, `${workspace} must not use the retired liveness probe`).not.toContain(
        'checkRailsLiveness',
      );
    }
  });

  it('keeps TanStack Core /health on the Rails Health API consumer, not a JSON proxy', () => {
    for (const { workspace } of VITE_FRAMES) {
      const source = code(healthRouteOf(workspace));
      expect(source, `${workspace} must consume rails-health`).toContain('checkRailsHealth');
      expect(source, `${workspace} must not proxy Rails JSON`).not.toContain('Response.json');
      expect(source, `${workspace} must not use the retired liveness probe`).not.toContain(
        'checkRailsLiveness',
      );
    }
  });

  it('keeps /health routes byte-identical within each bundler family', () => {
    expect(RAILS_FRAMES.length).toBe(15);
    expect(new Set(VITE_FRAMES.map(({ workspace }) => read(healthRouteOf(workspace)))).size).toBe(
      1,
    );
    expect(new Set(VPC_CELLS.map(({ workspace }) => read(healthRouteOf(workspace)))).size).toBe(
      1,
    );
  });

  /*
   * Both families must still be accounted for, even when one is empty: a frame
   * that owns neither an App Router health route nor a TanStack one would
   * silently drop out of every assertion in this file.
   */
  it('places every frame in exactly one bundler family', () => {
    expect(
      [...NEXT_FRAMES, ...VITE_FRAMES, ...VPC_CELLS].map(({ workspace }) => workspace).sort(),
    ).toEqual(RAILS_FRAMES.map(({ workspace }) => workspace).sort());
  });

  it('keeps all fifteen Rails health probes byte-identical', () => {
    // This one really is all fifteen: `rails-health.ts` imports only a type from
    // the client, so it is transport- and bundler-agnostic.
    const digests = new Set(
      RAILS_FRAMES.map(({ workspace }) => read(`${workspace}/src/lib/rails-health.ts`)),
    );
    expect(digests.size, 'the fifteen rails-health copies have diverged').toBe(1);
  });

  it('probes exactly the Rails Health API, never the operational JSON probes', () => {
    /*
     * Rails split operational Kubernetes probes (`/health`, `/health/livenesses`,
     * …) from the machine-facing Health API (`/api/v0/health.json`). Edge
     * verifies Rails against that API only. ADR 016.
     */
    for (const { workspace } of RAILS_FRAMES) {
      const source = code(`${workspace}/src/lib/rails-health.ts`);
      expect(source).toContain("const RAILS_HEALTH_API_PATH = '/api/v0/health.json';");
      expect(source).toContain('checkRailsHealth');
      expect(source, `${workspace} must not probe Rails operational JSON`).not.toContain(
        '/health/liveness.json',
      );
      expect(source, `${workspace} must not probe Rails operational JSON`).not.toContain(
        '/health/readiness.json',
      );
      expect(source, `${workspace} must not probe Rails operational JSON`).not.toContain(
        '/health/startup.json',
      );
      expect(source, `${workspace} must not keep the retired helper`).not.toContain(
        'checkRailsLiveness',
      );
    }
  });

  it('never exposes an internal error string through the public health document', () => {
    /*
     * The public shape used to carry `errorMessage`, fed by `rails-client.ts`'s
     * `getErrorMessage(error)` — i.e. an arbitrary exception string on a public
     * endpoint. `rails-client.ts` keeps it internally, on purpose, so this is
     * asserted on the two files that actually serialize a response.
     */
    for (const { workspace } of RAILS_FRAMES) {
      for (const file of [
        'src/lib/rails-health.ts',
        healthRouteOf(workspace).slice(workspace.length + 1),
      ]) {
        const source = code(`${workspace}/${file}`);
        expect(source, `${workspace}/${file} must not publish errorMessage`).not.toContain(
          'errorMessage',
        );
      }
    }
  });

  it.each(VPC_CELLS)('$workspace sends its own Rails host', ({ brand, frame, workspace }) => {
    /*
     * Each frame addresses its own Rails entry point, and the host is how.
     *
     * Workers VPC does not route on it — one VPC Service and one tunnel serve
     * all twelve — but the host becomes the `Host` header, and Rails dispatches
     * on that to `<Frame>::<Brand>::…`. Measured 2026-08-10 through a single
     * Service: `core.com.localhost` answered from `Core::Com::…`,
     * `docs.app.localhost` from `Docs::App::…`.
     *
     * So a wrong host here does not fail: it quietly reaches the wrong
     * namespace and answers 200. That is why this is pinned per frame rather
     * than left to review.
     */
    const origin = readConstant(
      read(`${workspace}/src/lib/publishing-cell.ts`),
      'PRIVATE_RAILS_ORIGIN',
    );
    expect(origin, `${workspace} must address ${frame}.${brand}`).toBe(
      `'http://${frame}.${brand}.localhost:3000'`,
    );
  });

  it('agrees on the timeout budget across all fifteen copies', () => {
    // Unlike the origin, this one *is* meant to be identical everywhere;
    // divergence means a copy was edited in isolation.
    const timeouts = new Set(
      RAILS_FRAMES.map(({ workspace }) =>
        readConstant(read(`${workspace}/src/lib/rails-client.ts`), 'RAILS_FETCH_TIMEOUT_MS'),
      ),
    );
    expect(timeouts.size, 'the fifteen timeout budgets have diverged').toBe(1);
    expect([...timeouts][0]).toBeDefined();
  });

  it('keeps Access credentials and public fallback origins out of every application runtime', () => {
    for (const { workspace } of RAILS_FRAMES) {
      const config = read(`${workspace}/wrangler.jsonc`);
      const source = read(`${workspace}/src/lib/rails-client.ts`);
      const example = read(`${workspace}/.env.example`);
      for (const name of [
        'PUBLIC_CORE_ACCESS_CLIENT_ID',
        'PUBLIC_CORE_ACCESS_CLIENT_SECRET',
        'PUBLIC_CORE_RAILS_ORIGIN',
      ]) {
        expect(config, `${workspace}/wrangler.jsonc must not carry ${name}`).not.toContain(name);
        expect(source, `${workspace} must not consume ${name}`).not.toContain(name);
        expect(example, `${workspace}/.env.example must not advertise ${name}`).not.toContain(name);
      }
    }
  });

  it('requires both the private-network overlay and the local Node marker', () => {
    for (const { workspace } of VPC_CELLS) {
      const source = read(`${workspace}/src/lib/rails-client.ts`);
      const pkg = JSON.parse(read(`${workspace}/package.json`)) as {
        scripts?: { dev?: string };
      };

      expect(source).toContain("readLocalFlag('EDGE_LOCAL_NODE_RUNTIME') === '1'");
      expect(source).toContain("readLocalFlag('EDGE_LOCAL_RAILS_ENABLED') === '1'");
      /*
       * The marker has to be set by the dev script itself, whatever the dev
       * server is. It is what tells the client it may take the direct transport
       * rather than look for a VPC binding.
       */
      expect(pkg.scripts?.dev).toMatch(/^EDGE_LOCAL_NODE_RUNTIME=1 /u);
    }
  });

  it('sends no path prefix — Rails routes on the path exactly as given', () => {
    /*
     * ADR 005 decision 3 assumed frames would identify themselves to Rails with
     * a `/{frame}/{brand}` prefix, and said openly that whether Rails wanted
     * that was a question for the Rails repository. It did not: the first real
     * request over the VPC binding produced
     *
     *   ActionController::RoutingError (No route matches [GET] "/docs/app/health/liveness.json")
     *
     * Rails serves health paths unprefixed. ADR 006 records the retraction.
     *
     * This is a regression guard rather than a style rule. A prefix
     * reintroduced here would not fail loudly — it would produce 404s, which
     * `checkRailsHealth` reports as `http-error`, which reads like a Rails
     * outage rather than a client bug.
     */
    for (const { workspace } of RAILS_FRAMES) {
      const source = read(`${workspace}/src/lib/rails-client.ts`);

      expect(source, `${workspace} must not reintroduce a frame prefix`).not.toContain(
        'RAILS_FRAME_PREFIX',
      );
      expect(source, `${workspace} must not reintroduce prefix plumbing`).not.toContain(
        'pathPrefix',
      );
      expect(source, `${workspace} must build the URL from the path alone`).toContain(
        'new URL(path,',
      );
    }
  });
});

describe('the three Cores reach Rails at RAILS_ORIGIN', () => {
  /*
   * `adr/018-core-rails-direct-internet.md`. The Cores talk to Rails over the
   * public internet with the Worker's own `fetch`; the origin is a per-tier var,
   * never a constant in code.
   */
  it.each(VITE_FRAMES)(
    '$workspace keeps env.local credential-free and Rails-free by default',
    ({ workspace }) => {
      // `pnpm test:api`, Playwright and CI run without Rails and wait for
      // `/health` 2xx. A configured but unreachable Rails reports readiness
      // error and answers 503, so the local loop opts in through `.dev.vars`.
      expect(railsOriginAt(workspace, 'local')).toBeUndefined();
    },
  );

  it.each(VITE_FRAMES)(
    '$workspace documents its own Rails host for the local opt-in',
    ({ brand, workspace }) => {
      // Rails dispatches on the Host header to `Core::<Brand>::…`, so a Core
      // pointed at a sibling brand's host would reach the wrong namespace and
      // still answer 200.
      expect(read(`${workspace}/.dev.vars.example`)).toMatch(
        new RegExp(`^# RAILS_ORIGIN=http://core\\.${brand}\\.localhost:3000$`, 'mu'),
      );
    },
  );

  it.each(VITE_FRAMES)(
    '$workspace names no plain-http Rails origin on a deployed tier',
    ({ workspace }) => {
      // The browser's Cookie and Authorization headers ride this hop.
      for (const tier of ['top', 'development'] as const) {
        const origin = railsOriginAt(workspace, tier);
        if (origin !== undefined) {
          expect(origin, `${workspace} ${tier} must use https`).toMatch(/^https:\/\//u);
        }
      }
    },
  );

  it.each(VITE_FRAMES)('$workspace gives env.test no Rails origin', ({ workspace }) => {
    // A test tier that can reach a real Rails is not a test tier.
    expect(railsOriginAt(workspace, 'test')).toBeUndefined();
  });

  it.each(VITE_FRAMES)('$workspace holds no Workers VPC binding or tier', ({ workspace }) => {
    const { config } = readWrangler(`${workspace}/wrangler.jsonc`);
    expect(read(`${workspace}/wrangler.jsonc`)).not.toContain(VPC_BINDING);
    expect(Object.keys(config?.env ?? {})).not.toContain('vpc');
  });

  it.each(VITE_FRAMES)(
    '$workspace has one transport, with no local-only branch',
    ({ workspace }) => {
      const pkg = JSON.parse(read(`${workspace}/package.json`)) as {
        scripts?: Record<string, string>;
      };
      expect(code(`${workspace}/src/lib/rails-client.ts`)).not.toContain('EDGE_LOCAL');
      expect(code(`${workspace}/src/lib/rails-client.ts`)).toContain('RAILS_ORIGIN');
      expect(code(`${workspace}/vite.config.ts`)).not.toContain('EDGE_LOCAL');
      expect(pkg.scripts?.dev).not.toContain('EDGE_LOCAL');
      expect(pkg.scripts).not.toHaveProperty('dev:vpc');
    },
  );
});

describe('apex workers stay independent of Rails', () => {
  // The apex workers own the root domain. They used to proxy Rails health, and
  // a Rails outage therefore surfaced as a failing apex. That coupling was
  // removed on purpose; this guards against it creeping back.
  it.each(APEX_WORKSPACES)('%s holds no Rails client or VPC binding', (workspace) => {
    for (const file of ['src/rails-client.ts', 'src/rails-health.ts']) {
      expect(existsSync(join(repoRoot, workspace, file)), `${workspace}/${file} returned`).toBe(
        false,
      );
    }

    expect(read(`${workspace}/wrangler.jsonc`)).not.toContain(VPC_BINDING);
  });
});

describe('workers vpc bindings', () => {
  /*
   * Where the binding may live on the twelve public content cells, asserted from the
   * parsed config rather than from where a string happens to sit in the file.
   *
   * wrangler does NOT inherit bindings into `env` blocks, so every tier that
   * needs one declares its own — and `env.test` deliberately declares none: a
   * test tier that can reach a real Rails is not a test tier.
   *
   * The top level IS production, and during the AWS bootstrap it points at the
   * *development* VPC Service on purpose. See
   * `adr/006-development-workers-vpc-transport.md` and the
   * `vpcProductionServiceId` note in `tools/workers-manifest.json`.
   *
   * `tools/check-workers.mjs` enforces the same table; this is the belt to its
   * braces.
   */
  const manifest = JSON.parse(read('tools/workers-manifest.json')) as {
    vpcBinding: string;
    vpcDevelopmentServiceId: string;
    vpcProductionServiceId: string;
  };

  interface VpcEntry {
    binding: string;
    service_id: string;
    remote?: boolean;
  }

  const bindingsAt = (workspace: string, path: 'top' | 'development' | 'vpc' | 'test') => {
    const { config } = readWrangler(`${workspace}/wrangler.jsonc`);
    const entries: VpcEntry[] =
      path === 'top' ? (config?.vpc_services ?? []) : (config?.env?.[path]?.vpc_services ?? []);
    return entries.filter((entry) => entry.binding === VPC_BINDING);
  };

  it.each(VPC_CELLS)(
    '$workspace binds production to the bootstrap VPC service, without remote',
    ({ workspace }) => {
      /*
       * `remote: true` is a local-development flag — it makes wrangler proxy the
       * binding out to Cloudflare instead of simulating it locally, and has no
       * effect on a deployed Worker
       * (https://developers.cloudflare.com/workers/development-testing/#remote-bindings).
       * Production is asserted not to carry it, so the key never reads as though
       * it were doing something on the deployed path.
       */
      const declared = bindingsAt(workspace, 'top');
      expect(
        declared,
        `${workspace} top level (production) must bind ${VPC_BINDING} once`,
      ).toHaveLength(1);
      expect(declared[0]?.service_id).toBe(manifest.vpcProductionServiceId);
      expect(declared[0]?.remote, 'production must not set remote: true').not.toBe(true);
    },
  );

  it.each(VPC_CELLS)(
    '$workspace keeps env.vpc on the remote development binding',
    ({ workspace }) => {
      const declared = bindingsAt(workspace, 'vpc');
      expect(declared, `${workspace} env.vpc must bind ${VPC_BINDING} once`).toHaveLength(1);
      expect(declared[0]?.service_id).toBe(manifest.vpcDevelopmentServiceId);
      expect(declared[0]?.remote, 'local workerd cannot simulate a VPC Service').toBe(true);
    },
  );

  it.each(VPC_CELLS)(
    '$workspace gives env.development the remote binding too',
    ({ workspace }) => {
      /*
       * The ordinary development loop reaches Rails over the real transport rather
       * than over a Node-only path that shares nothing with production.
       *
       * The property this gives up is the one ADR 006 decision 1 was protecting:
       * `pnpm dev` and `pnpm preview` no longer work without an interactive
       * `wrangler login`. That is not a side effect of `remote: true` being
       * *chosen* here — wrangler classifies a VPC Service as a resource with no
       * local simulator, so resolving this environment opens a remote proxy
       * session either way, and that session rejects API-token authentication.
       */
      const declared = bindingsAt(workspace, 'development');
      expect(declared, `${workspace} env.development must bind ${VPC_BINDING} once`).toHaveLength(
        1,
      );
      expect(declared[0]?.service_id).toBe(manifest.vpcDevelopmentServiceId);
      expect(declared[0]?.remote).toBe(true);
    },
  );

  it.each(VPC_CELLS)(
    '$workspace keeps the Node transport independent of the binding',
    ({ workspace }) => {
      /*
       * A wrangler binding is not something a plain Node dev process can hold,
       * so the two transports must stay separately gated. `env.development`
       * having a binding does not make the local flags redundant: they select a
       * different transport, in a runtime that has no bindings at all.
       */
      const source = read(`${workspace}/src/lib/rails-client.ts`);
      expect(source).toContain("readLocalFlag('EDGE_LOCAL_NODE_RUNTIME') === '1'");
      expect(source).toContain("readLocalFlag('EDGE_LOCAL_RAILS_ENABLED') === '1'");
    },
  );

  it.each(RAILS_FRAMES)('$workspace gives env.test no VPC binding', ({ workspace }) => {
    expect(bindingsAt(workspace, 'test')).toHaveLength(0);
  });

  it.each(RAILS_FRAMES)('$workspace has no env.production at all', ({ workspace }) => {
    /*
     * A wrangler environment deploys to `<name>-<env>`, so an `env.production`
     * has to re-declare `name` purely to cancel that out. The top level is
     * production instead, and `wrangler deploy` with no `--env` deploys it.
     */
    const { config, error } = readWrangler(`${workspace}/wrangler.jsonc`);
    expect(error).toBeUndefined();
    expect(Object.keys(config?.env ?? {})).not.toContain('production');
  });

  it('points every public content cell at the same service per tier', () => {
    /*
     * One development Rails, so one VPC service shared by all twelve surfaces.
     * Written as an assertion so a divergence — a surface left on an old service
     * after a migration — fails loudly.
     */
    for (const tier of ['top', 'vpc'] as const) {
      const ids = new Set(
        VPC_CELLS.map(({ workspace }) => bindingsAt(workspace, tier)[0]?.service_id),
      );
      expect(ids.size, `the twelve ${tier} service_ids have diverged`).toBe(1);
    }
  });

  it('keeps the AWS cutover a one-line change, and records that it has not happened', () => {
    /*
     * The two ids are separate manifest fields, so the cutover is: provision the
     * production VPC Service, change `vpcProductionServiceId` and the twelve
     * top-level `service_id`s, and the equality below simply stops holding.
     * Nothing in `src/` participates — `getRailsClient()` selects the VPC
     * transport by the presence of the runtime binding, never by an environment
     * name.
     */
    expect(manifest.vpcProductionServiceId, 'the manifest must name a production id').toBeDefined();

    if (manifest.vpcProductionServiceId === manifest.vpcDevelopmentServiceId) {
      // Bootstrap: still true today, and the assertions above already pin every
      // surface to it. Stated here so the state is recorded rather than implied.
      expect(manifest.vpcDevelopmentServiceId).toBeTruthy();
      return;
    }

    // Post-cutover: production has left the development tunnel, and no surface
    // may be left behind on it.
    for (const { workspace } of VPC_CELLS) {
      expect(
        bindingsAt(workspace, 'top')[0]?.service_id,
        `${workspace} was left on the development VPC service after the AWS cutover`,
      ).not.toBe(manifest.vpcDevelopmentServiceId);
    }
  });
});

describe('vpc probe', () => {
  const probe = read('tools/vpc-probe/probe.mjs');

  it('covers every VPC surface, at the destination that surface requests', () => {
    /*
     * The probe is the only evidence `check:vpc` reports, and it imports no
     * application code by design — so nothing links its destinations to the
     * surfaces' own. That independence is the point (a green `/health` is
     * consistent with a broken binding), but it also means the two can drift
     * apart silently: the probe would answer 200 for hosts the surfaces never
     * address, and the acceptance run would call the transport proven.
     *
     * Reconstructed here from the twelve public content cells rather than repeated, so
     * the expectation cannot be updated by editing this file alone. The Cores
     * are absent on purpose: they do not use Workers VPC (ADR 018).
     */
    const targets = [
      ...read('tools/vpc-probe/probe.mjs').matchAll(/\{ key: '([^']+)', url: '([^']+)' \}/gu),
    ].map(([, key, url]) => ({ key, url }));

    const expected = VPC_CELLS.map(({ brand, frame, workspace }) => {
      const origin = readConstant(
        read(`${workspace}/src/lib/publishing-cell.ts`),
        'PRIVATE_RAILS_ORIGIN',
      );
      const path = readConstant(
        read(`${workspace}/src/lib/rails-health.ts`),
        'RAILS_HEALTH_API_PATH',
      );
      return {
        key: `${brand.toUpperCase()}/${frame.toUpperCase()}`,
        url: `${origin?.slice(1, -1)}${path?.slice(1, -1)}`,
      };
    });

    expect(targets, 'probe targets drifted from the surfaces').toEqual(expected);
  });

  it('never lets request input select a destination', () => {
    /*
     * A fixed list of module constants is what keeps this Worker from becoming
     * a way to fetch an arbitrary URL from inside the private network. The
     * handler does read its request, but only to answer readiness — every call
     * to the binding must pass a target's own url and nothing derived from the
     * caller.
     */
    const destinations = [...probe.matchAll(/binding\.fetch\(([^,)]+)/gu)].map(([, arg]) =>
      arg.trim(),
    );
    expect(destinations, 'the binding must only be called with a target url').toEqual(['url']);

    expect(probe, 'readiness must not touch the binding').toContain(
      "new URL(request.url).pathname === '/ready'",
    );
  });
});

describe('local Rails connectivity script', () => {
  it('verifies the Health API, not operational JSON probes', () => {
    const script = read('scripts/check-rails');
    expect(script).toContain('/api/v0/health.json');
    expect(script).not.toContain('/health/liveness.json');
    expect(script).toContain('Rails reached, status=fail');
    expect(script).toContain('unreachable');
  });

  it.each(['scripts/check-rails', 'tools/verify-edge-connectivity.mjs'])(
    '%s requires the same Health API fields the Worker requires',
    (sibling) => {
      /*
       * Three implementations of the ADR 016 contract, in three places, reached by
       * three transports: the Worker, `scripts/check-rails` over `podman exec` +
       * `curl`, and the connectivity checker over a remote-binding probe. That is
       * deliberate — an operator needs a second opinion when the Worker is the
       * thing under suspicion — and it is exactly the arrangement where one side
       * is tightened and the others are not.
       *
       * `timestamp` became required on 2026-09-06 and is the field that proved it:
       * it landed in the fifteen copies alone. So the required set is pinned
       * across all three, rather than each being asserted against its own idea of
       * the contract.
       */
      const source = read(sibling);
      const client = read('app/core/src/lib/rails-health.ts');

      for (const field of ['status', 'timestamp', 'startup', 'liveness', 'readiness']) {
        expect(source, `${sibling} must require ${field}`).toContain(field);
        expect(client, `rails-health.ts must require ${field}`).toContain(field);
      }

      expect(readTimestampPattern(source), `${sibling} has no timestamp pattern`).toBe(
        readTimestampPattern(client),
      );
    },
  );
});
