import { describe, expect, it } from 'vitest';

import {
  PUBLISHING_AUDIENCES,
  PUBLISHING_CELLS,
  PUBLISHING_SURFACES,
  managementEditUrl,
  managementIndexUrl,
} from '@/lib/publishing-management';
import { parseRailsStaffOrigin } from '@/lib/rails-staff-origin';

const ORIGIN = 'http://base.org.localhost:3000';

describe('Rails staff origin', () => {
  it('fails closed rather than constructing an invalid origin', () => {
    expect(parseRailsStaffOrigin(ORIGIN)).toBe(ORIGIN);
    expect(() => parseRailsStaffOrigin(undefined)).toThrow(/not configured/u);
    expect(() => parseRailsStaffOrigin('')).toThrow(/not configured/u);
    expect(() => parseRailsStaffOrigin('not a url')).toThrow(/not a valid URL/u);
    expect(() => parseRailsStaffOrigin('http://news.org.localhost:3000')).toThrow(/VPC/u);
    expect(() => parseRailsStaffOrigin('http://core.org.localhost:3000')).toThrow(/VPC/u);
  });
});

describe('publishing management URLs', () => {
  it('covers all 12 cells with public_id member identity', () => {
    expect(PUBLISHING_CELLS).toHaveLength(12);
    expect(PUBLISHING_SURFACES).toEqual(['info', 'docs', 'news', 'help']);
    expect(PUBLISHING_AUDIENCES).toEqual(['app', 'com', 'org']);

    for (const { surface, audience } of PUBLISHING_CELLS) {
      const index = managementIndexUrl(ORIGIN, surface, audience);
      expect(index).toBe(`${ORIGIN}/publishing/${surface}/${audience}/entries`);
      const edit = managementEditUrl(ORIGIN, surface, audience, '01ABC');
      expect(edit).toBe(`${ORIGIN}/publishing/${surface}/${audience}/entries/01ABC/edit`);
      expect(edit).not.toContain('slug');
      expect(edit).not.toMatch(/\/\d+\/edit$/u);
    }
  });
});
