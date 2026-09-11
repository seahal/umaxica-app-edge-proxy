#!/usr/bin/env node
// Connectivity acceptance check for the Edge development network.
//
// Run from the repo root: node tools/verify-edge-connectivity.mjs <mode>
// (or `pnpm run check:connectivity`). See docs/operations/connectivity-acceptance.md.
//
// The point of this tool is that the paths it tests are NOT interchangeable:
//
//   next (dev server) `vite dev`, in workerd. It binds no VPC Service: each
//                     unit's vite.config.ts passes `remoteBindings: false`
//                     outside the `vpc` tier, so the Rails half of /health here
//                     can never be VPC evidence. `next` is the mode's CLI name
//                     and nothing more.
//   preview           local workerd, `--env development`. No binding either.
//   preview:vpc       local workerd, `--env vpc`. The real remote binding.
//   vpc (this tool)   the binding alone, with no application code in the way.
//
// `/health`'s Rails half in the dev server can prove only the explicitly enabled
// private Podman path. It is never accepted as VPC or Tunnel evidence. Those
// paths have their own checks and no transport falls back to another.

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  describeServiceIdProblem,
  loadManifest,
  readWranglerConfig,
  repoRoot,
} from './lib/wrangler-config.mjs';

export const PASS = 'PASS';
export const WARN = 'WARN';
export const FAIL = 'FAIL';
export const BLOCKED = 'BLOCKED';
export const SKIP = 'SKIP';

export const MODES = [
  'config',
  'vpc',
  'next',
  'preview',
  'preview:vpc',
  'host',
  'links',
  'tunnel',
  'tunnel:apex',
  'all',
];

// `host` is excluded from `all` on purpose: it is meaningless inside the
// container, which is where `all` is run. `tunnel` is excluded for a different
// reason: it needs hostnames someone configured in Cloudflare, so it would
// report sixteen failures on a machine that never set the tunnel up.
const ALL_MODES = ['config', 'vpc', 'next', 'preview', 'preview:vpc'];

const LOG_DIR = join(repoRoot, 'tmp/connectivity-check');
const PROBE_PORT = Number(process.env.VPC_PROBE_PORT ?? 8799);
// wrangler's default port, kept as the base because `preview:vpc` runs on it
// unmodified; every parallel `preview` gets an explicit `--port` above it.
const PREVIEW_PORT = 8787;

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

/**
 * Every Rails-backed surface — all fifteen `{app,com,org}/{core,docs,news,help,
 * info}` frames, taken whole from tools/workers-manifest.json.
 *
 * Ports come from each workspace's own `dev` script, and the shape of each frame
 * (does it have `/health`?) is **derived from the files on disk**, never from a
 * hard-coded list of cores. Add `/health` to a new frame and it starts being
 * checked without touching this tool; that is the property that stops the
 * checker drifting from the repo.
 */
/*
 * Every workspace that owns a Rails transport, whichever bundler builds it.
 *
 * The two Rails-backed classes differ in exactly one thing this checker cares
 * about — where the `/health` route file sits on disk — and in nothing about the
 * connection they are checking. Merging them here is what keeps the gate
 * counting every Rails-backed frame rather than silently skipping a class.
 */
export function railsBackedWorkspaces(manifest = loadManifest()) {
  return [
    ...manifest.railsBacked,
    ...(manifest.railsBackedVite ?? []),
    ...(manifest.railsBackedAstro ?? []),
  ].sort((a, b) => a.localeCompare(b));
}

/*
 * Where `/health` lives. A frame answers it from a server route colocated with
 * the page routes; the other entry is the shape the bundler guards elsewhere
 * describe. Read from disk rather than asserted from the manifest, so a frame
 * that loses the route is a FAIL here rather than a silent skip: a Rails-backed
 * frame with no `/health` cannot report the connection at all.
 */
const HEALTH_ROUTE_PATHS = [
  'src/app/health/route.ts',
  'src/routes/health.ts',
  'src/pages/health.ts',
];

export function loadSurfaces(manifest = loadManifest()) {
  return railsBackedWorkspaces(manifest).map((ws) => {
    const [brand, frame] = ws.split('/');
    const pkg = JSON.parse(readFileSync(join(repoRoot, ws, 'package.json'), 'utf8'));
    const port = Number(/--port\s+(\d+)/u.exec(pkg.scripts?.dev ?? '')?.[1]);
    if (!Number.isInteger(port)) {
      throw new Error(`${ws}: could not read a --port from its dev script`);
    }

    /*
     * All fifteen answer `/health`, and that one route carries both halves —
     * Edge's own state and Rails' liveness. It replaced `/rails-health`, which
     * used to report the Rails half separately; two routes meant two requests
     * per frame per run and neither could answer "is this surface serving?".
     * See ADR 009.
     *
     * Read from disk rather than asserted from the manifest, so a frame that
     * loses the route is a FAIL here rather than a silent skip: a Rails-backed
     * frame with no `/health` has no way to report the connection at all.
     */
    const hasHealthRoute = HEALTH_ROUTE_PATHS.some((candidate) =>
      existsSync(join(repoRoot, ws, candidate)),
    );

    return {
      key: `${brand.toUpperCase()}/${frame.toUpperCase()}`,
      brand,
      frame,
      ws,
      pkgName: pkg.name,
      port,
      hasHealthRoute,
    };
  });
}

/**
 * The sixteen surfaces published through the Rails-shared Cloudflare Tunnel:
 * the four Hono apex workers plus the twelve non-core content frames.
 *
 * The `core` frames are excluded deliberately, not incidentally. `jp.umaxica.{app,com,org}`
 * is a shared FQDN where Rails owns some paths and the frame the rest, so it needs
 * path-level ingress rather than a whole-host route, and it is a separate piece
 * of work. `dev/apex` is excluded too: `umaxica.dev` is not delegated to
 * Cloudflare DNS, so there is no Cloudflare-side hostname for the Tunnel to
 * publish it on, even though the unit now deploys to Workers like the rest.
 *
 * Ports come from each workspace's own `dev` script, the same way `loadSurfaces`
 * does it, so they cannot drift from what actually listens.
 */
export function loadTunnelSurfaces(manifest = loadManifest()) {
  const workspaces = [
    ...manifest.standalone.map((ws) => ({ ws, runtime: 'hono' })),
    ...railsBackedWorkspaces(manifest)
      .filter((ws) => !ws.endsWith('/core'))
      .map((ws) => ({ ws, runtime: 'frame' })),
  ];

  return workspaces.map(({ ws, runtime }) => {
    const [brand, frame] = ws.split('/');
    const pkg = JSON.parse(readFileSync(join(repoRoot, ws, 'package.json'), 'utf8'));
    const port = Number(/--port\s+(\d+)/u.exec(pkg.scripts?.dev ?? '')?.[1]);
    if (!Number.isInteger(port)) {
      throw new Error(`${ws}: could not read a --port from its dev script`);
    }

    return {
      key: `${brand.toUpperCase()}/${frame.toUpperCase()}`,
      brand,
      frame,
      ws,
      pkgName: pkg.name,
      port,
      runtime,
      host: tunnelHostFor(brand, frame),
      // What proves THIS application answered, as opposed to merely something
      // answering with a 200. Apex reports it directly; the content frames only
      // differ from each other by this one string.
      marker:
        runtime === 'hono'
          ? { kind: 'apex-service', value: brand }
          : { kind: 'html', value: `UMAXICA ${frame[0].toUpperCase()}${frame.slice(1)}` },
    };
  });
}

/**
 * The published hostname for a frame, derived from the project's naming policy.
 *
 * The policy, which is CURRENT and deliberate — not legacy:
 *
 *   apex              umaxica.<brand>
 *   info              info.umaxica.<brand>        (global surface, no region)
 *   docs/news/help    <frame>-jp.umaxica.<brand>  (regional, ONE label)
 *
 * `docs-jp` is a single subdomain label on purpose: nesting it as
 * `docs.jp.umaxica.<brand>` would add a certificate level, and development and
 * staging deliberately avoid that cost. Do not "normalise" the hyphen form.
 * Core is the sole exception and uses `jp.umaxica.<brand>`; it is not published
 * here. See docs/operations/cloudflare-tunnel-development.md.
 *
 * `EDGE_TUNNEL_HOSTS` overrides any of it, as `app/docs=example.test,...`, so a
 * developer on their own hostnames does not have to patch this file.
 */
export function tunnelHostFor(brand, frame, env = process.env) {
  const overrides = new Map(
    (env.EDGE_TUNNEL_HOSTS ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => entry.split('=').map((part) => part.trim())),
  );
  const override = overrides.get(`${brand}/${frame}`);
  if (override) return override;

  if (frame === 'apex') return `umaxica.${brand}`;
  if (frame === 'info') return `info.umaxica.${brand}`;
  return `${frame}-jp.umaxica.${brand}`;
}

/**
 * The Rails origin a frame will send in local development.
 *
 * An Astro surface names it as `PRIVATE_RAILS_ORIGIN` in its rails-client copy.
 * A Core names it as the opt-in `RAILS_ORIGIN=` line in its `.dev.vars.example`
 * instead — the Cores reach Rails over the public internet at a per-tier var,
 * not over Workers VPC (ADR 018).
 */
export function readRailsOrigin(ws) {
  const source = readFileSync(join(repoRoot, ws, 'src/lib/rails-client.ts'), 'utf8');
  const constant = /PRIVATE_RAILS_ORIGIN\s*=\s*'([^']+)'/u.exec(source)?.[1];
  if (constant) return constant;
  const examplePath = join(repoRoot, ws, '.dev.vars.example');
  if (!existsSync(examplePath)) return null;
  return /^#?\s*RAILS_ORIGIN=(\S+)$/mu.exec(readFileSync(examplePath, 'utf8'))?.[1] ?? null;
}

