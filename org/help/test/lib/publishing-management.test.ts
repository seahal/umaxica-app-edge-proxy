import { describe, expect, it } from 'vitest';

import { THIS_CELL } from '../../src/lib/publishing-api';
import { PUBLISHING_AUDIENCE, PUBLISHING_SURFACE } from '../../src/lib/publishing-cell';
import { managementEditUrl, managementIndexUrl } from '../../src/lib/publishing-management';
import { parseRailsStaffOrigin } from '../../src/lib/rails-staff-origin';

const ORIGIN = 'https://www.umaxica.org';

describe('Rails staff origin', () => {
  it('accepts a browser-facing origin and rejects VPC surface hosts', () => {
    expect(parseRailsStaffOrigin(ORIGIN)).toBe(ORIGIN);
    expect(parseRailsStaffOrigin('https://www.umaxica.org/')).toBe(ORIGIN);
    expect(() => parseRailsStaffOrigin(undefined)).toThrow(/not configured/u);
    expect(() => parseRailsStaffOrigin('')).toThrow(/not configured/u);
    expect(() => parseRailsStaffOrigin('not a url')).toThrow(/not a valid URL/u);
    expect(() => parseRailsStaffOrigin('ftp://base.org.localhost')).toThrow(/http/u);
    expect(() => parseRailsStaffOrigin('https://user:pw@www.umaxica.org')).toThrow(/credentials/u);
    expect(() => parseRailsStaffOrigin('https://www.umaxica.org/publishing')).toThrow(/no path/u);
    expect(() => parseRailsStaffOrigin('https://www.umaxica.org/?x=1')).toThrow(/query/u);
    expect(() => parseRailsStaffOrigin('http://news.org.localhost:3000')).toThrow(/VPC/u);
    expect(() => parseRailsStaffOrigin('http://core.org.localhost:3000')).toThrow(/VPC/u);
  });
});

describe('publishing management URLs', () => {
  const prefix = `${ORIGIN}/publishing/${PUBLISHING_SURFACE}/${PUBLISHING_AUDIENCE}/entries`;

  it('builds the collection URL from this cell', () => {
    expect(managementIndexUrl(ORIGIN, THIS_CELL)).toBe(prefix);
  });

  it('builds the edit URL from this cell and public_id, never a slug or numeric id', () => {
    expect(managementEditUrl(ORIGIN, THIS_CELL, '01ABC')).toBe(`${prefix}/01ABC/edit`);
    expect(managementEditUrl(ORIGIN, THIS_CELL, 'id/with space')).toBe(
      `${prefix}/${encodeURIComponent('id/with space')}/edit`,
    );
    expect(() => managementEditUrl(ORIGIN, THIS_CELL, '')).toThrow(/public_id/u);
  });

  it('refuses a cell outside the twelve', () => {
    const bogus = { surface: 'blog', audience: 'net' } as never;
    expect(() => managementIndexUrl(ORIGIN, bogus)).toThrow(/unknown publishing cell/u);
  });
});
