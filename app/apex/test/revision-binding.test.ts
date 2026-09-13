import { describe, expect, it } from 'vitest';

import { createApexApp } from '../src/create-apex-app';

describe('revision binding', () => {
  it('maps full version metadata onto JSON and the text id', async () => {
    const app = createApexApp(() => undefined);
    const env = {
      CF_VERSION_METADATA: {
        id: 'version-id',
        tag: 'release-tag',
        timestamp: '2026-08-29T16:00:00.000Z',
      },
    };

    // A real HTTP client cannot inject a Workers binding, so app.request() is
    // used only as the driver for this binding-to-response mapping.
    const json = await app.request('/api/v0/revision.json', {}, env);
    await expect(json.json()).resolves.toEqual({
      id: 'version-id',
      tag: 'release-tag',
      timestamp: '2026-08-29T16:00:00.000Z',
    });

    const text = await app.request('/revision', {}, env);
    await expect(text.text()).resolves.toBe('version-id\n');
    expect(text.headers.get('content-type')).toMatch(/^text\/plain\b/u);
  });

  it('uses null JSON fields and unknown text when the binding omits values', async () => {
    const app = createApexApp(() => undefined);
    const json = await app.request('/api/v0/revision.json', {}, { CF_VERSION_METADATA: {} });
    await expect(json.json()).resolves.toEqual({ id: null, tag: null, timestamp: null });
    const text = await app.request('/revision', {}, { CF_VERSION_METADATA: {} });
    await expect(text.text()).resolves.toBe('unknown\n');
  });

  /*
   * No binding at all, which is what `app.request()` hands the app and what a
   * deployment without `version_metadata` would too. JSON answers three nulls;
   * text answers the non-JSON sentinel `unknown`.
   */
  it('answers nulls and unknown when the binding is absent entirely', async () => {
    const app = createApexApp(() => undefined);
    const json = await app.request('/api/v0/revision.json');
    await expect(json.json()).resolves.toEqual({ id: null, tag: null, timestamp: null });
    const text = await app.request('/revision');
    await expect(text.text()).resolves.toBe('unknown\n');
  });
});
