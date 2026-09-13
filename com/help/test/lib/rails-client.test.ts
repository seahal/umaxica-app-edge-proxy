import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EdgeBindings } from '../../src/lib/env';
import { PRIVATE_RAILS_ORIGIN } from '../../src/lib/publishing-cell';
import { getRailsClient } from '../../src/lib/rails-client';
// `cloudflare:workers` is a runtime module only workerd resolves, so
// `vitest.config.ts` aliases it to this mutable stand-in. Installing a binding is
// therefore an assignment rather than a mock return value — the shape the runtime
// actually has.
import { env } from '../__mocks__/cloudflare-workers';

describe('rails client', () => {
  afterEach(() => {
    for (const key of Object.keys(env)) delete env[key];
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('uses the VPC binding when present', async () => {
    const fetchMock = vi.fn<(input: string) => Promise<Response>>(() =>
      Promise.resolve(new Response('ok', { status: 200 })),
    );
    env['UMAXICA_APPS_EDGE_CF_WORKERS_VPC'] = { fetch: fetchMock };

    const client = getRailsClient(env as EdgeBindings);
    expect(client).not.toBeNull();

    await client?.fetch('/edge/v0/health');

    const [requestUrl] = fetchMock.mock.calls[0] as [string];
    expect(new URL(requestUrl).host).toBe(new URL(PRIVATE_RAILS_ORIGIN).host);
    expect(new URL(requestUrl).pathname).toBe('/edge/v0/health');
  });

  it('uses the private Podman transport only for explicit local development', async () => {
    const fetchSpy = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response('ok', { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubEnv('EDGE_LOCAL_NODE_RUNTIME', '1');
    vi.stubEnv('EDGE_LOCAL_RAILS_ENABLED', '1');

    const client = getRailsClient(env as EdgeBindings);
    expect(client).not.toBeNull();

    await client?.fetch('/api/v0/health.json');

    const [requestUrl, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(new URL(requestUrl).origin).toBe(PRIVATE_RAILS_ORIGIN);
    expect(new URL(requestUrl).pathname).toBe('/api/v0/health.json');

    const headers = new Headers(init.headers);
    expect(headers.has('cf-access-client-id')).toBe(false);
    expect(headers.has('cf-access-client-secret')).toBe(false);
  });

  it('does not fabricate a local transport from the Rails overlay alone', () => {
    vi.stubEnv('EDGE_LOCAL_RAILS_ENABLED', '1');

    expect(getRailsClient(env as EdgeBindings)).toBeNull();
  });

  it('fails closed when local development has no Rails overlay', () => {
    vi.stubEnv('EDGE_LOCAL_NODE_RUNTIME', '1');

    expect(getRailsClient(env as EdgeBindings)).toBeNull();
  });

  it('fails closed to null when no binding exists', () => {
    const client = getRailsClient(env as EdgeBindings);

    expect(client).toBeNull();
  });

  it('treats a missing process.env as unset flags', () => {
    vi.stubGlobal('process', { env: null });
    expect(getRailsClient(env as EdgeBindings)).toBeNull();
  });

  it('treats an absent process as unset flags', () => {
    vi.stubGlobal('process', undefined);
    expect(getRailsClient(env as EdgeBindings)).toBeNull();
  });
});