/** Whether a surface reaches Rails over Workers VPC. The Cores do not (ADR 018). */
export function isVpcSurface(surface, manifest = loadManifest()) {
  return (manifest.railsBackedAstro ?? []).includes(surface.ws);
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export class Report {
  constructor() {
    this.rows = new Map(); // gate -> Map(surfaceKey -> {status, detail})
    this.notes = [];
  }

  record(gate, surfaceKey, status, detail = '') {
    if (!this.rows.has(gate)) this.rows.set(gate, new Map());
    this.rows.get(gate).set(surfaceKey, { status, detail });
  }

  note(status, message) {
    this.notes.push({ status, message });
  }

  get(gate, surfaceKey) {
    return this.rows.get(gate)?.get(surfaceKey);
  }

  hasFailure() {
    for (const row of this.rows.values()) {
      for (const cell of row.values()) {
        if (cell.status === FAIL) return true;
      }
    }
    return this.notes.some((n) => n.status === FAIL);
  }
}

/**
 * Every gate must name every surface. A gate that silently omits one would read
 * as "covered" when it was not; SKIP is allowed, silence is not.
 */
export function findMissingCells(report, surfaceKeys) {
  const missing = [];
  for (const [gate, row] of report.rows) {
    for (const key of surfaceKeys) {
      if (!row.has(key)) missing.push(`${gate}/${key}`);
    }
  }
  return missing;
}

// ---------------------------------------------------------------------------
// VPC failure classification
// ---------------------------------------------------------------------------

// Cloudflare documents the exact codes a VPC fetch() throws. Match on those
// rather than inventing categories, and never collapse them to "network error".
// https://developers.cloudflare.com/workers-vpc/reference/troubleshooting/
const TRANSPORT_CODES = [
  ['dns_error', 'Tunnel/private origin', 'the origin hostname did not resolve on the Rails side'],
  ['connection_refused', 'Tunnel/private origin', 'nothing is listening behind the tunnel'],
  ['connection_terminated', 'Tunnel/private origin', 'the origin closed the connection'],
  ['destination_unavailable', 'Tunnel/private origin', 'the tunnel could not reach the origin'],
  [
    'destination_not_found',
    'Tunnel/private origin',
    'the VPC Service has no reachable destination',
  ],
  ['tls_certificate_error', 'Tunnel/private origin', 'the origin TLS certificate was rejected'],
  ['http_response_incomplete', 'Rails', 'the origin returned a truncated response'],
  ['connection_read_timeout', 'Tunnel/private origin', 'the origin accepted but never answered'],
  ['connection_timeout', 'Workers VPC', 'the connection attempt timed out'],
  ['connection_limit_reached', 'Workers VPC', 'the VPC Service hit its connection limit'],
  ['rate_limited', 'Workers VPC', 'the request was rate limited'],
];

/**
 * Turn a probe result (plus wrangler's own output) into a transport verdict and
 * the layer responsible. `transport` answers only "did the request leave over
 * the binding and arrive"; a 404 from Rails means it did.
 */
export function classifyProbeOutcome({ probe, wranglerOutput = '' } = {}) {
  const output = wranglerOutput.toLowerCase();

  if (
    output.includes('remote session could not be authenticated') ||
    output.includes('10405') ||
    output.includes('method not allowed for this authentication scheme')
  ) {
    return {
      transport: BLOCKED,
      layer: 'Wrangler auth',
      detail:
        'an API token cannot open a remote-binding session — run `wrangler login`, and check the root .env is excluded via --env-file',
    };
  }
  if (output.includes('not logged in') || output.includes('you are not authenticated')) {
    return { transport: BLOCKED, layer: 'Wrangler auth', detail: 'no Cloudflare session' };
  }
  if (/vpc service .*not found|could not find vpc service|service_id/u.test(output)) {
    return {
      transport: FAIL,
      layer: 'Binding',
      detail: 'Cloudflare rejected the configured service_id',
    };
  }

  if (!probe) {
    return {
      transport: FAIL,
      layer: 'Wrangler',
      detail: 'the probe worker produced no response — see the log',
    };
  }

  if (probe.probe === 'binding-missing') {
    return {
      transport: FAIL,
      layer: 'Binding',
      detail: 'the VPC binding was not present in the Worker env',
    };
  }

  if (probe.probe === 'transport-error') {
    const haystack = `${probe.message ?? ''} ${probe.cause ?? ''}`.toLowerCase();
    for (const [code, layer, detail] of TRANSPORT_CODES) {
      if (haystack.includes(code)) {
        return { transport: FAIL, layer, detail: `${code}: ${detail}`, code };
      }
    }
    if (/timeout|aborted|timederror/u.test(haystack)) {
      return { transport: FAIL, layer: 'Workers VPC', detail: 'timed out with no documented code' };
    }
    return {
      transport: FAIL,
      layer: 'Workers VPC',
      detail: `unrecognised transport error: ${probe.message ?? 'unknown'}`,
    };
  }

  if (probe.probe === 'reached') {
    const status = probe.status;

    // Workers VPC does NOT throw when the origin is unreachable. It answers
    // with an ordinary HTTP 500 whose body is `ProxyError: <documented code>`:
    //
    //   status 500, text/plain, "ProxyError: connection_refused"   (Rails down)
    //
    // Measured 2026-08-09 by stopping Rails. Taking that at face value would
    // report "Rails answered 500" when Rails answered nothing at all — the tunnel
    // did — which is exactly the layer confusion this tool exists to prevent.
    // Checked before the status, because the status alone cannot distinguish it.
    const proxyError = /ProxyError:\s*([a-z_]+)/iu.exec(probe.body ?? '')?.[1];
    if (proxyError) {
      const known = TRANSPORT_CODES.find(([code]) => code === proxyError);
      return {
        transport: FAIL,
        layer: known?.[1] ?? 'Tunnel/private origin',
        detail: `${proxyError}: ${known?.[2] ?? 'the VPC service could not reach the origin'} (returned as HTTP ${status}, not thrown)`,
        code: proxyError,
        status,
      };
    }

    if (status === 200) {
      return { transport: PASS, layer: null, detail: 'Rails answered 200', status };
    }
    // The request demonstrably arrived, so the transport is proven either way.
    // ADR 006's first verified run ended exactly here, on a 404.
    if (status === 404) {
      return {
        transport: PASS,
        layer: 'Rails',
        detail: 'transport reached Rails, but Rails has no route for the health path (404)',
        status,
      };
    }
    return {
      transport: PASS,
      layer: 'Rails',
      detail: `transport reached Rails, which answered ${status}`,
      status,
    };
  }

  return {
    transport: FAIL,
    layer: 'Wrangler',
    detail: `unrecognised probe result: ${probe.probe}`,
  };
}

/**
 * Decide whether the Rails entry point this frame addresses is the one that
 * answered.
 *
 * `Direct VPC → Rails` cannot answer this. One VPC Service carries all fifteen
 * frames and routing comes wholly from the Service record, so the `Host` header
 * — taken from `PRIVATE_RAILS_ORIGIN` in application code — is the only thing
 * selecting a namespace. A wrong host therefore does not fail: it reaches a
 * different namespace and answers 200, which every transport-level gate reads
 * as success.
 *
 * Rails reports the namespace it dispatched to as `<frame>/<brand>`, so that
 * misroute becomes visible here and nowhere else.
 *
 * A missing `namespace` is WARN, not FAIL: nothing is known to be wrong, but
 * the identity is unproven, and the two must not be reported as the same thing.
 */
export function classifyIdentity({ surface, entry, transport }) {
  if (transport !== PASS) {
    return { status: BLOCKED, detail: 'transport did not arrive, so identity is unproven' };
  }
  if (entry?.status !== 200) {
    return {
      status: BLOCKED,
      detail: `Rails answered ${entry?.status}, so identity is unproven`,
    };
  }

  let document = null;
  try {
    document = JSON.parse(entry.body ?? '');
  } catch {
    document = null;
  }
  if (document === null || typeof document !== 'object') {
    return {
      status: FAIL,
      detail: 'Rails answered 200 but the body is not a JSON liveness document',
    };
  }

  const expected = `${surface.frame}/${surface.brand}`;
  const actual = document.namespace;

  if (typeof actual !== 'string' || actual.length === 0) {
    return {
      status: WARN,
      detail: `no namespace field, so the answering entry point is unproven (expected ${expected})`,
    };
  }
  if (actual !== expected) {
    return { status: FAIL, detail: `answered from ${actual}, expected ${expected}` };
  }
  return { status: PASS, detail: `answered from ${actual}` };
}

/*
 * Kept identical to `TIMEZONE_AWARE_TIMESTAMP` in the fifteen
 * `src/lib/rails-health.ts` copies, and pinned as such by
 * `test/rails-connection-invariants.test.ts`.
 */
const TIMEZONE_AWARE_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

const HEALTH_STATUSES = new Set(['pass', 'warn', 'fail']);

const isHealthCheck = (value) =>
  typeof value === 'object' && value !== null && HEALTH_STATUSES.has(value.status);

/**
 * Decide whether the document Rails answered with is one the Worker will accept.
 *
 * `Direct VPC → Rails` and `VPC identity` both stop short of this. The first
 * proves a request arrived, the second proves which namespace answered — and a
 * document that is byte-for-byte unusable to `rails-health.ts` passes both,
 * because it arrives, from the right namespace, with HTTP 200.
 *
 * That gap is not hypothetical. ADR 016's 2026-09-06 amendment made
 * `timestamp` a required field, and a Rails build that does not emit it makes
 * every frame report `invalid-contract` → readiness `error` → `/health` 503,
 * while this tool would otherwise print two green columns. A checker that
 * disagrees with the runtime about whether the connection works is worse than
 * no checker, so the required-field set is asserted here, against the same
 * document, in the same run.
 *
 * This reads the contract only. Whether Rails is *healthy* is `status`, and
 * that is `Direct VPC → Rails`'s business, not this gate's — a `503` carrying a
 * well-formed `status=fail` document is a contract PASS.
 */
export function classifyHealthContract({ entry, transport }) {
  if (transport !== PASS) {
    return { status: BLOCKED, detail: 'transport did not arrive, so the contract is unproven' };
  }
  if (entry?.status !== 200 && entry?.status !== 503) {
    return {
      status: BLOCKED,
      detail: `Rails answered ${entry?.status}, which is not the Health API contract`,
    };
  }

  let document = null;
  try {
    document = JSON.parse(entry.body ?? '');
  } catch {
    document = null;
  }
  if (document === null || typeof document !== 'object') {
    return { status: FAIL, detail: 'the body is not a JSON Health API document' };
  }

  const missing = [];
  if (!HEALTH_STATUSES.has(document.status)) missing.push('status');
  if (
    typeof document.timestamp !== 'string' ||
    !TIMEZONE_AWARE_TIMESTAMP.test(document.timestamp) ||
    Number.isNaN(Date.parse(document.timestamp))
  ) {
    missing.push('timestamp');
  }
  for (const name of ['startup', 'liveness', 'readiness']) {
    if (!isHealthCheck(document.checks?.[name])) missing.push(`checks.${name}`);
  }

  if (missing.length > 0) {
    return {
      status: FAIL,
      detail: `rails-health.ts would report invalid-contract — ${missing.join(', ')}`,
    };
  }
  return { status: PASS, detail: `status=${document.status}, all required fields present` };
}

// ---------------------------------------------------------------------------
// /health parsing
// ---------------------------------------------------------------------------

/*
 * One shape across all twenty units: `/health` answers `text/plain`
 *
 *   status: ok
 *   startup: ok
 *   liveness: ok
 *   readiness: ok
 *
 * with HTTP 200 iff all three probes are ok. `startup` and `liveness` are the
 * isolate; `readiness` is the Rails half on the fifteen frames and isolate-only
 * on the five apex workers, which stay Rails-blind (ADR 016 decision 5).
 *
 * It answered a JSON document with a nested `rails.liveness.kind` until ADR 016
 * moved the probes to `text/plain`. Nothing here reads that shape any more.
 */

/**
 * The Rails half of a frame's `/health`, read from the `readiness:` line of the
 * `text/plain` aggregate — or null if the body is not that shape, which is
 * itself the signal for a stale deployed Worker still answering an older
 * document.
 *
 * This used to read `rails.liveness.kind` out of a JSON `/health` document.
 * That document is gone: ADR 016 moved the probes to `text/plain`, so the JSON
 * parser matched nothing, every caller took its `null` branch, and the Rails
 * half of three tiers had been reported as `SKIP — does not carry Rails` for
 * fifteen surfaces. It does carry Rails, on this line.
 *
 * `startup` and `liveness` are isolate-only and always `ok`; `readiness` is
 * `edgeReadinessFromRails(checkRailsHealth(...))` verbatim (`src/routes/health.ts`
 * and `src/pages/health.ts` in the fifteen frames). Reading it costs no request
 * that has not already been made.
 *
 * What it cannot do is name the kind. ADR 016 decision 4 maps `pass`, `warn`
 * **and** `not-configured` all onto `ok`, so `readiness: ok` proves the frame
 * is serving but cannot tell a healthy Rails from an absent binding. Callers
 * that need that distinction have to say which one they expected; none of them
 * may report a guess as a measurement.
 */
export function readEdgeReadiness(body) {
  if (typeof body !== 'string') return null;
  const readiness = /^readiness: (ok|error)$/mu.exec(body)?.[1];
  return readiness ?? null;
}

/**
 * `/health` promises 200 when every probe is `ok` and 503 otherwise. Checking it
 * costs nothing and catches a route handler that reports a healthy body under a
 * failing status, or the reverse.
 */
export function healthStatusMismatch(readiness, status) {
  const expected = readiness === 'ok' ? 200 : 503;
  return status === expected
    ? null
    : `readiness ${readiness} should answer ${expected}, answered ${status}`;
}

// ---------------------------------------------------------------------------
// Generated Cloudflare types
// ---------------------------------------------------------------------------

/**
 * The body of `interface <name> { … }`, found by matching braces rather than by
 * regex. A lazy regex terminated on the first `}` at any indentation silently
 * ran one interface into the next, which reported PreviewEnv's binding as
 * DevelopmentEnv's — a false FAIL that looked entirely plausible.
 */
export function extractInterfaceBlock(source, name) {
  const start = source.indexOf(`interface ${name}`);
  if (start === -1) return null;
  const open = source.indexOf('{', start);
  if (open === -1) return null;

  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Poll until `check()` resolves truthy or the deadline passes. Never a fixed
 * sleep: a fixed sleep is either slower than it needs to be or a flake.
 */
export async function waitFor(check, { timeoutMs, intervalMs = 500, onGiveUp } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (onGiveUp?.()) return { ok: false, reason: 'aborted' };
    try {
      if (await check()) return { ok: true };
    } catch {
      // keep polling; the server may not be up yet
    }
    if (Date.now() >= deadline) return { ok: false, reason: 'timeout' };
    await sleep(intervalMs);
  }
}

async function httpGet(url, timeoutMs = 15_000, headers) {
  const response = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
    ...(headers ? { headers } : {}),
  });
  // `headers` is additive: existing callers destructure status/body only. The
  // tunnel mode needs `cf-ray` to tell "Cloudflare answered" apart from
  // "something answered", which a status code alone cannot do.
  return { status: response.status, headers: response.headers, body: await response.text() };
}

