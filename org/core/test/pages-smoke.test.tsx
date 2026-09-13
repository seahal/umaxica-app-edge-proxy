import { afterEach, describe, expect, it } from 'vitest';

import { defaultLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';

import { resetEnv, setEnv } from './__mocks__/cloudflare-workers';
import { renderDocument } from './utils/routes';

/*
 * Every page this unit routes, rendered as the document a browser receives.
 *
 * The routes carry their own loaders, so driving a memory-history router renders
 * the real thing — shell, chrome and page together — rather than a component in
 * isolation behind a wall of mocks.
 */
const PAGES = [
  ['/', '/'],
  ['/about', '/about'],
  ['/explore', '/explore'],
  ['/messages', '/messages'],
  ['/notifications', '/notifications'],
  ['/configuration', '/configuration'],
  ['/configuration/account', '/configuration/account'],
  ['/doctor', '/doctor'],
  ['/publishing', '/publishing'],
] as const;

describe('page smoke', () => {
  afterEach(() => {
    resetEnv();
  });

  it.each(PAGES)('%s renders a document with one main landmark', async (_label, path) => {
    if (path === '/publishing') {
      setEnv({ RAILS_STAFF_BASE_ORIGIN: 'https://www.umaxica.org' });
    }
    const html = await renderDocument(path);

    expect(html).toContain('<html');
    expect(html.match(/<main\b/gu) ?? []).toHaveLength(1);
    expect(html).toContain('id="main-content"');
    // Every page under the `_page` layout carries the application chrome.
    expect(html).toContain('<header');
    expect(html).toContain('<nav');
    expect(html).toContain('<footer');
  });

  /*
   * Each page's OWN heading, not merely some heading.
   *
   * The weaker "renders an `<h1>`" version of this passed while
   * `/configuration/account` was silently rendering `/configuration` instead:
   * TanStack's flat routing had made `_page.configuration.tsx` the parent of
   * `_page.configuration.account.tsx`, and that parent renders no `<Outlet />`.
   * The URL and the title were both still correct, so only coverage noticed.
   * Comparing against the dictionary is what makes the child's absence visible.
   */
  it.each([
    ['/', 'home'],
    ['/about', 'about'],
    ['/explore', 'explore'],
    ['/messages', 'messages'],
    ['/notifications', 'notifications'],
    ['/configuration', 'configuration'],
    ['/configuration/account', 'configuration_account'],
    ['/doctor', 'doctor'],
    ['/publishing', 'publishing'],
  ] as const)('%s renders its own heading', async (path, key) => {
    if (path === '/publishing') {
      setEnv({ RAILS_STAFF_BASE_ORIGIN: 'https://www.umaxica.org' });
    }
    const dict = await getDictionary(defaultLocale);
    const html = await renderDocument(path);
    const heading = /<h1[^>]*>([^<]+)<\/h1>/u.exec(html)?.[1] ?? '';

    expect(heading.trim(), `${path}: rendered the wrong page's heading`).toBe(dict[key].title);
  });

  /*
   * `/home` is a long-standing alias for the index. It resolves to the index
   * document rather than serving one of its own.
   */
  it('redirects /home to the index', async () => {
    const html = await renderDocument('/home');

    expect(html).toContain('<html');
    expect(html.match(/<main\b/gu) ?? []).toHaveLength(1);
  });

  // Outside the `_page` layout, so chrome-free — the shape a failure or
  // interstitial document should have (docs/design/ui-shell-contract.md §15).
  it('serves /offline without the application chrome', async () => {
    const html = await renderDocument('/offline');

    expect(html).toContain('オフラインです');
    expect(html).not.toContain('<header');
    expect(html).not.toContain('<footer');
  });
});
