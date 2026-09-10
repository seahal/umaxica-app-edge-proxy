import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { defaultLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';

import { renderApp, renderDocument } from './utils/routes';

/*
 * The UMAXICA application shell, asserted on the emitted document.
 *
 * What has to stay identical across every deployment unit is the contract —
 * semantics, hierarchy, accessible names, which destinations are reachable —
 * and not the components, which each unit owns separately so it stays
 * independently deployable.
 *
 * These assertions deliberately do not name a CSS class. Every visual rule is a
 * Tailwind utility, so a class list is styling rather than structure, and a test
 * that pinned one would fail on a padding change while still passing if the
 * `<nav>` lost its accessible name.
 *
 * The shell used to be rendered by calling the `(page)` layout as a function,
 * with `usePathname` mocked so `<AppChrome>` could resolve. It is driven through
 * a real memory-history router now: `<Link>` reads router context, and the
 * current-page assertions at the bottom of this file are about the router's own
 * active-link matching, so mocking it would have been mocking the thing under
 * test.
 */
const documents = new Map<string, string>();

beforeAll(async () => {
  for (const path of ['/', '/explore', '/configuration', '/configuration/account']) {
    documents.set(path, await renderDocument(path));
  }
});

const shell = (path = '/'): string => {
  const html = documents.get(path);
  if (html === undefined) throw new Error(`no document rendered for ${path}`);
  return html;
};

const shellDom = (path = '/') => {
  document.body.innerHTML = shell(path);
  return within(document.body);
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('application shell', () => {
  it('emits exactly one header, main and footer, in document order', async () => {
    const html = shell();

    for (const tag of ['header', 'main', 'footer']) {
      expect(html.match(new RegExp(`<${tag}[\\s>]`, 'gu')) ?? [], `<${tag}>`).toHaveLength(1);
    }

    expect(html.indexOf('<header')).toBeLessThan(html.indexOf('<main'));
    expect(html.indexOf('<main')).toBeLessThan(html.indexOf('<footer'));
  });

  it('exposes the four document landmarks', async () => {
    const dom = shellDom();
    const dict = await getDictionary(defaultLocale);

    expect(dom.getByRole('banner')).toBeInTheDocument();
    expect(dom.getByRole('main')).toBeInTheDocument();
    expect(dom.getByRole('contentinfo')).toBeInTheDocument();
    // Two navigations, so each needs its own accessible name to be told apart.
    expect(dom.getAllByRole('navigation')).toHaveLength(2);
    expect(dom.getByRole('navigation', { name: dict.nav.primary })).toBeInTheDocument();
    expect(dom.getByRole('navigation', { name: dict.nav.utility })).toBeInTheDocument();
  });

  it('links the brand to this edition’s homepage without stealing the page heading', async () => {
    const html = shell();
    const dom = shellDom();
    const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));

    expect(within(dom.getByRole('banner')).getByRole('link', { name: 'UMAXICA' })).toHaveAttribute(
      'href',
      '/',
    );
    // The `<h1>` belongs to the page, inside `<main>` — not to the header.
    expect(header).not.toContain('<h1');
  });

  it('separates the header from the main navigation', async () => {
    const html = shell();
    const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
    const dict = await getDictionary(defaultLocale);

    // The navigation is a sibling of the header, never nested inside it, so
    // this unit can become a sidebar, a rail or a bottom bar independently.
    expect(header).not.toContain('<nav');
    expect(html).toContain(`<nav id="main-navigation"`);
    expect(html).toContain(`aria-label="${dict.nav.primary}"`);
    expect(html.indexOf('id="main-navigation"')).toBeLessThan(html.indexOf('<main'));
  });

  it('uses button semantics for the menu disclosure, wired to the navigation', async () => {
    const dom = shellDom();
    const dict = await getDictionary(defaultLocale);

    const button = within(dom.getByRole('banner')).getByRole('button', { name: dict.nav.menu });

    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('aria-controls', 'main-navigation');
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('renders the navigation in the server HTML rather than behind hydration', async () => {
    const dom = shellDom();
    const dict = await getDictionary(defaultLocale);
    const nav = dom.getByRole('navigation', { name: dict.nav.primary });

    /*
     * Above the breakpoint the navigation is shown by a media query, with no
     * JavaScript involved (docs/design/ui-shell-contract.md §5). It must
     * therefore be present, un-hidden and in the accessibility tree in the
     * server-rendered HTML — which is exactly what a `react-aria-components`
     * `<DisclosurePanel>` would not give us, because it marks the collapsed
     * panel `hidden` and `aria-hidden`.
     */
    expect(nav).not.toHaveAttribute('hidden');
    expect(nav).not.toHaveAttribute('aria-hidden');
    expect(within(nav).getAllByRole('link').length).toBeGreaterThan(0);
  });

  it('gives the footer two layers: a named utility nav and the site identity', async () => {
    const html = shell();
    const dom = shellDom();
    const footer = html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));
    const dict = await getDictionary(defaultLocale);

    const contentinfo = dom.getByRole('contentinfo');
    const utility = within(contentinfo).getByRole('navigation', { name: dict.nav.utility });

    expect(within(utility).getByRole('link', { name: dict.about.title })).toHaveAttribute(
      'href',
      '/about',
    );
    expect(footer).not.toContain('href="/configuration/preference"');

    // Utility navigation first, site identity second.
    expect(footer.indexOf('</nav>')).toBeLessThan(footer.indexOf('©'));
    expect(footer).toMatch(/©\s*\d{4} UMAXICA/u);
    expect(
      within(contentinfo).getByRole('link', { name: 'https://jp.umaxica.org/' }),
    ).toHaveAttribute('href', 'https://jp.umaxica.org/');
  });

  it('opens the document with a skip link that actually moves focus', async () => {
    const dom = shellDom();
    const dict = await getDictionary(defaultLocale);

    const skip = dom.getByRole('link', { name: dict.nav.skip });
    expect(skip).toHaveAttribute('href', '#main-content');

    /*
     * "First focusable element in the document" is the requirement, not "first
     * link" — and it matters most on this archetype, where the alternative is
     * tabbing past the brand, the menu trigger and seven navigation entries. The
     * selector is every element that can take focus, so anything inserted ahead
     * of the skip link later fails here rather than silently demoting it.
     */
    expect(document.body.querySelector('a, button, input, select, textarea, [tabindex]')).toBe(
      skip,
    );

    /*
     * The target has to exist and has to be programmatically focusable.
     * Without `tabindex="-1"` the browser scrolls to the fragment and leaves
     * focus on the link, so the next Tab returns to the navigation the reader
     * just asked to skip — the control appears to work and does not.
     */
    const main = dom.getByRole('main');
    expect(main).toHaveAttribute('id', 'main-content');
    expect(main).toHaveAttribute('tabindex', '-1');
  });

  it('links only to destinations this unit serves', () => {
    /*
     * Anchors only, and only in the body.
     *
     * Next's Metadata API injected `<link rel="manifest">` and `<link rel="icon">`
     * at a stage this file never saw, so scanning the whole document for
     * `href="/…"` used to be equivalent to scanning for navigation.
     * `<HeadContent />` renders those same links into the document this test now
     * receives, and a resource link is not a destination a reader can navigate
     * to — so the scan says which elements it means.
     */
    shellDom();
    const hrefs = [...document.body.querySelectorAll('a[href^="/"]')].map((anchor) =>
      anchor.getAttribute('href'),
    );

    // Neither a privacy nor a terms route exists in this repository, and there
    // is no reusable legal text to build one from, so neither may be linked.
    expect(hrefs).not.toContain('/privacy');
    expect(hrefs).not.toContain('/terms');
    expect(hrefs).not.toContain('/preferences');
    expect(hrefs).not.toContain('/configuration/preference');
    // Removed by ADR 009; the navigation pointed at it until this shell landed.
    expect(hrefs).not.toContain('/rails-health');

    expect(new Set(hrefs)).toEqual(
      new Set([
        '/',
        '/explore',
        '/messages',
        '/notifications',
        '/configuration',
        '/publishing',
        '/about',
      ]),
    );

    // The head links are still expected — they are simply not navigation, and
    // the manifest URL in particular is pinned by `api/standard-contract.hurl`.
    expect(shell()).toContain('href="/manifest.webmanifest"');
    expect(shell()).toContain('href="/favicon.ico"');
  });

  it('localises every shell string through the existing dictionary', async () => {
    const html = shell();
    const dict = await getDictionary(defaultLocale);

    for (const label of [dict.about.title, dict.explore.title, dict.nav.menu]) {
      expect(html, `missing localized label: ${label}`).toContain(label);
    }
  });
});