function logStream(name) {
  mkdirSync(LOG_DIR, { recursive: true });
  const path = join(LOG_DIR, `${name}.log`);
  return { path, stream: createWriteStream(path, { flags: 'w' }) };
}

function tail(text, lines = 20) {
  return text.split('\n').slice(-lines).join('\n');
}

/**
 * Spawn a long-running child in its own process group and return a handle whose
 * stop() kills the whole group. `pnpm --filter` sits between us and next/wrangler,
 * so killing the direct child alone leaves the real server running.
 */
function startProcess(command, args, { name, env = {} }) {
  const { path, stream } = logStream(name);
  const child = spawn(command, args, {
    cwd: repoRoot,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });

  let output = '';
  const capture = (chunk) => {
    output += chunk;
    stream.write(chunk);
  };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);

  let exited = false;
  let exitCode = null;
  child.on('exit', (code) => {
    exited = true;
    exitCode = code;
  });

  const handle = {
    logPath: path,
    get output() {
      return output;
    },
    get exited() {
      return exited;
    },
    get exitCode() {
      return exitCode;
    },
    async stop() {
      if (!exited && child.pid) {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          // already gone
        }
        const stopped = await waitFor(() => exited, { timeoutMs: 8000, intervalMs: 200 });
        if (!stopped.ok && child.pid) {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            // already gone
          }
        }
      }
      stream.end();
    },
  };

  running.add(handle);
  return handle;
}

// Every child is registered here so the signal handlers below can reap them all.
// This is the trap: a failure or a Ctrl-C must not leave a dev server running.
const running = new Set();

async function stopAll() {
  await Promise.all([...running].map((handle) => handle.stop()));
  running.clear();
}

let cleaningUp = false;
// Declared once and registered twice rather than defined inside the loop: one
// handler closing over one `cleaningUp` is what makes the second signal a no-op.
const cleanUpAndExit = () => {
  if (cleaningUp) return;
  cleaningUp = true;
  void stopAll().finally(() => process.exit(130));
};
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, cleanUpAndExit);
}

// ---------------------------------------------------------------------------
// Toolchain
// ---------------------------------------------------------------------------

function run(command, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', (error) => resolve({ code: -1, stdout, stderr: String(error) }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function checkToolchain(report, surfaces) {
  const rootPackage = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  const pnpmVersion = rootPackage.devEngines?.packageManager?.version ?? null;
  let wranglerVersion = null;
  try {
    wranglerVersion = JSON.parse(
      readFileSync(join(repoRoot, 'node_modules/wrangler/package.json'), 'utf8'),
    ).version;
  } catch {
    // Reported below as a missing installed tool.
  }
  const versions = {
    node: process.version,
    pnpm: pnpmVersion,
    wrangler: wranglerVersion,
  };

  const problems = [];
  for (const [name, value] of Object.entries(versions)) {
    if (!value) problems.push(`${name} could not be executed`);
  }
  const line = Object.entries(versions)
    .map(([k, v]) => `${k} ${v ?? 'MISSING'}`)
    .join(', ');
  for (const surface of surfaces) {
    report.record(
      'Toolchain',
      surface.key,
      problems.length ? FAIL : PASS,
      problems.length ? problems.join('; ') : line,
    );
  }
  if (!problems.length) report.note(PASS, `Toolchain: ${line}`);
  return versions;
}

// ---------------------------------------------------------------------------
// Mode: config
// ---------------------------------------------------------------------------

async function readCloudflareAuth() {
  const result = await run('pnpm', ['exec', 'wrangler', 'whoami', '--json'], {
    CLOUDFLARE_ENV: '',
  });
  if (result.code !== 0) {
    return { loggedIn: false, kind: 'none', raw: result.stdout + result.stderr };
  }
  try {
    const json = JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));
    return {
      loggedIn: Boolean(json.loggedIn),
      kind: json.authType ?? 'unknown',
      email: json.email ?? null,
      raw: result.stdout,
    };
  } catch {
    // Fall back to the human-readable form rather than reporting a false negative.
    const text = result.stdout;
    return {
      loggedIn: text.includes('You are logged in'),
      kind: text.includes('API Token') ? 'API Token' : 'unknown',
      raw: text,
    };
  }
}

