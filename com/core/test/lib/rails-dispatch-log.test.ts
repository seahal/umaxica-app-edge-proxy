// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dispatchToRails } from '../../src/lib/core-dispatch';
import {
  classifyRailsRouteClass,
  logRailsDispatch,
  normalizeRailsMethod,
  type RailsDispatchLogEntry,
} from '../../src/lib/rails-dispatch-log';

let emitted: { channel: 'log' | 'warn' | 'error'; line: string }[] = [];

beforeEach(() => {
  emitted = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    emitted.push({ channel: 'log', line });
  });
  vi.spyOn(console, 'warn').mockImplementation((line: string) => {
    emitted.push({ channel: 'warn', line });
  });
  vi.spyOn(console, 'error').mockImplementation((line: string) => {
    emitted.push({ channel: 'error', line });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The one log line the last call produced, parsed. */
function onlyLine() {
  expect(emitted).toHaveLength(1);
  const entry = emitted[0];
  if (!entry) {
    throw new Error('no log line was emitted');
  }
  return { channel: entry.channel, raw: entry.line, json: JSON.parse(entry.line) };
}

const BASE: RailsDispatchLogEntry = {
  route_class: 'api_v0',
  method: 'GET',
  outcome: 'rails_ok',
  duration_ms: 12,
};

const RAILS_HOST = 'rails.internal.example';
const RAILS_ENV = { RAILS_ORIGIN: `https://${RAILS_HOST}` };

/** Dispatches against a stubbed runtime `fetch`. */
function dispatchWith(request: Request, fetch: unknown) {
  vi.stubGlobal('fetch', fetch);
  return dispatchToRails(request, RAILS_ENV, true);
}

describe('classifyRailsRouteClass', () => {
  it.each([
    ['/api/v0/session', 'api_v0'],
    ['/api/v0', 'api_v0'],
    ['/web/v0/thing', 'web_v0'],
    ['/edge/v0/widgets', 'edge_v0'],
    ['/oidc/callback', 'oidc'],
    ['/oidc', 'oidc'],
    ['/sign/out', 'sign_out'],
    ['/sign/out/complete', 'sign_out'],
    ['/.well-known/jwks.json', 'jwks'],
    ['/csp-violation-report', 'csp_report'],
    ['/', 'other'],
    ['/health', 'other'],
    ['/apiv0-lookalike', 'other'],
    ['/api/v0extra', 'other'],
  ])('classifies %s as %s', (pathname, expected) => {
    expect(classifyRailsRouteClass(pathname)).toBe(expected);
  });

  it('never returns the pathname itself, however identifying it is', () => {
    // The whole point of the class: a path carrying a user id must not become a
    // log label. Cardinality stays at eight, and nothing is echoed.
    const identifying = '/api/v0/users/2f1c9e/email/alice%40example.com';
    expect(classifyRailsRouteClass(identifying)).toBe('api_v0');
    expect(classifyRailsRouteClass(identifying)).not.toContain('2f1c9e');
  });
});

describe('normalizeRailsMethod', () => {
  it.each(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])(
    'keeps the standard method %s',
    (method) => {
      expect(normalizeRailsMethod(method)).toBe(method);
    },
  );

  it('upper-cases a lowercase method', () => {
    expect(normalizeRailsMethod('post')).toBe('POST');
  });

  it.each(['TRACE', 'PROPFIND', 'session=abc123', ''])('folds %s into OTHER', (method) => {
    expect(normalizeRailsMethod(method)).toBe('OTHER');
  });
});

describe('logRailsDispatch shape', () => {
  it('emits one JSON line carrying the fixed envelope and the ownership marker', () => {
    logRailsDispatch(BASE);

    const { json, channel } = onlyLine();
    expect(channel).toBe('log');
    expect(json).toEqual({
      level: 'info',
      msg: 'rails_dispatch',
      data: {
        event: 'rails_dispatch',
        ownership: 'rails',
        method: 'GET',
        route_class: 'api_v0',
        outcome: 'rails_ok',
        duration_ms: 12,
      },
    });
  });

  it('omits upstream_status entirely when no response arrived', () => {
    logRailsDispatch({ ...BASE, outcome: 'upstream_unreachable' });
    expect(onlyLine().raw).not.toContain('upstream_status');
  });

  it('includes upstream_status when a response arrived', () => {
    logRailsDispatch({ ...BASE, outcome: 'rails_http_error', upstream_status: 500 });

    expect(onlyLine().json.data).toMatchObject({ upstream_status: 500 });
  });

  it.each([
    ['rails_ok', 'info', 'log'],
    ['rails_http_error', 'warn', 'warn'],
    ['upstream_unreachable', 'error', 'error'],
    ['timeout', 'error', 'error'],
    ['origin_not_configured', 'error', 'error'],
  ] as const)('reports %s at level %s on console.%s', (outcome, level, channel) => {
    logRailsDispatch({ ...BASE, outcome });

    const line = onlyLine();
    expect(line.json.level).toBe(level);
    expect(line.channel).toBe(channel);
    expect(line.json.data.outcome).toBe(outcome);
  });
});

describe('dispatchToRails logging', () => {
  const ORIGIN = 'https://jp.umaxica.com';

  it('distinguishes all five outcomes', async () => {
    const cases: [() => Promise<Response>, string][] = [
      [() => dispatchToRails(new Request(`${ORIGIN}/api/v0/x`), {}, true), 'origin_not_configured'],
      [
        () =>
          dispatchWith(
            new Request(`${ORIGIN}/api/v0/x`),
            vi.fn().mockResolvedValue(new Response('ok', { status: 200 })),
          ),
        'rails_ok',
      ],
      [
        () =>
          dispatchWith(
            new Request(`${ORIGIN}/api/v0/x`),
            vi.fn().mockResolvedValue(new Response('nope', { status: 404 })),
          ),
        'rails_http_error',
      ],
      [
        () =>
          dispatchWith(
            new Request(`${ORIGIN}/api/v0/x`),
            vi.fn().mockRejectedValue(new Error('down')),
          ),
        'upstream_unreachable',
      ],
      [
        () =>
          dispatchWith(
            new Request(`${ORIGIN}/api/v0/x`),
            vi.fn().mockRejectedValue(Object.assign(new Error('slow'), { name: 'TimeoutError' })),
          ),
        'timeout',
      ],
    ];

    for (const [run, expected] of cases) {
      emitted = [];
      await run();
      expect(onlyLine().json.data.outcome).toBe(expected);
    }
  });

  it('treats a Rails 3xx as Rails answering normally', async () => {
    await dispatchWith(
      new Request(`${ORIGIN}/sign/out`),
      vi
        .fn()
        .mockResolvedValue(
          new Response(null, { status: 302, headers: { location: `${ORIGIN}/` } }),
        ),
    );

    expect(onlyLine().json.data).toMatchObject({ outcome: 'rails_ok', route_class: 'sign_out' });
  });

  it('records a duration on every path', async () => {
    await dispatchToRails(new Request(`${ORIGIN}/api/v0/x`), {}, true);
    const { duration_ms } = onlyLine().json.data;
    expect(typeof duration_ms).toBe('number');
    expect(duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('logs exactly once per dispatch', async () => {
    await dispatchWith(
      new Request(`${ORIGIN}/api/v0/x`),
      vi.fn().mockResolvedValue(new Response('ok')),
    );
    expect(emitted).toHaveLength(1);
  });
});

describe('dispatchToRails logging: no credentials or PII', () => {
  const ORIGIN = 'https://jp.umaxica.com';

  const SECRETS = {
    cookie: 'session=SECRET_SESSION_VALUE; _csrf=SECRET_CSRF',
    authorization: 'Bearer SECRET_ACCESS_TOKEN',
    'x-csrf-token': 'SECRET_CSRF_HEADER',
    'x-api-key': 'SECRET_API_KEY',
  };

  const FORBIDDEN = [
    'SECRET_SESSION_VALUE',
    'SECRET_CSRF',
    'SECRET_ACCESS_TOKEN',
    'SECRET_CSRF_HEADER',
    'SECRET_API_KEY',
    // Query string, path identifiers and the request body.
    'alice@example.com',
    'user-9f2c',
    'SECRET_REQUEST_BODY',
    // Response body.
    'SECRET_RESPONSE_BODY',
    // The Rails hostname.
    RAILS_HOST,
    // The raw pathname must never appear either.
    '/api/v0/users/user-9f2c',
  ];

  it.each([
    [
      'a successful dispatch',
      () => vi.fn().mockResolvedValue(new Response(`SECRET_RESPONSE_BODY ${RAILS_HOST}`)),
    ],
    [
      'a Rails error',
      () => vi.fn().mockResolvedValue(new Response('SECRET_RESPONSE_BODY', { status: 500 })),
    ],
    [
      'a transport rejection',
      () =>
        vi.fn().mockRejectedValue(new Error(`connect ECONNREFUSED ${RAILS_HOST} SECRET_API_KEY`)),
    ],
  ])('leaks nothing on %s', async (_label, makeFetch) => {
    const request = new Request(
      `${ORIGIN}/api/v0/users/user-9f2c?email=alice%40example.com&token=SECRET_ACCESS_TOKEN`,
      { method: 'POST', headers: SECRETS, body: 'SECRET_REQUEST_BODY' },
    );

    await dispatchWith(request, makeFetch());

    const allOutput = emitted.map((entry) => entry.line).join('\n');
    expect(allOutput).not.toBe('');
    for (const marker of FORBIDDEN) {
      expect(allOutput, `log leaked ${marker}`).not.toContain(marker);
    }
  });

  it('emits only the seven permitted keys', async () => {
    await dispatchWith(
      new Request(`${ORIGIN}/api/v0/x`, { headers: SECRETS }),
      vi.fn().mockResolvedValue(new Response('ok')),
    );

    const { json } = onlyLine();
    expect(Object.keys(json).sort()).toEqual(['data', 'level', 'msg']);
    // A closed set: anything new here is a deliberate contract change, not a
    // field that drifted in at a call site.
    expect(Object.keys(json.data as Record<string, unknown>).sort()).toEqual([
      'duration_ms',
      'event',
      'method',
      'outcome',
      'ownership',
      'route_class',
      'upstream_status',
    ]);
  });
});
