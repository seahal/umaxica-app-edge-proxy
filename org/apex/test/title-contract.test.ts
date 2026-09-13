import { describe, expect, it } from 'vitest';

import { createApexApp } from '../src/create-apex-app';
import { expectTitleContract } from './utils/title-contract';

/*
 * The `<title>` contract on the one document no HTTP client can ask for.
 *
 * `/about`, `/health`, `/offline` and the 404 (including `/health.html` and
 * `/health.json`) are checked against real responses in
 * `api/title-contract.hurl`. Those two paths are HTML 404, not health
 * documents. The 500 document needs a route that throws,
 * so it stays here — and it is the case most likely to break, because it is
 * built by a string literal in `create-apex-app.ts` rather than by the renderer
 * every other page goes through.
 *
 * `test/utils/title-contract.ts` remains the single statement of the rules for
 * this unit.
 */
describe('apex 500 document', () => {
  it('serves a contract-conforming title', async () => {
    const boom = createApexApp((pageRoutes) => {
      pageRoutes.get('/boom', () => {
        throw new Error('induced failure');
      });
    });

    const response = await boom.request('/boom', {}, { CF_VERSION_METADATA: {} });
    expect(response.status).toBe(500);
    expectTitleContract(await response.text(), {
      requirePageSpecific: true,
      label: 'apex 500',
    });
  });
});
