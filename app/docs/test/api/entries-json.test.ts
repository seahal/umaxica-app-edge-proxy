import { describe, expect, it } from 'vitest';

import { GET } from '../../src/pages/api/v0/entries';

describe('GET /api/v0/entries', () => {
  it('rejects an unknown locale', async () => {
    const response = await GET({
      url: new URL('https://example.test/api/v0/entries?locale=fr'),
    } as never);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid-locale' });
  });

  it('returns 503 JSON when Rails is not configured, without leaking internals', async () => {
    const response = await GET({
      url: new URL('https://example.test/api/v0/entries?locale=ja'),
    } as never);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'unavailable' });
    expect(response.headers.get('content-type')).toMatch(/json/u);
  });
});