/*
 * The interactive half. These mount the real application rather than a component
 * in isolation: `<AppChrome>` holds `<Link>`, which reads router context, so the
 * old version supplied a fake `usePathname`. Driving the router means the
 * current-page assertions below test the router's own active-link matching.
 */
describe('menu disclosure', () => {
  const controls = async () => {
    const dict = await getDictionary(defaultLocale);
    await renderApp('/');
    return {
      button: screen.getByRole('button', { name: dict.nav.menu }),
      nav: screen.getByRole('navigation', { name: dict.nav.primary }),
    };
  };

  it('toggles aria-expanded and the navigation’s open state', async () => {
    const { button, nav } = await controls();

    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(nav).toHaveAttribute('data-open', 'false');

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(nav).toHaveAttribute('data-open', 'true');

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(nav).toHaveAttribute('data-open', 'false');
  });

  /*
   * The trigger is a `react-aria-components` `<Button>`, which handles press
   * through `onPress` rather than `onClick`. These two cases are the reason that
   * matters: a native `<button>` gets Enter and Space from the browser, and this
   * asserts the library did not take that away.
   */
  it.each([
    ['Enter', 'Enter'],
    ['Space', ' '],
  ])('activates on %s', async (_name, key) => {
    const { button, nav } = await controls();
    button.focus();

    fireEvent.keyDown(button, { key });
    fireEvent.keyUp(button, { key });

    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(nav).toHaveAttribute('data-open', 'true');
  });

  it('keeps the trigger focusable and reachable by keyboard', async () => {
    const { button } = await controls();

    expect(button).not.toHaveAttribute('disabled');
    expect(button).not.toHaveAttribute('aria-disabled');
    button.focus();
    expect(button).toHaveFocus();
  });
});

