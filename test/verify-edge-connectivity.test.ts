import { describe, expect, it, vi } from 'vitest';

import { describeServiceIdProblem } from '../tools/lib/wrangler-config.mjs';
import {
  BLOCKED,
  FAIL,
  PASS,
  Report,
  SKIP,
  WARN,
  classifyHealthContract,
  classifyIdentity,
  classifyProbeOutcome,
  extractInterfaceBlock,
  findMissingCells,
  healthStatusMismatch,
  isInsideContainer,
  loadSurfaces,
  main,
  readEdgeReadiness,
  readRailsOrigin,
  waitFor,
} from '../tools/verify-edge-connectivity.mjs';

// The checker is the thing that decides whether the network is healthy, so its
// own control logic has to be pinned. Everything here is pure — no processes are
// spawned and no network is touched.

describe('mode handling', () => {
  it('rejects a missing mode', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    await expect(main([])).resolves.toBe(2);
    expect(stderr).toHaveBeenCalled();
    stderr.mockRestore();
  });

  it('rejects an unknown mode rather than silently doing nothing', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    await expect(main(['vpcc'])).resolves.toBe(2);
    stderr.mockRestore();
  });
});

describe('surfaces', () => {
  it('covers all fifteen Rails-backed frames, not just the three cores', () => {
    // The checker originally stopped at `*/core`, which silently left twelve
    // frames that talk to Rails completely unverified.
    const surfaces = loadSurfaces();
    expect(surfaces).toHaveLength(15);
    expect(new Set(surfaces.map((s) => s.brand))).toEqual(new Set(['app', 'com', 'org']));
    expect(new Set(surfaces.map((s) => s.frame))).toEqual(
      new Set(['core', 'docs', 'news', 'help', 'info']),
    );
  });

  it('reads each port from that workspace, never from a hard-coded table', () => {
    const ports = Object.fromEntries(loadSurfaces().map((s) => [s.key, s.port]));
    expect(ports).toEqual({
      'APP/CORE': 5405,
      'APP/DOCS': 5406,
      'APP/NEWS': 5407,
      'APP/HELP': 5408,
      'APP/INFO': 5403,
      'COM/CORE': 5105,
      'COM/DOCS': 5106,
      'COM/NEWS': 5107,
      'COM/HELP': 5108,
      'COM/INFO': 5103,
      'ORG/CORE': 5305,
      'ORG/DOCS': 5306,
      'ORG/NEWS': 5307,
      'ORG/HELP': 5308,
      'ORG/INFO': 5303,
    });
    expect(new Set(Object.values(ports)).size).toBe(15); // no collisions
  });

  it('derives each frame shape from disk', () => {
    for (const surface of loadSurfaces()) {
      // All fifteen answer `/health`, and since ADR 009 that one route carries
      // both halves — Edge's own state and Rails' liveness. The separate
      // `/rails-health` it replaced must not come back.
      expect(surface.hasHealthRoute, `${surface.ws} must expose /health`).toBe(true);
      expect(surface).not.toHaveProperty('hasRailsHealth');
    }
  });

  it('reads the Rails Host each frame will send, and it is that frame’s own', () => {
    // The host is not decoration: Rails dispatches to `<Frame>::<Brand>::…` on
    // it, so reading the wrong one would make the checker bless a frame that
    // talks to the wrong namespace — which answers 200 and looks fine.
    for (const surface of loadSurfaces()) {
      expect(readRailsOrigin(surface.ws)).toBe(
        `http://${surface.frame}.${surface.brand}.localhost:3000`,
      );
    }
  });
});

