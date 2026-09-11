import { describe, expect, it, vi } from 'vitest';

import { createRailsClient } from '../../src/lib/rails-client';

describe('Rails client edge cases', () => {
  it('rejects every dangerous relative-path form before fetching', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response('ok')));
    const client = createRailsClient({ fetch }, 'http://core.example.localhost:3000');

    await expect(client.fetch('/nested://scheme')).resolves.toMatchObject({
      kind: 'invalid-path',
      reason: 'path must not embed a scheme',
    });
    await expect(client.fetch('/withcontrol')).resolves.toMatchObject({
      kind: 'invalid-path',
      reason: 'path must not contain control characters',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports non-Error transport failures without losing their message', async () => {
    const client = createRailsClient(
      { fetch: vi.fn(() => Promise.reject('socket unavailable')) },
      'http://core.example.localhost:3000',
    );

    await expect(client.fetch('/health')).resolves.toEqual({
      kind: 'unreachable',
      errorMessage: 'socket unavailable',
    });
  });

  it('reports a non-500 HTTP error as http-error', async () => {
    const response = new Response('missing', {
      status: 404,
      headers: { 'content-type': 'text/plain' },
    });
    const client = createRailsClient(
      { fetch: vi.fn(() => Promise.resolve(response)) },
      'http://core.example.localhost:3000',
    );
    await expect(client.fetch('/missing')).resolves.toMatchObject({
      kind: 'http-error',
      status: 404,
    });
  });

  it('fails closed when the configured origin is not normalized', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response('ok')));
    const client = createRailsClient({ fetch }, 'http://core.example.localhost:3000/');

    await expect(client.fetch('/health')).resolves.toEqual({
      kind: 'invalid-path',
      reason: 'path resolved outside the fixed origin',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
