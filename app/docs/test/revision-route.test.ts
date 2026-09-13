import { afterEach, describe, expect, it } from 'vitest';

import { resetEnv, setEnv, setEnvShouldThrow } from './__mocks__/cloudflare-workers';
import { handlers } from './utils/routes';

afterEach(() => {
  resetEnv();
});

describe('revision text route', () => {
  it('returns the version id as text/plain', async () => {
    setEnv({ REVISION: { id: 'abc', tag: 't', timestamp: '2024-01-01T00:00:00.000Z' } });

    const response = await handlers.revision();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^text\/plain\b/u);
    expect(response.headers.get('cache-control')).toContain('no-store');
    await expect(response.text()).resolves.toBe('abc\n');
  });

  it('returns unknown when the binding is missing', async () => {
    setEnv({});
    await expect((await handlers.revision()).text()).resolves.toBe('unknown\n');
  });

  it('returns unknown when the environment cannot be read', async () => {
    setEnvShouldThrow(true);
    await expect((await handlers.revision()).text()).resolves.toBe('unknown\n');
  });
});

describe('revision JSON API', () => {
  it('returns every supplied metadata field', async () => {
    setEnv({ REVISION: { id: 'abc', tag: 't', timestamp: '2024-01-01T00:00:00.000Z' } });
    const response = await handlers.revisionApi();
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toEqual({
      id: 'abc',
      tag: 't',
      timestamp: '2024-01-01T00:00:00.000Z',
    });
  });

  it('returns null fields when the binding is missing or unreadable', async () => {
    setEnv({});
    await expect((await handlers.revisionApi()).json()).resolves.toEqual({
      id: null,
      tag: null,
      timestamp: null,
    });
    setEnvShouldThrow(true);
    await expect((await handlers.revisionApi()).json()).resolves.toEqual({
      id: null,
      tag: null,
      timestamp: null,
    });
  });
});