describe('report completeness', () => {
  it('flags a gate that omits a surface, so no surface can be silently dropped', () => {
    const report = new Report();
    report.record('Direct VPC → Rails', 'APP', PASS);
    report.record('Direct VPC → Rails', 'COM', PASS);
    expect(findMissingCells(report, ['APP', 'COM', 'ORG'])).toEqual(['Direct VPC → Rails/ORG']);
  });

  it('accepts SKIP as coverage, but not absence', () => {
    const report = new Report();
    for (const key of ['APP', 'COM', 'ORG']) report.record('Host port reachability', key, SKIP);
    expect(findMissingCells(report, ['APP', 'COM', 'ORG'])).toEqual([]);
  });

  it('would catch a gate that covered only the cores, across all fifteen keys', () => {
    // The exact regression this session existed to fix.
    const keys = loadSurfaces().map((s) => s.key);
    const report = new Report();
    for (const key of keys.filter((k) => k.endsWith('/CORE'))) {
      report.record('Preview → Rails VPC', key, PASS);
    }
    expect(findMissingCells(report, keys)).toHaveLength(12);
  });

  it('treats FAIL as the only non-zero exit condition', () => {
    const report = new Report();
    report.record('VPC config', 'APP', SKIP);
    report.note('WARN', 'production has no VPC Service yet');
    expect(report.hasFailure()).toBe(false);
    report.record('VPC config', 'COM', FAIL);
    expect(report.hasFailure()).toBe(true);
  });
});

describe('classifyProbeOutcome', () => {
  it('reports 200 as a transport pass', () => {
    const verdict = classifyProbeOutcome({ probe: { probe: 'reached', status: 200 } });
    expect(verdict.transport).toBe(PASS);
    expect(verdict.layer).toBeNull();
  });

  it('treats a 404 as proof the transport worked, blaming Rails routing', () => {
    // ADR 006's first verified run ended here. A 404 means the request arrived,
    // so reporting it as a transport failure would be actively misleading.
    const verdict = classifyProbeOutcome({ probe: { probe: 'reached', status: 404 } });
    expect(verdict.transport).toBe(PASS);
    expect(verdict.layer).toBe('Rails');
  });

  it('blames Rails for a 500, not the network', () => {
    const verdict = classifyProbeOutcome({ probe: { probe: 'reached', status: 500 } });
    expect(verdict.transport).toBe(PASS);
    expect(verdict.layer).toBe('Rails');
  });

  it('does not mistake a tunnel ProxyError for a Rails answer', () => {
    /*
     * Measured by stopping Rails: Workers VPC does not throw on an unreachable
     * origin, it returns HTTP 500 with `ProxyError: connection_refused` as the
     * body. Reading the status alone reports "Rails answered 500" when Rails
     * answered nothing — the exact layer confusion this tool exists to prevent.
     */
    const verdict = classifyProbeOutcome({
      probe: {
        probe: 'reached',
        status: 500,
        contentType: 'text/plain;charset=UTF-8',
        body: 'ProxyError: connection_refused',
      },
    });
    expect(verdict.transport).toBe(FAIL);
    expect(verdict.layer).toBe('Tunnel/private origin');
    expect(verdict.code).toBe('connection_refused');
    expect(verdict.detail).not.toContain('Rails answered');
  });

  it('still blames Rails for a 500 that carries no ProxyError', () => {
    const verdict = classifyProbeOutcome({
      probe: { probe: 'reached', status: 500, body: '{"error":"boom"}' },
    });
    expect(verdict.transport).toBe(PASS);
    expect(verdict.layer).toBe('Rails');
  });

  it('detects a missing binding', () => {
    const verdict = classifyProbeOutcome({ probe: { probe: 'binding-missing' } });
    expect(verdict).toMatchObject({ transport: FAIL, layer: 'Binding' });
  });

  it('maps documented VPC error codes to the layer that owns them', () => {
    const cases: Array<[string, string]> = [
      ['connection_refused', 'Tunnel/private origin'],
      ['destination_unavailable', 'Tunnel/private origin'],
      ['dns_error', 'Tunnel/private origin'],
      ['tls_certificate_error', 'Tunnel/private origin'],
      ['connection_timeout', 'Workers VPC'],
      ['rate_limited', 'Workers VPC'],
    ];
    for (const [code, layer] of cases) {
      const verdict = classifyProbeOutcome({
        probe: { probe: 'transport-error', message: `Error: ${code}` },
      });
      expect(verdict).toMatchObject({ transport: FAIL, layer, code });
    }
  });

  it('handles a timeout that carries no documented code', () => {
    const verdict = classifyProbeOutcome({
      probe: { probe: 'transport-error', message: 'The operation was aborted due to timeout' },
    });
    expect(verdict).toMatchObject({ transport: FAIL, layer: 'Workers VPC' });
  });

  it('never reduces an unknown transport error to a generic network error', () => {
    const verdict = classifyProbeOutcome({
      probe: { probe: 'transport-error', message: 'something new' },
    });
    expect(verdict.detail).toContain('something new');
  });

  it('reports missing auth as BLOCKED, never as PASS', () => {
    const verdict = classifyProbeOutcome({
      wranglerOutput: 'ERROR remote session could not be authenticated',
    });
    expect(verdict.transport).toBe(BLOCKED);
    expect(verdict.layer).toBe('Wrangler auth');
    expect(verdict.detail).toContain('wrangler login');
  });

  it('recognises the 10405 API-token rejection specifically', () => {
    const verdict = classifyProbeOutcome({
      wranglerOutput: 'code: 10405 Method not allowed for this authentication scheme',
    });
    expect(verdict.transport).toBe(BLOCKED);
  });

  it('fails rather than passes when the probe produced nothing', () => {
    expect(classifyProbeOutcome({ probe: null }).transport).toBe(FAIL);
  });
});

