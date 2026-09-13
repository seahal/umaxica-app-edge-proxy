import { fireEvent, render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ErrorDocument, NotFoundDocument } from '@/components/status-documents';

import { resetEnv, setEnv, setEnvShouldThrow } from './__mocks__/cloudflare-workers';
import { handlers, renderDocument } from './utils/routes';

/*
 * The failure and offline surfaces.
 *
 * `errorComponent` and `notFoundComponent` render inside the root shell but
 * OUTSIDE `src/routes/_page.tsx`, the pathless layout that carries the chrome,
 * so this frame's failure documents are chrome-free — which is what
 * `docs/design/ui-shell-contract.md` §15 asks for, and where this archetype
 * differs from the twelve satellites.
 */
function clickButton(container: HTMLElement, label: string) {
  const button = Array.from(container.querySelectorAll('button')).find(
    (node) => node.textContent?.trim() === label,
  );
  expect(button).toBeTruthy();
  fireEvent.click(button as HTMLButtonElement);
}

afterEach(() => {
  vi.restoreAllMocks();
  resetEnv();
  document.body.innerHTML = '';
});

describe('status surfaces', () => {
  it('renders error, offline, and not-found recovery UI', async () => {
    const reset = vi.fn();
    const view = render(<ErrorDocument error={new Error('boom')} reset={reset} />);
    clickButton(view.container, '再読み込み');
    expect(reset).toHaveBeenCalledOnce();
    view.unmount();

    expect(renderToStaticMarkup(<NotFoundDocument />)).toContain('HTTP 404');
    expect(await renderDocument('/offline')).toContain('オフラインです');
  });

  it('keeps the failure and offline documents chrome-free', async () => {
    for (const html of [
      await renderDocument('/this-route-does-not-exist'),
      await renderDocument('/offline'),
    ]) {
      expect(html).not.toContain('<header');
      expect(html).not.toContain('<footer');
      expect(html).not.toContain('id="main-navigation"');
    }
  });

  it('returns revision text and JSON from the same version metadata', async () => {
    setEnv({ REVISION: { id: 'id-1', tag: 'tag-1', timestamp: 'ts-1' } });
    const withMeta = await handlers.revision();
    expect(withMeta.status).toBe(200);
    expect(withMeta.headers.get('Cache-Control')).toBe('no-store');
    expect(withMeta.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(withMeta.headers.get('Content-Type')).toMatch(/^text\/plain\b/u);
    await expect(withMeta.text()).resolves.toBe('id-1\n');
    await expect((await handlers.revisionApi()).json()).resolves.toEqual({
      id: 'id-1',
      tag: 'tag-1',
      timestamp: 'ts-1',
    });

    setEnv({});
    await expect((await handlers.revision()).text()).resolves.toBe('unknown\n');
    await expect((await handlers.revisionApi()).json()).resolves.toEqual({
      id: null,
      tag: null,
      timestamp: null,
    });

    setEnvShouldThrow(true);
    await expect((await handlers.revision()).text()).resolves.toBe('unknown\n');
    await expect((await handlers.revisionApi()).json()).resolves.toEqual({
      id: null,
      tag: null,
      timestamp: null,
    });
  });
});
