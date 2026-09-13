import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkRailsHealth } from '../src/lib/rails-health';
import * as runtimeHealth from '../src/lib/runtime-health';
import { resetEnv, setEnv } from './__mocks__/cloudflare-workers';
import { handlers } from './utils/routes';

const GET = handlers.health;

afterEach(() => {
  vi.restoreAllMocks();
  resetEnv();
});

function expectPlainHealth(response: Response) {
  expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  expect(response.headers.get('cache-control')).toBe('no-store');
}

const PASS_DOCUMENT = {
  status: 'pass',
  timestamp: '2026-09-05T09:33:29Z',
  checks: {
    startup: { status: 'pass' },
    liveness: { status: 'pass' },
    readiness: { status: 'pass' },
  },
};

const EDGE_SELF_HEALTH_DOCUMENT = {
  status: 'pass',
  checks: {
    startup: { status: 'pass' },
    liveness: { status: 'pass' },
    readiness: { status: 'pass' },
  },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('health probes', () => {
  it('answers 200 text/plain on all four URLs when Rails is not configured', async () => {
    for (const get of [GET, handlers.startups, handlers.livenesses, handlers.readinesses]) {
      const response = await get();
      expect(response.status).toBe(200);
      expectPlainHealth(response);
      const body = await response.text();
      expect(body).not.toContain('{');
      expect(body).not.toContain('<html');
    }
  });

  it('returns ok bodies for individual probes and the aggregate document', async () => {
    await expect((await handlers.startups()).text()).resolves.toBe('ok\n');
    await expect((await handlers.livenesses()).text()).resolves.toBe('ok\n');
    await expect((await handlers.readinesses()).text()).resolves.toBe('ok\n');
    await expect((await GET()).text()).resolves.toBe(
      'status: ok\nstartup: ok\nliveness: ok\nreadiness: ok\n',
    );
  });

  it('answers 503 when isolate readiness fails, without failing liveness', async () => {
    vi.spyOn(runtimeHealth.runtimeProbes, 'checkReadiness').mockReturnValue('error');

    const ready = await handlers.readinesses();
    expect(ready.status).toBe(503);
    await expect(ready.text()).resolves.toBe('error\n');

    const live = await handlers.livenesses();
    expect(live.status).toBe(200);
    await expect(live.text()).resolves.toBe('ok\n');

    const aggregate = await GET();
    expect(aggregate.status).toBe(503);
    await expect(aggregate.text()).resolves.toBe(
      'status: error\nstartup: ok\nliveness: ok\nreadiness: error\n',
    );
  });

  it('does not probe Rails or any other downstream on liveness', async () => {
    const fetch = vi.fn(() => Promise.reject(new Error('connect ECONNREFUSED core.app.localhost')));
    setEnv({ UMAXICA_APPS_EDGE_CF_WORKERS_VPC: { fetch } });

    const response = await handlers.livenesses();

    expect(response.status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
    const body = await response.text();
    expect(body).toBe('ok\n');
    expect(body).not.toContain('ECONNREFUSED');
    expect(body).not.toContain('core.app.localhost');
  });

  it('maps Rails Health API pass onto Edge 200 text/plain', async () => {
    const fetch = vi.fn(() => Promise.resolve(jsonResponse(200, PASS_DOCUMENT)));
    setEnv({ UMAXICA_APPS_EDGE_CF_WORKERS_VPC: { fetch } });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalled();
    const requested = String(fetch.mock.calls.at(0)?.at(0));
    expect(new URL(requested).pathname).toBe('/api/v0/health.json');
    const body = await response.text();
    expect(body).toBe('status: ok\nstartup: ok\nliveness: ok\nreadiness: ok\n');
    expect(body).not.toContain('"status":"pass"');
  });

  it('maps Rails Health API fail onto Edge 503 without forwarding the JSON', async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(
        jsonResponse(503, {
          status: 'fail',
          timestamp: '2026-09-05T09:33:29Z',
          checks: {
            startup: { status: 'pass' },
            liveness: { status: 'pass' },
            readiness: { status: 'fail' },
          },
        }),
      ),
    );
    setEnv({ UMAXICA_APPS_EDGE_CF_WORKERS_VPC: { fetch } });

    const aggregate = await GET();
    const ready = await handlers.readinesses();
    const live = await handlers.livenesses();

    expect(aggregate.status).toBe(503);
    expect(ready.status).toBe(503);
    expect(live.status).toBe(200);
    const body = await aggregate.text();
    expect(body).toBe('status: error\nstartup: ok\nliveness: ok\nreadiness: error\n');
    expect(body).not.toContain('fail');
    expect(body).not.toContain('{');
  });

  it('maps Rails unreachable onto Edge 503 readiness', async () => {
    const fetch = vi.fn(() => Promise.reject(new Error('connect ECONNREFUSED core.app.localhost')));
    setEnv({ UMAXICA_APPS_EDGE_CF_WORKERS_VPC: { fetch } });

    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain('readiness: error');
    expect(body).not.toContain('ECONNREFUSED');
    expect(body).not.toContain('core.app.localhost');
  });

  it('maps an invalid Rails Health API contract onto Edge 503', async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(
        new Response('not json', { status: 200, headers: { 'content-type': 'text/plain' } }),
      ),
    );
    setEnv({ UMAXICA_APPS_EDGE_CF_WORKERS_VPC: { fetch } });

    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('not json');
  });
});

describe('Edge self-health API', () => {
  it('answers pass JSON without calling Rails or fetch', async () => {
    const fetch = vi.fn(() => Promise.reject(new Error('must not hop')));
    setEnv({ UMAXICA_APPS_EDGE_CF_WORKERS_VPC: { fetch } });

    const response = await handlers.healthApi();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(fetch).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual(EDGE_SELF_HEALTH_DOCUMENT);
  });
});

describe('rails-health helper stays closed', () => {
  it('still reports kinds without leaking exception text', async () => {
    const report = await checkRailsHealth(null);
    expect(report).toEqual({ kind: 'not-configured' });
  });
});