describe('service_id validation', () => {
  it.each([
    '',
    'TODO',
    '00000000-0000-0000-0000-000000000000',
    'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
  ])('rejects the placeholder %j', (value) => {
    expect(describeServiceIdProblem(value)).not.toBeNull();
  });

  it('rejects a non-UUID and a missing value', () => {
    expect(describeServiceIdProblem('not-a-uuid')).toContain('not a UUID');
    expect(describeServiceIdProblem(undefined)).toContain('missing');
  });

  it('accepts the real development service id', () => {
    expect(describeServiceIdProblem('019f5fe0-287f-7040-9f2f-036cb5b21df7')).toBeNull();
  });
});

describe('readEdgeReadiness', () => {
  const aggregate = (readiness: string) =>
    `status: ${readiness}\nstartup: ok\nliveness: ok\nreadiness: ${readiness}\n`;

  it('reads the Rails half off the readiness line', () => {
    expect(readEdgeReadiness(aggregate('ok'))).toBe('ok');
    expect(readEdgeReadiness(aggregate('error'))).toBe('error');
  });

  it('reads readiness, not the aggregate status line above it', () => {
    // Only `readiness` carries Rails. `startup` and `liveness` are the isolate
    // and are always ok, so a gate that read `status` would report an Edge
    // problem as a Rails one and vice versa.
    expect(readEdgeReadiness('status: error\nstartup: ok\nliveness: error\nreadiness: ok\n')).toBe(
      'ok',
    );
  });

  it('returns null for a body that is not the probe document', () => {
    // Which is the signal for a stale deployed Worker still answering the JSON
    // `/health` that ADR 016 replaced — visible rather than silently blessed.
    for (const body of [
      '<!DOCTYPE html><h1>hi</h1>',
      '',
      '{"status":"ok","rails":{"liveness":{"kind":"ok"}}}',
      'readiness: probably-fine\n',
      undefined,
    ]) {
      expect(readEdgeReadiness(body)).toBeNull();
    }
  });
});

describe('healthStatusMismatch', () => {
  // `/health` contracts 200 when every probe is ok and 503 otherwise; a body and
  // status that disagree would let a broken route read as healthy.
  it('accepts the documented pairings', () => {
    expect(healthStatusMismatch('ok', 200)).toBeNull();
    expect(healthStatusMismatch('error', 503)).toBeNull();
  });

  it('catches a healthy body served under a failing status, and the reverse', () => {
    expect(healthStatusMismatch('ok', 503)).toContain('should answer 200');
    expect(healthStatusMismatch('error', 200)).toContain('should answer 503');
  });
});

