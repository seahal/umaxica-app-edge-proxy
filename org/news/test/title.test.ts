import { describe, expect, it } from 'vitest';

import { BRAND_TITLE, brandTitle } from '../src/lib/title';

describe('brand title', () => {
  it('joins a page title to the brand with an EM DASH', () => {
    expect(brandTitle('Docs')).toBe(`Docs — ${BRAND_TITLE}`);
    expect(BRAND_TITLE).toMatch(/^UMAXICA \((APP|COM|ORG)\)$/u);
  });
});
