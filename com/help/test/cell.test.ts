import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  BRAND_TITLE,
  CANONICAL_ORIGINS,
  PRIVATE_RAILS_ORIGIN,
  PUBLISHING_AUDIENCE,
  PUBLISHING_SURFACE,
} from '../src/lib/publishing-cell';
import { PUBLISHING_AUDIENCES, PUBLISHING_SURFACES } from '../src/lib/publishing-model';

/*
 * This unit's cell declaration, checked against the directory the unit lives in.
 *
 * The runtime never reads the directory — the cell is a static literal — but the
 * literal and the deployment unit must agree, and every derived value must be
 * the one this cell owns. The repository-root `test/publishing-cells.test.ts`
 * runs the same agreement across all twelve units at once.
 */
const unitRoot = resolve(import.meta.dirname, '..');
const [audienceDir, surfaceDir] = unitRoot.split('/').slice(-2);

describe('this unit’s publishing cell', () => {
  it('is one of the twelve, and is the directory it is deployed from', () => {
    expect(PUBLISHING_SURFACES).toContain(PUBLISHING_SURFACE);
    expect(PUBLISHING_AUDIENCES).toContain(PUBLISHING_AUDIENCE);
    expect(PUBLISHING_SURFACE).toBe(surfaceDir);
    expect(PUBLISHING_AUDIENCE).toBe(audienceDir);
  });

  it('derives every cell-owned value from that one cell', () => {
    expect(BRAND_TITLE).toBe(`UMAXICA (${PUBLISHING_AUDIENCE.toUpperCase()})`);
    expect(CANONICAL_ORIGINS).toEqual({
      jp: `https://${PUBLISHING_SURFACE}-jp.umaxica.${PUBLISHING_AUDIENCE}`,
      us: `https://${PUBLISHING_SURFACE}-us.umaxica.${PUBLISHING_AUDIENCE}`,
    });
    expect(PRIVATE_RAILS_ORIGIN).toBe(
      `http://${PUBLISHING_SURFACE}.${PUBLISHING_AUDIENCE}.localhost:3000`,
    );
  });

  it('names this unit’s Worker after the cell', () => {
    const pkg = JSON.parse(readFileSync(resolve(unitRoot, 'package.json'), 'utf8')) as {
      name: string;
    };
    expect(pkg.name).toBe(`umaxica-apps-edge-${PUBLISHING_AUDIENCE}-${PUBLISHING_SURFACE}`);
    const wrangler = readFileSync(resolve(unitRoot, 'wrangler.jsonc'), 'utf8');
    expect(wrangler).toContain(
      `"name": "umaxica-apps-edge-${PUBLISHING_AUDIENCE}-${PUBLISHING_SURFACE}"`,
    );
  });
});
