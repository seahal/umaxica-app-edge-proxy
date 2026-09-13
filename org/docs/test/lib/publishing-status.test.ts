import { describe, expect, it } from 'vitest';

import { ENTRY_CACHE_CONTROL, ENTRY_CACHE_TTL_SECONDS, NO_STORE } from '../../src/lib/cache-policy';
import {
  PUBLISHING_STATUS_HEADER,
  applyPublishingStatus,
  publishingFailureHeaders,
  publishingPageHeaders,
} from '../../src/lib/publishing-status';

describe('cache policy', () => {
  it('is a short public TTL defined once', () => {
    expect(ENTRY_CACHE_TTL_SECONDS).toBe(60);
    expect(ENTRY_CACHE_CONTROL).toBe('public, max-age=60, s-maxage=60');
    expect(NO_STORE).toBe('no-store');
  });
});

describe('publishing page headers', () => {
  it('gives rendered content the route cache policy', () => {
    expect(publishingPageHeaders({ kind: 'ok' }, ENTRY_CACHE_CONTROL)).toEqual({
      'Cache-Control': ENTRY_CACHE_CONTROL,
    });
  });

  it('never caches a failure, and names its status', () => {
    expect(publishingPageHeaders({ kind: 'error', status: 504 }, ENTRY_CACHE_CONTROL)).toEqual({
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      [PUBLISHING_STATUS_HEADER]: '504',
    });
  });

  it('never caches a page that produced no data (not-found)', () => {
    expect(publishingPageHeaders(undefined, ENTRY_CACHE_CONTROL)).toEqual(
      publishingFailureHeaders(),
    );
    expect(publishingFailureHeaders()['Cache-Control']).toBe('no-store');
  });
});

describe('applyPublishingStatus', () => {
  const rendered = (status: number, value?: string) =>
    new Response('x', {
      status,
      headers: value === undefined ? {} : { [PUBLISHING_STATUS_HEADER]: value },
    });

  it('leaves a response without the header alone', () => {
    const response = rendered(200);
    expect(applyPublishingStatus(response)).toBe(response);
  });

  it('applies an allowed failure status to a rendered 200 and drops the header', () => {
    const response = applyPublishingStatus(rendered(200, '503'));
    expect(response.status).toBe(503);
    expect(response.headers.has(PUBLISHING_STATUS_HEADER)).toBe(false);
  });

  it.each([
    [200, '200'],
    [200, '302'],
    [200, '404'],
    [200, 'abc'],
    [404, '503'],
    [500, '502'],
  ])('keeps status %i when the header says %j, and still drops the header', (status, value) => {
    const response = applyPublishingStatus(rendered(status, value));
    expect(response.status).toBe(status);
    expect(response.headers.has(PUBLISHING_STATUS_HEADER)).toBe(false);
  });
});
