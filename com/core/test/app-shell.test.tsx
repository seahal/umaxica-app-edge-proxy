import { fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ErrorDocument, NotFoundDocument } from '@/components/status-documents';
import { defaultLocale, isLocale, locales } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';

import { resetEnv, setEnv } from './__mocks__/cloudflare-workers';
import { handlers, renderDocument } from './utils/routes';

afterEach(() => {
  resetEnv();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('com/core application shell', () => {
  it('renders user-visible status and layout content', async () => {
    const reset = vi.fn();
    render(<ErrorDocument error={new Error('boom')} reset={reset} />);
    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(reset).toHaveBeenCalledOnce();

    expect(renderToStaticMarkup(<NotFoundDocument />)).toContain('HTTP 404');

    const pageHtml = await renderDocument('/');
    // The navigation is asserted in full by test/ui-shell-contract.test.tsx.
    expect(pageHtml).toContain('id="main-navigation"');
    expect(pageHtml).toContain('<html');
  });

  it('returns the public metadata documents', async () => {
    const manifest = await (await handlers.manifest()).json();
    expect(manifest).toMatchObject({ start_url: '/', display: 'standalone' });

    const robots = await (await handlers.robots()).text();
    expect(robots).toContain('Sitemap: https://jp.umaxica.com/sitemap.xml');

    const sitemap = await (await handlers.sitemap()).text();
    expect(sitemap).toContain('<loc>https://jp.umaxica.com</loc>');
    expect(sitemap).toContain('<changefreq>weekly</changefreq>');
  });
});

describe('com/core locale selection', () => {
  it('recognizes supported locales and loads both dictionaries', async () => {
    expect(defaultLocale).toBe('ja');
    expect(locales).toEqual(['en', 'ja']);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('ja')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    await expect(getDictionary('en')).resolves.toHaveProperty('home');
    await expect(getDictionary()).resolves.toHaveProperty('home');
  });

  it('delegates unsupported locales to the router not-found boundary', async () => {
    /*
     * `notFound()` comes from `@tanstack/react-router` now rather than
     * `next/navigation`, and the two differ in a way that matters: Next's threw
     * internally, TanStack's RETURNS the signal for the caller to throw. A bare
     * call would leave `getDictionary` falling through to a dictionary key that
     * does not exist — a crash, not a 404 — so this asserts the rejection
     * carries the router's not-found marker rather than merely that something
     * was thrown.
     */
    await expect(getDictionary('fr')).rejects.toMatchObject({ isNotFound: true });
  });
});

describe('com/core health route', () => {
  it('answers text/plain no-store after verifying the Rails Health API', async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            status: 'pass',
            timestamp: '2026-09-05T09:33:29Z',
            checks: {
              startup: { status: 'pass' },
              liveness: { status: 'pass' },
              readiness: { status: 'pass' },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    setEnv({
      REVISION: { id: 'revision-id', tag: 'revision-tag', timestamp: 'built-at' },
      RAILS_ORIGIN: 'https://rails.example',
    });
    vi.stubGlobal('fetch', fetch);

    const response = await handlers.health();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    await expect(response.text()).resolves.toBe(
      'status: ok\nstartup: ok\nliveness: ok\nreadiness: ok\n',
    );
    expect(fetch).toHaveBeenCalled();
    expect(String(fetch.mock.calls.at(0)?.at(0))).toContain('/api/v0/health.json');
  });
});