async function modeConfig(report, surfaces, manifest) {
  const checker = await run('node', ['tools/check-workers.mjs']);
  if (checker.code === 0) {
    report.note(PASS, `check-workers: ${checker.stdout.trim()}`);
  } else {
    report.note(FAIL, `check-workers failed:\n${tail(checker.stdout + checker.stderr, 20)}`);
  }

  const railsHosts = new Map();

  for (const surface of surfaces) {
    // The Cores reach Rails at `RAILS_ORIGIN` over the public internet and hold
    // no VPC binding (ADR 018); check-workers asserts that. Only their Rails
    // Host is checked below.
    if (!isVpcSurface(surface, manifest)) {
      const origin = readRailsOrigin(surface.ws);
      if (origin) railsHosts.set(surface.key, new URL(origin).host);
      report.record('VPC config', surface.key, SKIP, 'no Workers VPC — RAILS_ORIGIN (ADR 018)');
      continue;
    }

    const problems = [];
    const { config, error } = readWranglerConfig(join(surface.ws, 'wrangler.jsonc'));
    if (error) {
      problems.push(error);
    } else {
      const declared = (config.env?.vpc?.vpc_services ?? []).filter(
        (v) => v.binding === manifest.vpcBinding,
      );
      if (declared.length === 1) {
        const idProblem = describeServiceIdProblem(declared[0].service_id);
        if (idProblem) problems.push(idProblem);
        if (declared[0].remote !== true) problems.push('vpc_services must set remote: true');
      } else {
        problems.push(`env.vpc must declare ${manifest.vpcBinding} exactly once`);
      }
    }

    // The generated types are what the application actually compiles against,
    // so a binding present in wrangler.jsonc but absent here still fails at use.
    const typesPath = join(repoRoot, surface.ws, 'cloudflare-env.d.ts');
    if (existsSync(typesPath)) {
      const types = readFileSync(typesPath, 'utf8');
      const previewBlock = extractInterfaceBlock(types, 'VpcEnv');
      if (previewBlock === null) {
        problems.push('cloudflare-env.d.ts declares no VpcEnv — run cf-typegen');
      } else if (!previewBlock.includes(manifest.vpcBinding)) {
        problems.push(`cloudflare-env.d.ts VpcEnv does not declare ${manifest.vpcBinding}`);
      }
      const developmentBlock = extractInterfaceBlock(types, 'DevelopmentEnv');
      if (developmentBlock === null) {
        problems.push('cloudflare-env.d.ts declares no DevelopmentEnv — run cf-typegen');
      } else if (!developmentBlock.includes(manifest.vpcBinding)) {
        problems.push(`cloudflare-env.d.ts DevelopmentEnv does not declare ${manifest.vpcBinding}`);
      }
      // `test` is the one tier that must stay without a Rails transport.
      const testBlock = extractInterfaceBlock(types, 'TestEnv');
      if (testBlock?.includes(manifest.vpcBinding)) {
        problems.push(`cloudflare-env.d.ts TestEnv must not declare ${manifest.vpcBinding}`);
      }
    } else {
      problems.push('cloudflare-env.d.ts is missing — run cf-typegen');
    }

    const origin = readRailsOrigin(surface.ws);
    if (origin) {
      railsHosts.set(surface.key, new URL(origin).host);
    } else {
      problems.push('could not read PRIVATE_RAILS_ORIGIN from rails-client.ts');
    }

    report.record(
      'VPC config',
      surface.key,
      problems.length ? FAIL : PASS,
      problems.length ? problems.join('; ') : `env.vpc → ${manifest.vpcDevelopmentServiceId}`,
    );
  }

  // Rails entry-point routing.
  //
  // Rails dispatches to `<Frame>::<Brand>::…` on the Host header, and the Host
  // is whatever each frame's PRIVATE_RAILS_ORIGIN says. Workers VPC does not
  // route on it — one Service and one tunnel serve all fifteen — so a wrong
  // host does not fail. It reaches the wrong namespace and answers 200. That
  // is why this is checked here rather than left to the eye, and why it is no
  // longer opt-in: the staged single-host period ended 2026-08-10.
  const hosts = [...new Set(railsHosts.values())];
  for (const surface of surfaces) {
    const host = railsHosts.get(surface.key);
    const expected = `${surface.frame}.${surface.brand}.localhost:3000`;
    report.record(
      'Rails routing',
      surface.key,
      host === expected ? PASS : FAIL,
      host === expected ? host : `sends Host ${host}, expected ${expected}`,
    );
  }
  if (hosts.length === surfaces.length) {
    report.note(
      PASS,
      `Rails Host: ${surfaces.length} frames, ${hosts.length} distinct entry points`,
    );
  } else {
    report.note(
      FAIL,
      `Rails Host must be distinct per frame; ${surfaces.length} frames share ${hosts.length} hosts`,
    );
  }

  const auth = await readCloudflareAuth();
  report.note(
    auth.loggedIn ? PASS : BLOCKED,
    auth.loggedIn
      ? `Cloudflare auth: ${auth.kind}${auth.email ? ` (${auth.email})` : ''}`
      : 'Cloudflare auth: not authenticated',
  );

  // Isolation.
  let devService = null;
  if (auth.loggedIn) {
    const list = await run('pnpm', ['exec', 'wrangler', 'vpc', 'service', 'list'], {
      CLOUDFLARE_ENV: '',
    });
    if (list.code === 0 && list.stdout.includes(manifest.vpcDevelopmentServiceId)) {
      devService = manifest.vpcDevelopmentServiceId;
      report.note(PASS, `VPC Service ${devService} exists on the account`);
    } else {
      report.note(
        FAIL,
        `VPC Service ${manifest.vpcDevelopmentServiceId} was not found on the account`,
      );
    }
  } else {
    report.note(BLOCKED, 'VPC Service existence not checked — no Cloudflare session');
  }

  const productionServices = new Set();
  for (const ws of railsBackedWorkspaces(manifest)) {
    const { config } = readWranglerConfig(join(ws, 'wrangler.jsonc'));
    // The top level IS production — there is no `env.production`.
    for (const entry of config?.vpc_services ?? []) {
      productionServices.add(entry.service_id);
    }
  }

  report.note(
    PASS,
    `Development VPC Service: ${manifest.vpcDevelopmentServiceId}${devService ? ' (verified)' : ''}`,
  );
  report.note(
    productionServices.size ? PASS : FAIL,
    productionServices.size
      ? `Production VPC Service: ${[...productionServices].join(', ')}`
      : 'Production VPC Service: none — the top level (production) declares no binding, so deployed frames answer rails not-configured',
  );

  // Sharing one Service across the two tiers is the bootstrap topology, not a
  // misconfiguration: AWS production Rails does not exist, so the only way to
  // exercise the deployed edge → VPC → tunnel → Rails path is against local
  // Rails. It is reported as a WARN rather than a PASS because it is a state to
  // leave, and the risk it carries is real — production Rails connectivity is
  // only as available as a developer's machine. See ADR 006.
  const shared = [...productionServices].includes(manifest.vpcDevelopmentServiceId);
  if (shared) {
    report.note(
      manifest.vpcProductionServiceId === manifest.vpcDevelopmentServiceId ? WARN : FAIL,
      manifest.vpcProductionServiceId === manifest.vpcDevelopmentServiceId
        ? 'Environment isolation: BOOTSTRAP — production shares the development VPC Service, so deployed production Rails traffic terminates on a developer machine. Cut over by provisioning a production VPC Service and changing vpcProductionServiceId'
        : 'Environment isolation: a frame was left on the development VPC Service after the AWS cutover',
    );
  } else {
    report.note(PASS, 'Environment isolation: production and development share no service_id');
  }

  if (
    process.env.STRICT_ENV_ISOLATION === '1' &&
    manifest.vpcProductionServiceId === manifest.vpcDevelopmentServiceId
  ) {
    report.note(
      FAIL,
      'STRICT_ENV_ISOLATION: production still uses the bootstrap (development) VPC Service — expected once the production tunnel exists',
    );
  }

  report.note(
    PASS,
    `INFO: one VPC Service serves all ${railsBackedWorkspaces(manifest).length} frames, each addressing its own Rails entry point by Host`,
  );
}

// ---------------------------------------------------------------------------
// Mode: vpc — the direct transport probe
// ---------------------------------------------------------------------------

async function modeVpc(report, surfaces, manifest, { verbose }) {
  const auth = await readCloudflareAuth();
  if (!auth.loggedIn) {
    for (const surface of surfaces) {
      report.record('Direct VPC → Rails', surface.key, BLOCKED, 'no Cloudflare session');
    }
    report.note(BLOCKED, 'Direct VPC probe skipped — run `wrangler login`');
    return;
  }

  // CLOUDFLARE_API_TOKEN must be blanked AND the root .env kept out of wrangler's
  // reach: wrangler loads it itself and re-injects the token, and an API token
  // cannot open a remote-binding session at all. CLOUDFLARE_ENV is cleared
  // because the container exports it and the probe config has no environments.
  const worker = startProcess(
    'pnpm',
    [
      'exec',
      'wrangler',
      'dev',
      '--config',
      'tools/vpc-probe/wrangler.jsonc',
      '--env-file',
      'tools/vpc-probe/empty.env',
      '--ip',
      '127.0.0.1',
      '--port',
      String(PROBE_PORT),
    ],
    { name: 'vpc-probe', env: { CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_ENV: '' } },
  );

  let probe = null;
  try {
    const ready = await waitFor(
      // `/ready` answers without touching the binding. Polling `/` would run
      // the real probe on every attempt, sending fifteen requests to Rails per
      // poll — the same mistake `readinessUrl` documents for the `next` mode.
      async () => (await httpGet(`http://127.0.0.1:${PROBE_PORT}/ready`, 20_000)).status > 0,
      { timeoutMs: 120_000, onGiveUp: () => worker.exited },
    );

    if (ready.ok) {
      const response = await httpGet(`http://127.0.0.1:${PROBE_PORT}/`, 60_000);
      try {
        probe = JSON.parse(response.body);
      } catch {
        probe = null;
      }
    }
  } finally {
    await worker.stop();
  }

  const bindingLine = /env\.UMAXICA_APPS_EDGE_CF_WORKERS_VPC[^\n]*/u.exec(worker.output)?.[0];
  const entries = Array.isArray(probe?.results) ? probe.results : null;

  // No per-target results means the probe never got as far as fetching — the
  // binding was absent, wrangler could not authenticate, or the worker died.
  // One verdict then describes every surface, because one cause does.
  if (!entries) {
    const verdict = classifyProbeOutcome({ probe, wranglerOutput: worker.output });
    for (const surface of surfaces) {
      report.record(
        'Direct VPC → Rails',
        surface.key,
        verdict.transport,
        `${verdict.layer}: ${verdict.detail}`,
      );
      report.record('VPC identity', surface.key, BLOCKED, 'no response to identify');
      report.record('VPC contract', surface.key, BLOCKED, 'no response to check');
    }
    if (bindingLine) report.note(PASS, `Binding resolved: ${bindingLine.trim()}`);
    report.note(verdict.transport, `Layer ${verdict.layer}: ${verdict.detail}`);
    report.note(SKIP, `full log: ${worker.logPath}`);
    return;
  }

  let misrouted = 0;
  let unidentified = 0;
  let unusable = 0;

  for (const surface of surfaces) {
    const entry = entries.find((candidate) => candidate.key === surface.key);
    if (!entry) {
      report.record('Direct VPC → Rails', surface.key, FAIL, 'the probe carries no target for it');
      report.record('VPC identity', surface.key, BLOCKED, 'not probed');
      report.record('VPC contract', surface.key, BLOCKED, 'not probed');
      continue;
    }

    const verdict = classifyProbeOutcome({ probe: entry, wranglerOutput: worker.output });
    report.record(
      'Direct VPC → Rails',
      surface.key,
      verdict.transport,
      verdict.transport === PASS
        ? `${verdict.detail} (shared VPC Service ${manifest.vpcDevelopmentServiceId})`
        : `${verdict.layer}: ${verdict.detail}`,
    );

    const identity = classifyIdentity({ surface, entry, transport: verdict.transport });
    report.record('VPC identity', surface.key, identity.status, identity.detail);
    if (identity.status === FAIL) misrouted += 1;
    if (identity.status === WARN) unidentified += 1;

    const contract = classifyHealthContract({ entry, transport: verdict.transport });
    report.record('VPC contract', surface.key, contract.status, contract.detail);
    if (contract.status === FAIL) unusable += 1;

    if (verdict.transport === PASS && verdict.layer === 'Rails' && verdict.status !== 200) {
      report.note(FAIL, `Rails layer [${surface.key}]: ${verdict.detail}`);
    }
    if (verdict.transport !== PASS) {
      report.note(verdict.transport, `Layer ${verdict.layer} [${surface.key}]: ${verdict.detail}`);
    }
  }

  if (bindingLine) report.note(PASS, `Binding resolved: ${bindingLine.trim()}`);
  if (verbose && probe) {
    report.note(PASS, `probe response: ${JSON.stringify(probe)}`);
  }

  if (misrouted > 0) {
    report.note(
      FAIL,
      `Identity: ${misrouted} surface(s) were answered by the wrong Rails namespace — one VPC Service carries all fifteen, so a wrong Host still returns 200`,
    );
  }
  if (unidentified > 0) {
    report.note(
      WARN,
      `Identity: ${unidentified} surface(s) answered without a namespace field, so which entry point replied is unproven`,
    );
  }
  if (unusable > 0) {
    report.note(
      FAIL,
      `Contract: ${unusable} surface(s) answered a document rails-health.ts rejects — those frames report readiness error and serve /health 503 despite the transport being up (ADR 016)`,
    );
  }

  report.note(
    SKIP,
    'One VPC Service carries all fifteen frames, so `VPC→` is one transport measured fifteen times. `ident` is not: each frame sends its own Host and only its own namespace may answer.',
  );
}