describe('extractInterfaceBlock', () => {
  // A lazy regex here previously ran DevelopmentEnv into the following
  // PreviewEnv and reported the VPC binding as present in both — a false FAIL.
  const source = [
    'declare namespace Cloudflare {',
    '  interface DevelopmentEnv {',
    '    ASSETS: Fetcher;',
    '  }',
    '  interface PreviewEnv {',
    '    UMAXICA_APPS_EDGE_CF_WORKERS_VPC: Fetcher;',
    '  }',
    '}',
  ].join('\n');

  it('stops at the end of the named interface', () => {
    expect(extractInterfaceBlock(source, 'DevelopmentEnv')).not.toContain('VPC');
    expect(extractInterfaceBlock(source, 'PreviewEnv')).toContain('VPC');
  });

  it('returns null for an interface that is not there', () => {
    expect(extractInterfaceBlock(source, 'MissingEnv')).toBeNull();
  });
});

describe('waitFor', () => {
  it('returns as soon as the condition holds', async () => {
    let calls = 0;
    const result = await waitFor(() => ++calls >= 3, { timeoutMs: 5000, intervalMs: 1 });
    expect(result.ok).toBe(true);
  });

  it('gives up at the deadline instead of hanging', async () => {
    const result = await waitFor(() => false, { timeoutMs: 20, intervalMs: 5 });
    expect(result).toEqual({ ok: false, reason: 'timeout' });
  });

  it('aborts early when the child process has already died', async () => {
    const result = await waitFor(() => false, {
      timeoutMs: 5000,
      intervalMs: 1,
      onGiveUp: () => true,
    });
    expect(result).toEqual({ ok: false, reason: 'aborted' });
  });

  it('keeps polling when the check throws, since the server may not be up', async () => {
    let calls = 0;
    const result = await waitFor(
      () => {
        if (++calls < 3) throw new Error('ECONNREFUSED');
        return true;
      },
      { timeoutMs: 5000, intervalMs: 1 },
    );
    expect(result.ok).toBe(true);
    expect(calls).toBe(3);
  });
});

describe('isInsideContainer', () => {
  it('detects the devcontainer and the docker marker file', () => {
    expect(isInsideContainer({ DEVCONTAINER: '1' }, () => false)).toBe(true);
    expect(isInsideContainer({}, (path) => path === '/.dockerenv')).toBe(true);
    expect(isInsideContainer({}, () => false)).toBe(false);
  });
});

describe('classifyIdentity', () => {
  const surface = { key: 'APP/CORE', brand: 'app', frame: 'core' };
  const liveness = (namespace: unknown) =>
    JSON.stringify({
      status: 'ok',
      check: 'liveness',
      ...(namespace === undefined ? {} : { namespace }),
    });

  it('passes when the frame own namespace answered', () => {
    const verdict = classifyIdentity({
      surface,
      entry: { status: 200, body: liveness('core/app') },
      transport: PASS,
    });
    expect(verdict.status).toBe(PASS);
    expect(verdict.detail).toContain('core/app');
  });

  it('fails when another namespace answered', () => {
    /*
     * The whole reason this gate exists. One VPC Service carries all fifteen
     * frames, so a wrong Host reaches a different namespace and still answers
     * 200 — every transport-level gate reads that as success.
     */
    const verdict = classifyIdentity({
      surface,
      entry: { status: 200, body: liveness('docs/app') },
      transport: PASS,
    });
    expect(verdict.status).toBe(FAIL);
    expect(verdict.detail).toContain('expected core/app');
  });

  it('warns rather than fails when Rails reports no namespace', () => {
    // Unproven is not the same as wrong: Rails only began reporting the
    // namespace on 2026-08-21, and an older backend must not read as a misroute.
    for (const body of [liveness(undefined), liveness(''), liveness(7)]) {
      expect(
        classifyIdentity({ surface, entry: { status: 200, body }, transport: PASS }).status,
      ).toBe(WARN);
    }
  });

  it('fails when a 200 is not a liveness document at all', () => {
    for (const body of ['<!DOCTYPE html>', '', 'null']) {
      expect(
        classifyIdentity({ surface, entry: { status: 200, body }, transport: PASS }).status,
      ).toBe(FAIL);
    }
  });

  it('blocks, never passes, when there is nothing to identify', () => {
    expect(
      classifyIdentity({
        surface,
        entry: { status: 200, body: liveness('core/app') },
        transport: FAIL,
      }).status,
    ).toBe(BLOCKED);
    expect(
      classifyIdentity({ surface, entry: { status: 404, body: '' }, transport: PASS }).status,
    ).toBe(BLOCKED);
    expect(classifyIdentity({ surface, entry: undefined, transport: PASS }).status).toBe(BLOCKED);
  });
});

