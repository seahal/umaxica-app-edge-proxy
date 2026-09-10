import { describe, expect, it } from 'vitest';

import { PUBLISHING_NAMESPACE, PUBLISHING_SURFACE } from '../../src/lib/publishing-cell';
import { managementEditUrl, managementIndexUrl } from '../../src/lib/publishing-management';
import { parseRailsStaffOrigin } from '../../src/lib/rails-staff-origin';

const ORIGIN = 'http://base.org.localhost:3000';

describe('Rails staff origin', () => {
  it('accepts a browser-facing origin and rejects VPC surface hosts', () => {
    expect(parseRailsStaffOrigin(ORIGIN)).toBe(ORIGIN);
    expect(() => parseRailsStaffOrigin(undefined)).toThrow(/not configured/u);
    expect(() => parseRailsStaffOrigin('not a url')).toThrow(/not a valid URL/u);
    expect(() => parseRailsStaffOrigin('ftp://base.org.localhost')).toThrow(/http/u);
    expect(() => parseRailsStaffOrigin('http://base.org.localhost:3000/publishing')).toThrow(
      /no path/u,
    );
    expect(() => parseRailsStaffOrigin('http://news.org.localhost:3000')).toThrow(/VPC/u);
    expect(() => parseRailsStaffOrigin('http://core.org.localhost:3000')).toThrow(/VPC/u);
  });
});

describe('publishing management URLs', () => {
  it('builds index and edit URLs from this unit cell and public_id', () => {
    expect(managementIndexUrl(ORIGIN, PUBLISHING_NAMESPACE, PUBLISHING_SURFACE)).toBe(
      `${ORIGIN}/publishing/${PUBLISHING_NAMESPACE}/${PUBLISHING_SURFACE}/entries`,
    );
    expect(managementEditUrl(ORIGIN, PUBLISHING_NAMESPACE, PUBLISHING_SURFACE, '01ABC')).toBe(
      `${ORIGIN}/publishing/${PUBLISHING_NAMESPACE}/${PUBLISHING_SURFACE}/entries/01ABC/edit`,
    );
    expect(
      managementEditUrl(ORIGIN, PUBLISHING_NAMESPACE, PUBLISHING_SURFACE, 'id/with space'),
    ).toBe(
      `${ORIGIN}/publishing/${PUBLISHING_NAMESPACE}/${PUBLISHING_SURFACE}/entries/id%2Fwith%20space/edit`,
    );
    expect(
      managementEditUrl(ORIGIN, PUBLISHING_NAMESPACE, PUBLISHING_SURFACE, '01ABC'),
    ).not.toContain('welcome');
    expect(
      managementEditUrl(ORIGIN, PUBLISHING_NAMESPACE, PUBLISHING_SURFACE, '01ABC'),
    ).not.toMatch(/\/\d+\/edit$/u);
  });
});