// ---------------------------------------------------------------------------
// Mode: next
// ---------------------------------------------------------------------------

/**
 * Readiness is polled on `/`, which every frame has and which touches nothing
 * outside the process.
 *
 * It used to poll `/rails-health`, and that was wrong: that route called Rails
 * over the VPC binding, so merely *asking whether the server had started* sent a
 * request across the tunnel. Every frame therefore hit Rails twice per run —
 * once to answer "are you up", once to be measured — and a fifteen-frame pass
 * produced 31 Rails requests where it should have produced 16. Caught by
 * comparing the Rails log against the expected count.
 *
 * `/health` is not usable here either, for the same reason and more so: since
 * ADR 009 it is the route that probes Rails. Polling it as a readiness gate
 * would reintroduce exactly the doubling described above.
 */
function readinessUrl(baseUrl) {
  return `${baseUrl}/`;
}

/**
 * One request per frame, to `/health`, which answers for both halves.
 *
 * This used to be two — `/health` for Edge and `/rails-health` for Rails. The
 * merge (ADR 009) is what makes a single request enough; keep it that way, since
 * anything else that calls `/health` doubles the traffic the tunnel and Rails
 * see.
 */
async function checkHttpSurface(report, surface, baseUrl, gatePrefix) {
  const root = await httpGet(baseUrl).catch((e) => ({ status: 0, body: String(e) }));
  const rootOk = root.status >= 200 && root.status < 400;
  report.record(`${gatePrefix} /`, surface.key, rootOk ? PASS : FAIL, `HTTP ${root.status}`);

  if (!surface.hasHealthRoute) {
    // A Rails-backed frame with no `/health` cannot report the connection at
    // all, so this is a FAIL rather than a skip.
    report.record(`${gatePrefix} /health`, surface.key, FAIL, 'frame has no /health route');
    return { readiness: null, status: 0, statusProblem: null, body: '' };
  }

  const health = await httpGet(`${baseUrl}/health`, 30_000).catch((e) => ({
    status: 0,
    body: String(e),
  }));

  const readiness = readEdgeReadiness(health.body);

  // The Edge half, read from the same document. `startup` and `liveness` are
  // the isolate alone, so they are what says this Worker is up regardless of
  // what readiness found downstream.
  const edgeOk = /^startup: ok$/mu.test(health.body) && /^liveness: ok$/mu.test(health.body);
  report.record(
    `${gatePrefix} /health`,
    surface.key,
    edgeOk ? PASS : FAIL,
    edgeOk ? 'edge ok' : `HTTP ${health.status}`,
  );

  let statusProblem = null;
  if (readiness) {
    statusProblem = healthStatusMismatch(readiness, health.status);
    if (statusProblem) {
      report.note(FAIL, `${surface.ws} ${gatePrefix} /health: ${statusProblem}`);
    }
  }

  return { readiness, status: health.status, statusProblem, body: health.body };
}

// Fifteen dev servers at once is what root `pnpm dev` already does, and
// every port differs so they do not collide. The cap exists so a smaller machine
// degrades into batches instead of thrashing.
const DEV_SERVER_CONCURRENCY = Number(process.env.CHECK_DEV_CONCURRENCY ?? 8);

async function modeNext(report, surfaces) {
  for (let i = 0; i < surfaces.length; i += DEV_SERVER_CONCURRENCY) {
    await runNextBatch(report, surfaces.slice(i, i + DEV_SERVER_CONCURRENCY));
  }

  report.note(
    SKIP,
    "/health's Rails half under the dev server is never VPC evidence. `vite dev` runs in workerd, " +
      'but with `remoteBindings: false` outside the `vpc` tier it holds no VPC Service whatever ' +
      '`env.development` declares, and answers from the EDGE_LOCAL_* transport or not at all. ' +
      'See mode `vpc`.',
  );
}

async function runNextBatch(report, surfaces) {
  const servers = surfaces.map((surface) => ({
    surface,
    handle: startProcess('pnpm', ['--filter', surface.pkgName, 'run', 'dev'], {
      name: `next-${surface.brand}-${surface.frame}`,
    }),
  }));

  try {
    for (const { surface, handle } of servers) {
      const baseUrl = `http://127.0.0.1:${surface.port}`;
      const ready = await waitFor(
        async () => (await httpGet(readinessUrl(baseUrl), 5000)).status > 0,
        { timeoutMs: 240_000, onGiveUp: () => handle.exited },
      );

      if (!ready.ok) {
        const why = handle.exited ? `exited with code ${handle.exitCode}` : 'timed out';
        report.record('Local dev server', surface.key, FAIL, `${why} — ${handle.logPath}`);
        report.record('Local /health', surface.key, SKIP, 'server never became ready');
        report.record('Local /', surface.key, SKIP, 'server never became ready');
        report.record('Local /health rails', surface.key, SKIP, 'server never became ready');
        report.note(FAIL, `dev (${surface.ws}) ${why}:\n${tail(handle.output)}`);
        continue;
      }

      report.record('Local dev server', surface.key, PASS, `listening on ${surface.port}`);
      const { readiness, status } = await checkHttpSurface(report, surface, baseUrl, 'Local');

      /*
       * `readiness: ok` is `pass`, `warn` or `not-configured` (ADR 016 decision
       * 4), and outside the Rails overlay it is `not-configured` — no binding
       * exists to be anything else. So `ok` is the expected answer either way,
       * and the detail says which one was expected rather than claiming to have
       * measured which one it got.
       */
      const localRailsEnabled = process.env.EDGE_LOCAL_RAILS_ENABLED === '1';
      if (readiness === null) {
        report.record(
          'Local /health rails',
          surface.key,
          FAIL,
          `/health carries no readiness line, HTTP ${status}`,
        );
      } else if (readiness === 'ok') {
        report.record(
          'Local /health rails',
          surface.key,
          PASS,
          localRailsEnabled
            ? 'readiness ok via the private Podman Rails network (NOT Tunnel or VPC evidence)'
            : 'readiness ok, expected not-configured without the Rails overlay',
        );
      } else {
        report.record(
          'Local /health rails',
          surface.key,
          FAIL,
          localRailsEnabled
            ? 'readiness error on the explicitly enabled private Podman Rails path'
            : 'readiness error, but no Rails transport is configured — the frame should read not-configured',
        );
      }
    }
  } finally {
    await Promise.all(servers.map(({ handle }) => handle.stop()));
  }
}

// ---------------------------------------------------------------------------
// Modes: preview and preview:vpc
// ---------------------------------------------------------------------------

async function modePreview(report, surfaces, { withVpc }) {
  const script = withVpc ? 'preview:vpc' : 'preview';
  const gate = withVpc ? 'Preview → Rails VPC' : 'workerd preview';

  if (withVpc) {
    const auth = await readCloudflareAuth();
    if (!auth.loggedIn) {
      for (const surface of surfaces) {
        report.record(gate, surface.key, BLOCKED, 'no Cloudflare session');
      }
      return;
    }
  }

  // `preview:vpc` is strictly sequential on the default port. ADR 006 is explicit
  // that fifteen concurrent remote-proxy sessions against Cloudflare is exactly
  // what not to do, so this is a deliberate cost, not an oversight.
  //
  // Plain `preview` opens no remote session, so it parallelises. Each frame gets
  // its own port: `pnpm run <script> -- --port N` appends to the last command of
  // the `&&` chain, which is `vite preview`, and a later `--port` wins.
  const batchSize = withVpc ? 1 : PREVIEW_CONCURRENCY;
  for (let i = 0; i < surfaces.length; i += batchSize) {
    const batch = surfaces.slice(i, i + batchSize);
    await Promise.all(
      batch.map((surface, index) =>
        runPreviewSurface(report, surface, {
          script,
          gate,
          withVpc,
          port: withVpc ? PREVIEW_PORT : PREVIEW_PORT + 1 + index,
          // wrangler's inspector defaults to 9229 for every instance, so varying
          // only --port still collides the moment two run at once: the second
          // dies with `Address already in use (127.0.0.1:9229)`.
          inspectorPort: INSPECTOR_PORT + 1 + index,
        }),
      ),
    );
  }
}

// Distinct ports for the parallel, binding-free `preview` batches.
const PREVIEW_CONCURRENCY = Number(process.env.CHECK_PREVIEW_CONCURRENCY ?? 4);
const INSPECTOR_PORT = 9229; // wrangler's default; shared across instances.