describe('classifyHealthContract', () => {
  const document = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
      status: 'pass',
      timestamp: '2026-09-06T09:33:29Z',
      checks: {
        startup: { status: 'pass' },
        liveness: { status: 'pass' },
        readiness: { status: 'pass' },
      },
      ...overrides,
    });

  it('passes a complete document', () => {
    const verdict = classifyHealthContract({
      entry: { status: 200, body: document() },
      transport: PASS,
    });
    expect(verdict.status).toBe(PASS);
    expect(verdict.detail).toContain('status=pass');
  });

  it('fails the document that made this gate necessary', () => {
    /*
     * The exact body recorded in
     * `evidence/2026-09-05-workers-vpc-namespace-identity.md` — right namespace,
     * HTTP 200, no `timestamp`. Transport and identity both read it as success;
     * `rails-health.ts` reports `invalid-contract` and the frame serves 503.
     */
    const body = JSON.stringify({
      status: 'pass',
      checks: {
        startup: { status: 'pass' },
        liveness: { status: 'pass' },
        readiness: { status: 'pass' },
      },
      namespace: 'core/app',
    });
    const verdict = classifyHealthContract({ entry: { status: 200, body }, transport: PASS });
    expect(verdict.status).toBe(FAIL);
    expect(verdict.detail).toContain('timestamp');
  });

  it('rejects a timestamp with no timezone, and accepts an explicit offset', () => {
    expect(
      classifyHealthContract({
        entry: { status: 200, body: document({ timestamp: '2026-09-06T09:33:29' }) },
        transport: PASS,
      }).status,
    ).toBe(FAIL);
    expect(
      classifyHealthContract({
        entry: { status: 200, body: document({ timestamp: '2026-09-06T18:33:29+09:00' }) },
        transport: PASS,
      }).status,
    ).toBe(PASS);
  });

  it('names every missing required field, not just the first', () => {
    const body = JSON.stringify({ status: 'up', checks: { startup: { status: 'pass' } } });
    const verdict = classifyHealthContract({ entry: { status: 200, body }, transport: PASS });
    expect(verdict.status).toBe(FAIL);
    for (const field of ['status', 'timestamp', 'checks.liveness', 'checks.readiness']) {
      expect(verdict.detail).toContain(field);
    }
  });

  it('passes a well-formed 503, because health is not this gate business', () => {
    // A 503 carrying `status=fail` means Rails was reached and is unhealthy.
    // The contract held; `Direct VPC → Rails` is what reports the health.
    const verdict = classifyHealthContract({
      entry: { status: 503, body: document({ status: 'fail' }) },
      transport: PASS,
    });
    expect(verdict.status).toBe(PASS);
  });

  it('fails a 200 that is not a JSON document at all', () => {
    for (const body of ['<!DOCTYPE html>', '', 'null']) {
      expect(classifyHealthContract({ entry: { status: 200, body }, transport: PASS }).status).toBe(
        FAIL,
      );
    }
  });

  it('blocks, never passes, when there is nothing to check', () => {
    expect(
      classifyHealthContract({ entry: { status: 200, body: document() }, transport: FAIL }).status,
    ).toBe(BLOCKED);
    expect(
      classifyHealthContract({ entry: { status: 404, body: '' }, transport: PASS }).status,
    ).toBe(BLOCKED);
    expect(classifyHealthContract({ entry: undefined, transport: PASS }).status).toBe(BLOCKED);
  });
});
