import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApexApp } from '../src/create-apex-app';
import * as statusPage from '../src/status-page';

afterEach(() => vi.restoreAllMocks());

/*
 * `/offline` and `notFound` are HTTP surfaces: status, headers and bodies live
 * in `api/*.hurl`. What Vitest can still prove is that `createApexApp` wires
 * each path to the helper this unit owns. `app.request()` is the driver, never
 * the subject.
 */
describe('apex surfaces wired to their helpers', () => {
  it.each(['/health.html', '/health.json'])(
    'sends %s through notFoundPage, not a health helper',
    async (path) => {
      const page = vi.spyOn(statusPage, 'notFoundPage');
      const app = createApexApp(() => undefined);
      const response = await app.request(path, {
        headers: { accept: 'application/json', 'accept-language': 'ja' },
      });
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toBe('text/html; charset=UTF-8');
      expect(page).toHaveBeenCalledWith('ja', undefined);
    },
  );

  it('runs /offline through offlinePageMarkup', async () => {
    const markup = vi.spyOn(statusPage, 'offlinePageMarkup');
    const app = createApexApp(() => undefined);
    await app.request('/offline');
    expect(markup).toHaveBeenCalled();
  });

  it('runs an unmatched path through notFoundPage', async () => {
    const page = vi.spyOn(statusPage, 'notFoundPage');
    const app = createApexApp(() => undefined);
    await app.request('/no-such-apex-surface', { headers: { 'accept-language': 'ja' } });
    // `expect.anything()` does not match that.
    expect(page).toHaveBeenCalledWith('ja', undefined);
  });
});