/**
 * `aria-current="page"` on the navigation entry the reader is on
 * (docs/design/ui-shell-contract.md §12).
 *
 * The match is exact, and these tests are where that decision is written down.
 * ARIA defines `page` as "the current page within a set of pages", so an ancestor
 * is not it — marking `/configuration` while the reader is on
 * `/configuration/account` would announce a page they are not on. This archetype
 * is the only one with a main navigation, so it is the only one with anything to
 * mark.
 */
describe('current-page marking', () => {
  const markedEntries = async () => {
    const dict = await getDictionary(defaultLocale);
    return within(screen.getByRole('navigation', { name: dict.nav.primary }))
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')
      .map((link) => link.textContent);
  };

  it('marks exactly the entry the reader is on', async () => {
    const dict = await getDictionary(defaultLocale);
    await renderApp('/explore');

    await expect(markedEntries()).resolves.toEqual([dict.explore.title]);
  });

  it('marks the home entry only on an exact match, never on every route', async () => {
    const dict = await getDictionary(defaultLocale);
    await renderApp('/');

    await expect(markedEntries()).resolves.toEqual([dict.home.title]);
  });

  it('marks nothing on a served route that is not itself an entry', async () => {
    // `/configuration/account` is real, and so are `/home` and `/doctor` — none
    // of them is one of the six destinations in this set.
    await renderApp('/configuration/account');

    await expect(markedEntries()).resolves.toEqual([]);
  });

  it('leaves the unmarked entries with no attribute rather than a negative one', async () => {
    const dict = await getDictionary(defaultLocale);
    await renderApp('/explore');

    const nav = within(screen.getByRole('navigation', { name: dict.nav.primary }));

    // `aria-current="false"` is the default already; emitting it would add
    // markup that says nothing.
    expect(nav.getByRole('link', { name: dict.home.title })).not.toHaveAttribute('aria-current');
  });
});
