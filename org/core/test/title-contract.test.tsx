import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';

import { ErrorDocument } from '@/components/status-documents';

import { setEnv } from './__mocks__/cloudflare-workers';
import { headTitleOf, renderDocument, rootRoute } from './utils/routes';
import { expectTitleContract, FORBIDDEN_TOKEN, TLD } from './utils/title-contract';

/*
 * The `<title>` contract, asserted on rendered documents rather than on exported
 * metadata.
 *
 * Next resolved `metadata.title.default` and `metadata.title.template` into one
 * string, so the old version of this file could assert on the exported objects.
 * TanStack has neither: a route's `head()` returns a finished title and
 * `<HeadContent />` renders it, so the only place the contract is observable is
 * the document.
 */
const routesDir = resolve(import.meta.dirname, '..', 'src', 'routes');

/**
 * Every route that renders an HTML document, and the URL it answers.
 *
 * Derived from disk rather than listed, so a new page route joins the contract by
 * existing. `.ts` route files are server routes — JSON, XML or plain text, no
 * title — `__root` is the shell, and `_page.tsx` is the pathless layout that
 * wraps the rest without answering a URL of its own.
 */
function documentRoutes(): { file: string; path: string }[] {
  return readdirSync(routesDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith('.tsx') &&
        entry.name !== '__root.tsx' &&
        entry.name !== '_page.tsx' &&
        entry.name !== '_page.home.tsx',
    )
    .map((entry) => {
      const base = entry.name.replace(/\.tsx$/u, '').replace(/^_page\./u, '');
      const path =
        base === '_page.index' || base === 'index' ? '/' : `/${base.split('.').join('/')}`;
      return { file: entry.name, path };
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}

const documents = documentRoutes();
const isIndex = (file: string) => file === '_page.index.tsx';

beforeAll(() => {
  setEnv({ RAILS_STAFF_BASE_ORIGIN: 'https://www.umaxica.org' });
});

describe('root route', () => {
  // Load-bearing: `<HeadContent />` renders the head tags of every matched route
  // and React hoists a `<title>` a component renders on top of that. A root title
  // plus a failure document's own title produces TWO `<title>` elements, and the
  // contract allows exactly one.
  it('contributes no title of its own', () => {
    expect(headTitleOf(rootRoute)).toBeUndefined();
  });
});

describe('page title regression guard', () => {
  it('routes at least one document', () => {
    expect(documents.length).toBeGreaterThan(0);
  });

  it.each(documents)('$file serves a contract-conforming document', async ({ file, path }) => {
    expectTitleContract(await renderDocument(path), {
      requirePageSpecific: !isIndex(file),
      label: file,
    });
  });

  /*
   * The index is the one page whose title is the bare brand. Under Next that was
   * the root layout's `title.default`, inherited by any page that declared none;
   * the index was the only page that never declared one.
   */
  it('gives the index the bare brand title', async () => {
    const html = await renderDocument('/');
    const title = /<title[^>]*>([\s\S]*?)<\/title>/u.exec(html)?.[1]?.trim();

    expect(title).toBe(`UMAXICA (${TLD})`);
  });

  it.each(documents.filter(({ file }) => !isIndex(file)))(
    '$file declares its own page-specific title',
    async ({ file, path }) => {
      const html = await renderDocument(path);
      const title = /<title[^>]*>([\s\S]*?)<\/title>/u.exec(html)?.[1]?.trim();

      expect(title, `${file}: resolved title is empty`).not.toBe('');
      expect(title, `${file}: repeats the root title instead of naming the page`).not.toBe(
        `UMAXICA (${TLD})`,
      );
      expect(title, `${file}: page title leaks a surface/runtime name`).not.toMatch(
        FORBIDDEN_TOKEN,
      );
    },
  );
});

describe('not-found document', () => {
  it('serves a complete, contract-conforming 404 document', async () => {
    const html = await renderDocument('/this-route-does-not-exist');

    expectTitleContract(html, { requirePageSpecific: true, label: 'not-found' });
    expect(html).toContain('<html');
    expect(html).toContain('HTTP 404');
    // A 404 is not a transient failure, so it offers no reload control.
    expect(html).not.toContain('再読み込み');
    // And it stays chrome-free: it renders outside the `_page` layout.
    expect(html).not.toContain('<header');
  });
});

describe('error document', () => {
  it('renders a non-empty conforming <title> in its final HTML', () => {
    const html = renderToStaticMarkup(<ErrorDocument error={new Error('boom')} reset={() => {}} />);

    expectTitleContract(html, { requirePageSpecific: true, label: 'error' });
    expect(html).toContain('HTTP 500');
  });
});