async function runPreviewSurface(report, surface, { script, gate, withVpc, port, inspectorPort }) {
  const args = ['--filter', surface.pkgName, 'run', script];
  if (!withVpc) {
    args.push('--', '--port', String(port), '--inspector-port', String(inspectorPort));
  }

  const handle = startProcess('pnpm', args, {
    name: `${script.replace(':', '-')}-${surface.brand}-${surface.frame}`,
    // Blanked so the OAuth session is used: an API token cannot open a
    // remote-binding session at all.
    env: withVpc ? { CLOUDFLARE_API_TOKEN: '' } : {},
  });

  {
    try {
      const baseUrl = `http://127.0.0.1:${port}`;
      const ready = await waitFor(
        async () => (await httpGet(readinessUrl(baseUrl), 5000)).status > 0,
        { timeoutMs: 900_000, intervalMs: 2000, onGiveUp: () => handle.exited },
      );

      if (!ready.ok) {
        const why = handle.exited ? `exited with code ${handle.exitCode}` : 'timed out';
        // `vite build` prints `built in` after the ssr environment. The second
        // pattern belongs to the other bundler shape the manifest can describe;
        // matching either keeps this gate meaningful without this tool deciding
        // which shape a unit has.
        const built = /Worker saved in|built in /u.test(handle.output);
        report.record('bundler build', surface.key, built ? PASS : FAIL, built ? 'built' : why);
        report.record(gate, surface.key, FAIL, `${why} — ${handle.logPath}`);
        report.note(FAIL, `${script} (${surface.ws}) ${why}:\n${tail(handle.output)}`);
        return;
      }

      report.record('bundler build', surface.key, PASS, 'built and started on workerd');

      const { readiness, status } = await checkHttpSurface(
        report,
        surface,
        baseUrl,
        withVpc ? 'Preview(vpc)' : 'Preview',
      );

      if (readiness === null) {
        report.record(gate, surface.key, FAIL, `/health carries no readiness line, HTTP ${status}`);
      } else if (withVpc) {
        // The binding is live here, so `ok` is a reached and healthy Rails.
        report.record(
          gate,
          surface.key,
          readiness === 'ok' ? PASS : FAIL,
          `readiness ${readiness} over the VPC Service`,
        );
      } else {
        // No binding outside the vpc tier, so not-configured — hence `ok` — is
        // the correct answer, and `error` means something else broke.
        report.record(
          gate,
          surface.key,
          readiness === 'ok' ? PASS : WARN,
          `workerd started; readiness ${readiness}, expected not-configured`,
        );
      }
    } finally {
      await handle.stop();
    }
  }
}

// ---------------------------------------------------------------------------
// Mode: host
// ---------------------------------------------------------------------------

export function isInsideContainer(env = process.env, fileExists = existsSync) {
  return env.DEVCONTAINER === '1' || fileExists('/.dockerenv');
}

async function modeHost(report, surfaces) {
  if (isInsideContainer()) {
    for (const surface of surfaces) {
      report.record('Host port reachability', surface.key, SKIP, 'running inside the container');
    }
    report.note(
      SKIP,
      'Host reachability cannot be established from inside the container. Run this from the host OS while `pn run check:local` is running:\n' +
        surfaces.map((s) => `  curl -fsS http://127.0.0.1:${s.port}/health   # ${s.ws}`).join('\n'),
    );
    return;
  }

  for (const surface of surfaces) {
    const result = await httpGet(`http://127.0.0.1:${surface.port}/health`, 5000).catch((e) => ({
      status: 0,
      body: String(e),
    }));
    report.record(
      'Host port reachability',
      surface.key,
      result.status === 200 ? PASS : FAIL,
      result.status === 200 ? `port ${surface.port} reachable` : `port ${surface.port} unreachable`,
    );
  }

  report.note(
    SKIP,
    `preview/preview:vpc bind loopback inside the container, so ${PREVIEW_PORT} is not reachable from the host ` +
      'unless wrangler is given --ip 0.0.0.0. That is expected, not a failure.',
  );
}

// ---------------------------------------------------------------------------
// Mode: links — a clickable index for eyeballing every surface by hand
// ---------------------------------------------------------------------------

// Generated rather than hand-written so the ports can never drift from the
// `dev` scripts they come from.
export function buildLinkIndex(surfaces = loadSurfaces()) {
  return surfaces.map((surface) => ({
    ...surface,
    urls: [
      { path: '/', label: 'home' },
      { path: '/health', label: 'health' },
    ].map((u) => ({ ...u, href: `http://localhost:${surface.port}${u.path}` })),
    // Same port on purpose: it is already forwarded by the devcontainer, so the
    // VPC-connected app appears at the URL the developer already has open.
    vpcCommand:
      `CLOUDFLARE_API_TOKEN= pnpm --filter ${surface.pkgName} run preview:vpc ` +
      `-- --ip 0.0.0.0 --port ${surface.port}`,
  }));
}

function renderLinksHtml(index) {
  const esc = (s) =>
    s.replace(/[&<>"]/gu, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`);
  const row = (f) => `
    <tr>
      <th scope="row"><code>${esc(f.ws)}</code><span class="port">:${f.port}</span></th>
      <td>${f.urls.map((u) => `<a href="${esc(u.href)}" target="_blank" rel="noreferrer">${esc(u.label)}</a>`).join('')}</td>
      <td><button class="copy" data-cmd="${esc(f.vpcCommand)}">copy command</button></td>
    </tr>`;

  return `<title>Edge local check links</title>
<style>
  :root { --bg:#fff; --fg:#111; --muted:#666; --line:#e3e3e3; --accent:#0b6; --warn:#b45; --card:#fafafa; }
  :root:not([data-theme="light"]) { }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
    --bg:#111417; --fg:#e8e8e8; --muted:#9aa; --line:#2a2f35; --accent:#3d9; --warn:#e88; --card:#171b1f; } }
  :root[data-theme="dark"] { --bg:#111417; --fg:#e8e8e8; --muted:#9aa; --line:#2a2f35; --accent:#3d9; --warn:#e88; --card:#171b1f; }
  body { background:var(--bg); color:var(--fg); font:15px/1.6 ui-sans-serif,system-ui,sans-serif; margin:0; padding:2rem 1.25rem 4rem; }
  main { max-width:60rem; margin:0 auto; }
  h1 { font-size:1.5rem; margin:0 0 .25rem; }
  h2 { font-size:1.05rem; margin:2.25rem 0 .5rem; }
  p.sub { color:var(--muted); margin:0 0 1.5rem; }
  .note { background:var(--card); border:1px solid var(--line); border-left:3px solid var(--warn); padding:.75rem 1rem; border-radius:6px; margin:0 0 1rem; }
  .note.ok { border-left-color:var(--accent); }
  table { width:100%; border-collapse:collapse; }
  th,td { text-align:left; padding:.45rem .5rem; border-bottom:1px solid var(--line); vertical-align:middle; }
  th[scope=row] { font-weight:600; white-space:nowrap; }
  .port { color:var(--muted); font-weight:400; }
  td a { display:inline-block; margin-right:.6rem; color:var(--accent); text-decoration:none; border-bottom:1px solid transparent; }
  td a:hover { border-bottom-color:currentColor; }
  button.copy { font:inherit; font-size:.85em; padding:.2rem .55rem; border:1px solid var(--line); background:var(--card); color:var(--muted); border-radius:5px; cursor:pointer; }
  button.copy:hover { color:var(--fg); }
  code,pre { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.9em; }
  pre { background:var(--card); border:1px solid var(--line); border-radius:6px; padding:.75rem 1rem; overflow-x:auto; }
  .wrap { overflow-x:auto; }
</style>
<main>
  <h1>Edge local check links</h1>
  <p class="sub">All fifteen Rails-backed frames. Open from the <strong>host</strong> browser — every port is forwarded by the devcontainer.</p>

  <div class="note">
    <strong>These links are not VPC.</strong> Under <code>pn run dev</code> the frames run on Node with
    <code>env.development</code>, which carries no VPC binding, so <code>/health</code> will always say
    <em>not-configured</em>. That is the expected, healthy answer here — it proves the developer loop, not the tunnel.
  </div>

  <h2>1 · <code>pn run dev</code> — the ordinary developer loop</h2>
  <div class="wrap"><table>
    <thead><tr><th scope="col">Frame</th><th scope="col">Open</th><th scope="col">VPC variant</th></tr></thead>
    <tbody>${index.map(row).join('')}</tbody>
  </table></div>

  <h2>2 · Seeing a page that <em>is</em> connected over Workers VPC</h2>
  <div class="note ok">
    Run one frame at a time — each opens its own remote-binding proxy against Cloudflare, and
    ADR 006 is explicit that fifteen at once is what not to do. It binds
    <code>0.0.0.0</code> on that frame's usual port, so the URLs above keep working unchanged;
    <code>/health</code> should then report <code>rails.liveness.kind</code> as <em>ok</em>.
  </div>
  <pre>${esc(index[0]?.vpcCommand ?? '')}</pre>
  <p class="sub">Use “copy command” in the table for any other frame. <code>CLOUDFLARE_API_TOKEN=</code> must be
  blank — an API token cannot open a remote-binding session; only <code>wrangler login</code> can.</p>

  <h2>3 · What not to expect</h2>
  <p class="sub"><code>pn run check:preview</code> and <code>check:preview:vpc</code> bind container loopback on
  8787+, which the host cannot reach. That is why the command above overrides <code>--ip</code> and
  <code>--port</code>. Regenerate this page with <code>pn run check:links</code>.</p>
</main>
<script>
  for (const b of document.querySelectorAll('button.copy')) {
    b.addEventListener('click', async () => {
      await navigator.clipboard.writeText(b.dataset.cmd);
      const was = b.textContent; b.textContent = 'copied'; setTimeout(() => { b.textContent = was; }, 1200);
    });
  }
</script>`;
}

function modeLinks(surfaces) {
  const index = buildLinkIndex(surfaces);
  mkdirSync(LOG_DIR, { recursive: true });
  const htmlPath = join(LOG_DIR, 'links.html');
  writeFileSync(htmlPath, renderLinksHtml(index));

  process.stdout.write('\nOpen from the HOST browser (not through Cloudflare Access):\n\n');
  for (const frame of index) {
    process.stdout.write(`  ${frame.ws.padEnd(10)} ${frame.urls.map((u) => u.href).join('  ')}\n`);
  }
  process.stdout.write(
    '\nThese are dev servers with no VPC binding — /health will read rails not-configured.\n' +
      'To view a frame actually connected over VPC, one at a time:\n\n' +
      `  ${index[0]?.vpcCommand}\n\n` +
      `Clickable index written to ${htmlPath}\n`,
  );
}

// ---------------------------------------------------------------------------
// Mode: tunnel — the published hostnames, layer by layer
// ---------------------------------------------------------------------------

/**
 * Statuses Cloudflare returns when it reached the tunnel but the origin did not
 * answer. These mean "that dev server is not running", which is an ordinary
 * state here — not every frame is up at once — so they are reported as BLOCKED,
 * never FAIL. Conflating them with a real failure would make the report useless
 * exactly when it matters.
 */
const ORIGIN_DOWN_STATUSES = new Set([502, 503, 521, 522, 523, 530]);

/** Local origins as the connector addresses them, for the operator-facing table. */
export function tunnelLocalOrigin(surface) {
  return `http://edge-core:${surface.port}`;
}

async function resolvesInDns(host) {
  // DNS-over-HTTPS rather than dns.lookup: it answers from Cloudflare's own
  // resolver, so a stale container resolver cache cannot make an unconfigured
  // hostname look configured.
  const response = await fetch(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`,
    { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) return { ok: false, detail: `DoH HTTP ${response.status}` };
  const answer = await response.json();
  const records = (answer.Answer ?? []).filter((entry) => entry.type === 1 || entry.type === 5);
  return records.length > 0
    ? { ok: true, detail: `${records.length} record(s)` }
    : { ok: false, detail: 'no A/CNAME' };
}

function classifyTransportError(error) {
  const text = String(error?.message ?? error);
  if (/certificate|TLS|SSL|ERR_TLS/iu.test(text)) return `TLS failed: ${text}`;
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/iu.test(text)) return `DNS failed: ${text}`;
  return `transport failed: ${text}`;
}

/**
 * Cloudflare Access, from the outside.
 *
 * An Access-protected hostname answers an unauthenticated browser request with a
 * 302 to the team domain. That is the *desired* result for the unauthenticated
 * half of the check, and it also means the connector was never contacted — which
 * is precisely the property worth proving. Detected by the redirect target rather
 * than by a status code, because a 302 on its own is also how `net/apex` and the
 * apex `/` behave.
 */
const ACCESS_TEAM_DOMAIN = /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com\//iu;

function accessRedirect(response) {
  const location = response.headers.get('location') ?? '';
  return ACCESS_TEAM_DOMAIN.test(location) ? location : null;
}

/**
 * Service-token headers for the authenticated half, read from the environment and
 * never persisted. A service token is a credential: it is not committed, not
 * written to the evidence log, and not echoed in any report detail. Absent
 * variables simply mean the authenticated half is reported as BLOCKED rather
 * than guessed at.
 */
function accessServiceTokenHeaders() {
  const id = process.env.CF_ACCESS_CLIENT_ID;
  const secret = process.env.CF_ACCESS_CLIENT_SECRET;
  if (!id || !secret) return null;
  return { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret };
}

/** Anything that would reveal the origin's own address to a browser. */
function findLocalLeak(text) {
  return /localhost|127\.0\.0\.1|edge-core|0\.0\.0\.0/u.exec(text ?? '')?.[0] ?? null;
}

async function modeTunnel(report, surfaces) {
  for (const surface of surfaces) {
    await checkTunnelSurface(report, surface);
  }

  if (!accessServiceTokenHeaders()) {
    report.note(
      SKIP,
      'No Access service token in the environment, so only the unauthenticated half of any ' +
        'Access-protected surface was measured. Where Access blocked the probe, the remaining ' +
        'gates report BLOCKED — unproven, deliberately not PASS.',
    );
  }

  // Both notes below are about the content frames. In `tunnel:apex` there are
  // none, and printing them would describe surfaces this run never touched.
  if (!surfaces.some((surface) => surface.runtime === 'next')) return;

  report.note(
    SKIP,
    'Tunnel reachability is not VPC evidence: a Tunnel route does not hand a process a Workers ' +
      'binding. Under the dev server the Rails half comes from the local EDGE_LOCAL_* transport, ' +
      'or reports not-configured. See mode `vpc`.',
  );
  report.note(
    SKIP,
    'Brand mix-up is unverifiable for the twelve content frames: all three brands of a frame ' +
      'return byte-identical HTML, so the response cannot say which one answered. The frame ' +
      'identity below IS verified; the brand is asserted by the ingress table only.',
  );
}

async function checkTunnelSurface(report, surface) {
  const { key, host } = surface;
  const base = `https://${host}`;
  const restGates = ['Tunnel origin', 'Tunnel identity', 'Tunnel route', 'Tunnel no-leak'];
  const skipRest = (detail, status = SKIP) => {
    for (const gate of restGates) {
      report.record(gate, key, status, detail);
    }
  };

  // 1. DNS
  const dns = await resolvesInDns(host).catch((error) => ({ ok: false, detail: String(error) }));
  report.record('Tunnel DNS', key, dns.ok ? PASS : FAIL, `${host}: ${dns.detail}`);
  if (!dns.ok) {
    report.record('Tunnel Cloudflare', key, SKIP, 'no DNS record');
    report.record('Tunnel access', key, SKIP, 'no DNS record');
    skipRest('no DNS record');
    return;
  }

  // 2. TLS + Cloudflare. One request answers both: it cannot succeed without a
  //    valid certificate, and `cf-ray` is only present when Cloudflare served it.
  let landing;
  try {
    landing = await httpGet(base, 20_000);
  } catch (error) {
    report.record('Tunnel Cloudflare', key, FAIL, classifyTransportError(error));
    report.record('Tunnel access', key, SKIP, 'did not reach Cloudflare');
    skipRest('did not reach Cloudflare');
    return;
  }
  const servedByCloudflare = landing.headers.has('cf-ray');
  report.record(
    'Tunnel Cloudflare',
    key,
    servedByCloudflare ? PASS : WARN,
    servedByCloudflare
      ? `TLS ok, HTTP ${landing.status}`
      : `TLS ok but no cf-ray (HTTP ${landing.status})`,
  );

  // 3. Access. Both halves in one place, because the unauthenticated result
  //    determines whether the rest of the checks can run at all.
  const authHeaders = accessServiceTokenHeaders();
  const unauthenticatedBlock = accessRedirect(landing);
  if (unauthenticatedBlock) {
    // The origin was NOT contacted, which is the point. Report the team domain
    // without its query string: the `meta` parameter is a JWT.
    report.record(
      'Tunnel access',
      key,
      PASS,
      `unauthenticated blocked: 302 → ${new URL(unauthenticatedBlock).origin}/… [query REDACTED]`,
    );

    if (!authHeaders) {
      skipRest(
        'behind Access, and no service token in the environment — the authenticated half is ' +
          'unproven, not passing. Set CF_ACCESS_CLIENT_ID/CF_ACCESS_CLIENT_SECRET to check it.',
        BLOCKED,
      );
      return;
    }

    try {
      landing = await httpGet(base, 20_000, authHeaders);
    } catch (error) {
      report.record('Tunnel origin', key, FAIL, classifyTransportError(error));
      skipRest('authenticated request failed transport');
      return;
    }
    if (accessRedirect(landing)) {
      // A token that Access does not accept, or a policy that excludes it.
      report.record(
        'Tunnel origin',
        key,
        FAIL,
        'service token was rejected by Access — still redirected to the team domain',
      );
      skipRest('not authenticated');
      return;
    }
  } else {
    // The Access rollout completed on 2026-08-11: all sixteen surfaces answer a
    // 302 to the team domain, so this branch should no longer be reached. It is
    // kept as the detector for Access having been removed or misapplied, and it
    // stays WARN rather than FAIL so the same checker remains usable during a
    // rollout elsewhere, where publishing precedes Access surface by surface.
    // Loud either way, because an unprotected development origin is on the internet.
    report.record(
      'Tunnel access',
      key,
      WARN,
      `no Access in front — reachable unauthenticated (HTTP ${landing.status})`,
    );
  }

  // 4. Origin. A tunnel that reached nothing is a stopped dev server, not a fault.
  if (ORIGIN_DOWN_STATUSES.has(landing.status)) {
    report.record(
      'Tunnel origin',
      key,
      BLOCKED,
      `HTTP ${landing.status} — ${surface.ws} not listening on ${surface.port}`,
    );
    skipRest(`origin down (HTTP ${landing.status})`);
    return;
  }
  report.record('Tunnel origin', key, PASS, `origin answered HTTP ${landing.status}`);

  // 5. Identity, then routes. Split by runtime because the two shapes prove
  //    themselves differently.
  if (surface.runtime === 'hono') {
    await checkTunnelApex(report, surface, base, landing, authHeaders);
  } else {
    await checkTunnelNext(report, surface, base, landing, authHeaders);
  }
}

async function checkTunnelApex(report, surface, base, landing, authHeaders) {
  const { key, brand } = surface;

  const health = await httpGet(`${base}/health`, 15_000, authHeaders).catch((e) => ({
    status: 0,
    body: String(e),
  }));
  const htmlGone = await httpGet(`${base}/health.html`, 15_000, authHeaders).catch((e) => ({
    status: 0,
    body: String(e),
  }));
  const jsonGone = await httpGet(`${base}/health.json`, 15_000, authHeaders).catch((e) => ({
    status: 0,
    body: String(e),
  }));
  const goneOk = (res) =>
    res.status === 404 && !(res.headers?.get?.('content-type') ?? '').includes('json');
  const identityOk =
    health.status === 200 &&
    (health.headers?.get?.('content-type') ?? '').startsWith('text/plain') &&
    goneOk(htmlGone) &&
    goneOk(jsonGone);
  report.record(
    'Tunnel identity',
    key,
    identityOk ? PASS : FAIL,
    identityOk
      ? `/health text/plain; /health.html ${htmlGone.status}; /health.json ${jsonGone.status}`
      : `/health HTTP ${health.status}; /health.html ${htmlGone.status}; /health.json ${jsonGone.status} ` +
          `(want /health 200 text/plain and the other two 404 HTML)`,
  );

  // `/` is a 301 by design, to a hardcoded absolute URL. `net` alone redirects
  // relatively, to its own /about.
  const wantLocation = brand === 'net' ? '/about' : `https://jp.umaxica.${brand}/`;
  const location = landing.headers.get('location');
  const about = await httpGet(`${base}/about`, 15_000, authHeaders).catch((e) => ({
    status: 0,
    body: String(e),
  }));
  const routeOk = landing.status === 301 && location === wantLocation && about.status === 200;
  report.record(
    'Tunnel route',
    key,
    routeOk ? PASS : FAIL,
    `/ ${landing.status}→${location ?? '<none>'} (want 301→${wantLocation}), /about ${about.status}`,
  );

  const leak = findLocalLeak(location) ?? findLocalLeak(about.body);
  report.record(
    'Tunnel no-leak',
    key,
    leak ? FAIL : PASS,
    leak ? `leaked ${leak}` : 'no local address',
  );
}

/**
 * Apex-shaped `{service, frame}` JSON, or null. No surface serves
 * `/health.json`; a leftover copy would still parse here and FAIL if the brand
 * did not match.
 */
function parseSurfaceIdentityJson(body) {
  try {
    const parsed = JSON.parse(body);
    return typeof parsed?.service === 'string' && typeof parsed?.frame === 'string'
      ? { service: parsed.service, frame: parsed.frame }
      : null;
  } catch {
    return null;
  }
}

async function checkTunnelNext(report, surface, base, landing, authHeaders) {
  const { key, brand, frame, marker } = surface;

  const frameOk = landing.status === 200 && landing.body.includes(marker.value);

  // The HTML marker proves the FRAME and nothing more: `UMAXICA Info` is the
  // same string in all three brands' copies, as is every other byte these pages
  // return. An ingress entry that sent `info.umaxica.com` to the `app` port
  // would satisfy the check above exactly like a correct one.
  //
  // No surface serves `/health.json`. Brand mix-up on a content frame is
  // therefore UNPROVEN (WARN), not PASS: the HTML cannot distinguish
  // app/com/org, and `/health` is liveness, not identity.
  const health = await httpGet(`${base}/health.json`, 15_000, authHeaders).catch((e) => ({
    status: 0,
    body: String(e),
  }));
  const identity = health.status === 200 ? parseSurfaceIdentityJson(health.body) : null;
  const brandOk = identity !== null && identity.service === brand && identity.frame === frame;

  const identityStatus = frameOk ? (identity === null ? WARN : brandOk ? PASS : FAIL) : FAIL;
  report.record(
    'Tunnel identity',
    key,
    identityStatus,
    frameOk
      ? identity === null
        ? `HTML carries "${marker.value}"; brand UNPROVEN — /health.json ${health.status}`
        : brandOk
          ? `HTML carries "${marker.value}"; /health.json service=${identity.service} frame=${identity.frame}`
          : `/health.json says service=${identity.service} frame=${identity.frame}, want ${brand}/${frame} — WRONG SURFACE`
      : `HTTP ${landing.status}, "${marker.value}" absent — wrong frame or not rendered`,
  );

  // A dev-server asset URL taken from the page it was served with, so the check
  // cannot pass against a stale or guessed hash.
  // Both bundler shapes the manifest can describe. Taken from the page that
  // referenced it rather than guessed, so it proves the served document and its
  // assets agree.
  const assetPath =
    /(?:src|href)="(\/(?:_next\/static|assets)\/[^"]+)"/u.exec(landing.body)?.[1] ?? null;
  const asset = assetPath
    ? await httpGet(`${base}${assetPath}`, 15_000, authHeaders).catch((e) => ({
        status: 0,
        body: String(e),
      }))
    : null;

  // 503 not-configured is the correct answer without `--rails`: the dev server has
  // no VPC binding, so a 200 here would mean the private Podman path is live.
  const railsHealth = await httpGet(`${base}/health`, 30_000, authHeaders).catch((e) => ({
    status: 0,
    body: String(e),
  }));
  const kind = parseRailsHealthJson(railsHealth.body);
  const railsOk = kind !== null && !railsHealthStatusMismatch(kind, railsHealth.status);

  const assetOk = asset?.status === 200;
  report.record(
    'Tunnel route',
    key,
    assetOk && railsOk ? PASS : FAIL,
    `${assetPath ? `${assetPath.slice(0, 42)} ${asset.status}` : 'no hashed asset in HTML'}, ` +
      `/health ${railsHealth.status} ${kind ?? '<unrecognised>'}`,
  );

  const leak = findLocalLeak(landing.headers.get('location')) ?? findLocalLeak(landing.body);
  report.record(
    'Tunnel no-leak',
    key,
    leak ? FAIL : PASS,
    leak ? `leaked ${leak}` : 'no local address',
  );
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const GATE_ORDER = [
  'Toolchain',
  'VPC config',
  'Rails routing',
  'Direct VPC → Rails',
  'VPC identity',
  'VPC contract',
  'Local dev server',
  'Local /health',
  'Local /',
  'Local /health rails',
  'bundler build',
  'workerd preview',
  'Preview /health',
  'Preview /',
  'Preview(vpc) /health',
  'Preview(vpc) /',
  'Preview → Rails VPC',
  'Host port reachability',
  'Tunnel DNS',
  'Tunnel Cloudflare',
  'Tunnel access',
  'Tunnel origin',
  'Tunnel identity',
  'Tunnel route',
  'Tunnel no-leak',
];

// Short column headers for the transposed matrix. Fifteen surfaces do not fit as
// columns, so surfaces became the rows and the gates need to be narrow.
const GATE_ABBREVIATIONS = new Map([
  ['Toolchain', 'tool'],
  ['VPC config', 'cfg'],
  ['Rails routing', 'rails'],
  ['Direct VPC → Rails', 'VPC→'],
  ['VPC identity', 'VPCid'],
  ['VPC contract', 'VPCct'],
  ['Local dev server', 'dev'],
  ['Local /health', 'd:hlt'],
  ['Local /', 'd:/'],
  ['Local /health rails', 'd:rh'],
  ['bundler build', 'build'],
  ['workerd preview', 'wd'],
  ['Preview /health', 'p:hlt'],
  ['Preview /', 'p:/'],
  ['Preview(vpc) /health', 'v:hlt'],
  ['Preview(vpc) /', 'v:/'],
  ['Preview → Rails VPC', 'v:rh'],
  ['Host port reachability', 'host'],
  ['Tunnel DNS', 'dns'],
  ['Tunnel Cloudflare', 'cf'],
  ['Tunnel access', 'acs'],
  ['Tunnel origin', 'orig'],
  ['Tunnel identity', 'ident'],
  ['Tunnel route', 'route'],
  ['Tunnel no-leak', 'leak'],
]);

const STATUS_GLYPH = new Map([
  [PASS, 'ok'],
  [WARN, 'warn'],
  [FAIL, 'FAIL'],
  [BLOCKED, 'blkd'],
  [SKIP, 'skip'],
]);

export function renderMatrix(report, surfaces) {
  const gates = [...report.rows.keys()].sort((a, b) => {
    const ia = GATE_ORDER.indexOf(a);
    const ib = GATE_ORDER.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  const heads = gates.map((g) => GATE_ABBREVIATIONS.get(g) ?? g.slice(0, 5));
  const widths = heads.map((h) => Math.max(4, h.length));
  const keyWidth = Math.max(9, ...surfaces.map((s) => s.key.length));

  const lines = [
    `| ${'Surface'.padEnd(keyWidth)} | ${heads.map((h, i) => h.padEnd(widths[i])).join(' | ')} |`,
    `| ${'-'.repeat(keyWidth)} | ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`,
  ];
  for (const surface of surfaces) {
    const cells = gates.map((gate, i) =>
      (STATUS_GLYPH.get(report.get(gate, surface.key)?.status) ?? '—').padEnd(widths[i]),
    );
    lines.push(`| ${surface.key.padEnd(keyWidth)} | ${cells.join(' | ')} |`);
  }

  lines.push('');
  lines.push(`legend: ${gates.map((g, i) => `${heads[i]}=${g}`).join(' · ')}`);
  return lines.join('\n');
}

function printReport(report, surfaces) {
  process.stdout.write('\n');
  for (const { status, message } of report.notes) {
    process.stdout.write(`${status.padEnd(7)} ${message}\n`);
  }

  process.stdout.write('\nDetails\n');
  for (const [gate, row] of report.rows) {
    for (const [key, cell] of row) {
      if (cell.status === PASS && !cell.detail) continue;
      process.stdout.write(`  ${cell.status.padEnd(7)} ${gate} [${key}] ${cell.detail}\n`);
    }
  }

  process.stdout.write(`\n${renderMatrix(report, surfaces)}\n`);

  const missing = findMissingCells(
    report,
    surfaces.map((s) => s.key),
  );
  if (missing.length) {
    process.stdout.write(`\nWARN    gates missing a surface: ${missing.join(', ')}\n`);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function main(argv = process.argv.slice(2)) {
  const verbose = argv.includes('--verbose');
  const requested = argv.find((arg) => !arg.startsWith('-'));

  if (!requested) {
    process.stderr.write(`verify-edge-connectivity: a mode is required (${MODES.join(', ')})\n`);
    return 2;
  }
  if (!MODES.includes(requested)) {
    process.stderr.write(
      `verify-edge-connectivity: unknown mode ${JSON.stringify(requested)} (${MODES.join(', ')})\n`,
    );
    return 2;
  }

  const manifest = loadManifest();
  // `tunnel` measures a different surface set: the four apex workers plus the
  // twelve non-core frames, with `*/core` excluded. Every other mode is about the
  // fifteen Rails-backed frames.
  //
  // `tunnel:apex` narrows that to the four Hono apexes. They are worth their own
  // mode because they are the only surfaces whose brand is verifiable from the
  // response, which makes them the right place to prove the ingress and the
  // Access policy before the twelve look-alike content frames follow.
  const surfaces = requested.startsWith('tunnel')
    ? loadTunnelSurfaces(manifest).filter(
        (surface) => requested !== 'tunnel:apex' || surface.frame === 'apex',
      )
    : loadSurfaces(manifest);
  const report = new Report();
  const modes = requested === 'all' ? ALL_MODES : [requested];

  process.stdout.write(
    `verify-edge-connectivity: ${modes.join(', ')} across ${surfaces.map((s) => s.key).join('/')}\n`,
  );

  try {
    for (const mode of modes) {
      if (mode === 'config') {
        await checkToolchain(report, surfaces);
        await modeConfig(report, surfaces, manifest);
      } else if (mode === 'vpc') {
        // The Cores hold no VPC binding (ADR 018), so the probe measures the rest.
        await modeVpc(
          report,
          surfaces.filter((surface) => isVpcSurface(surface, manifest)),
          manifest,
          { verbose },
        );
      } else if (mode === 'next') {
        await modeNext(report, surfaces);
      } else if (mode === 'preview') {
        await modePreview(report, surfaces, { withVpc: false });
      } else if (mode === 'preview:vpc') {
        await modePreview(
          report,
          surfaces.filter((surface) => isVpcSurface(surface, manifest)),
          { withVpc: true },
        );
      } else if (mode === 'host') {
        await modeHost(report, surfaces);
      } else if (mode === 'tunnel' || mode === 'tunnel:apex') {
        await modeTunnel(report, surfaces);
      } else if (mode === 'links') {
        modeLinks(surfaces);
        return 0; // an index, not a verdict — nothing to put in the matrix
      }
    }
  } finally {
    await stopAll();
  }

  printReport(report, surfaces);
  return report.hasFailure() ? 1 : 0;
}

if (process.argv[1] && process.argv[1].endsWith('verify-edge-connectivity.mjs')) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      process.stderr.write(`verify-edge-connectivity: ${error?.stack ?? error}\n`);
      void stopAll().finally(() => process.exit(1));
    });
}
