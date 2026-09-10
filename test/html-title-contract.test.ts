import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

// @ts-expect-error React is provided by the app workspace, not the root package.
import { createElement } from '../app/core/node_modules/react';
import { renderToStaticMarkup } from '../app/core/node_modules/react-dom/server';

// Every workspace resolves `next/font/google` to the same physical package, so
// mocking that resolved path once covers all 16 root layouts. A bare
// `vi.mock('next/font/google')` would only be resolved relative to this file.
vi.mock('../app/core/node_modules/next/font/google', () => ({
  Inter: () => ({ variable: 'font-sans' }),
}));

// Root layouts are imported statically: they call next/font at module scope, and
// only a static import participates in the vi.mock registry above.

type LayoutMetadata = { metadata: { title: { default: string; template: string } } };

const ROOT_LAYOUTS: Record<string, LayoutMetadata> = {};
vi.mock('@sentry/nextjs', () => ({ captureException: () => {} }));

/**
 * The single owner of the UMAXICA HTML `<title>` contract.
 *
 *   Root title -> `UMAXICA ({TLD})`
 *   Page title -> `{LOCALIZED_PAGE_TITLE} — UMAXICA ({TLD})`
 *
 * Two things this file deliberately does NOT do:
 *
 * - It does not grep sources for the string `title`. A page can export
 *   `metadata = {}` and pass any such search while shipping no title at all, so
 *   every page module here is imported and its resolved title inspected.
 * - It does not accept a value living inside a React component as proof. Where a
 *   document is assembled outside the Metadata API (Hono routes, `global-error`,
 *   the 429 responses) the acceptance check runs against the FINAL HTML.
 *
 * Each surface is verified through the mechanism that actually produces its
 * title — Next.js Metadata API, React 19 title hoisting, or a hand-written HTML
 * document — rather than through one artificially unified path.
 */

const repoRoot = join(import.meta.dirname, '..');

const FAMILY_TLD: Record<string, string> = {
  app: 'APP',
  com: 'COM',
  org: 'ORG',
  net: 'NET',
  dev: 'DEV',
};

/** Satellite deployment units whose root title carries the product name. */
const SATELLITE_ROLE: Record<string, string> = {
  docs: 'Docs',
  help: 'Help',
  info: 'Info',
  news: 'News',
};

const TITLE_CONTRACT = /^(?:.+ — )?UMAXICA \((APP|COM|ORG|NET|DEV)\)$/u;

/**
 * Surface and runtime names. A user-facing title must never reveal which
 * deployment unit or which runtime served the route, so that Rails and Edge can
 * split routes inside one FQDN invisibly.
 */
const FORBIDDEN_TOKEN =
  /\b(?:auth|core|apex|side|edge|next|next\.js|nextjs|hono|workers?|cloudflare|opennext)\b/iu;

function trackedFiles(): string[] {
  const injected = process.env['EDGE_TRACKED_FILES'];
  if (injected !== undefined) {
    return injected.split('\n').filter(Boolean);
  }
  return execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

function titlesIn(html: string): string[] {
  return [...html.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gu)].map((match) => match[1] ?? '');
}

type TitleExpectation = {
  /** Deployment family the surface belongs to; its TLD must appear in the title. */
  tld: string;
  /** True when the surface is not an app root and therefore needs its own title. */
  requirePageSpecific?: boolean;
  label: string;
};

/** The shared acceptance set applied to every HTML document in the repository. */
function expectTitleContract(html: string, { tld, requirePageSpecific, label }: TitleExpectation) {
  const found = titlesIn(html);

  // 1 + 2. Exactly one <title> exists.
  expect(found, `${label}: expected exactly one <title> in the final HTML`).toHaveLength(1);

  const title = (found[0] ?? '').trim();

  // 3. Non-empty after trim.
  expect(title, `${label}: <title> is empty or whitespace-only`).not.toBe('');

  // 4. UMAXICA in exact uppercase.
  expect(title, `${label}: brand must be exactly "UMAXICA"`).toContain('UMAXICA');
  expect(title, `${label}: brand casing must not vary`).not.toMatch(/Umaxica|umaxica/u);

  // 5 + 6. EM DASH contract, uppercase TLD matching the deployment family.
  expect(title, `${label}: does not match the UMAXICA title contract`).toMatch(TITLE_CONTRACT);
  expect(title, `${label}: TLD must match the deployment family`).toContain(`UMAXICA (${tld})`);

  // 7. No surface or runtime name.
  expect(title, `${label}: leaks a surface/runtime name`).not.toMatch(FORBIDDEN_TOKEN);

  // 8. Non-root surfaces carry a page-specific segment.
  if (requirePageSpecific) {
    expect(title, `${label}: expected a page-specific title, got the bare root title`).not.toBe(
      `UMAXICA (${tld})`,
    );
    expect(title, `${label}: page-specific title must precede the EM DASH`).toMatch(
      new RegExp(`^.+ — UMAXICA \\(${tld}\\)$`, 'u'),
    );
  }
}

/*
 * The fifteen content frames, whichever bundler each one builds through.
 *
 * All fifteen build with Vite today (`adr/013-frames-tanstack-start.md`), so one
 * of the two guard families below runs against an empty set. The totals are
 * derived from this list rather than written as literals for exactly that
 * reason: what must not weaken is coverage — every frame has to be checked by
 * one guard or the other, which is what `covers every content frame` asserts.
 */
const EXPECTED_FRAMES = ['app', 'com', 'org'].flatMap((family) =>
  ['core', 'docs', 'news', 'help', 'info'].map((role) => `${family}/${role}`),
);

/** Every TanStack Start unit, derived from tracked root routes. */
function viteApps(): { workspace: string; family: string; role: string; tld: string }[] {
  return trackedFiles()
    .filter((file) => file.endsWith('/src/routes/__root.tsx'))
    .map((file) => {
      const [family = '', role = ''] = file.split('/');
      return { workspace: `${family}/${role}`, family, role, tld: FAMILY_TLD[family] ?? '' };
    })
    .sort((a, b) => a.workspace.localeCompare(b.workspace));
}

/** Every Astro public content surface, derived from tracked Base layouts. */
function astroApps(): { workspace: string; family: string; role: string; tld: string }[] {
  return trackedFiles()
    .filter((file) => file.endsWith('/src/layouts/Base.astro'))
    .map((file) => {
      const [family = '', role = ''] = file.split('/');
      return { workspace: `${family}/${role}`, family, role, tld: FAMILY_TLD[family] ?? '' };
    })
    .sort((a, b) => a.workspace.localeCompare(b.workspace));
}

/** Every Next.js deployment unit, derived from tracked root layouts. */
function nextApps(): { workspace: string; family: string; role: string; tld: string }[] {
  return trackedFiles()
    .filter((file) => file.endsWith('/src/app/layout.tsx'))
    .map((file) => {
      const [family = '', role = ''] = file.split('/');
      return { workspace: `${family}/${role}`, family, role, tld: FAMILY_TLD[family] ?? '' };
    })
    .sort((a, b) => a.workspace.localeCompare(b.workspace));
}

function expectedRootTitle(role: string, tld: string): string {
  const product = SATELLITE_ROLE[role];
  return product ? `${product} — UMAXICA (${tld})` : `UMAXICA (${tld})`;
}

type ResolvedTitle = string | undefined;

/** Resolve what a Next.js module actually contributes as a title. */
async function resolveTitle(module: Record<string, unknown>): Promise<ResolvedTitle> {
  const generate = module['generateMetadata'] as undefined | (() => Promise<{ title?: unknown }>);
  const meta = generate
    ? await generate()
    : (module['metadata'] as { title?: unknown } | undefined);
  const title = meta?.title;

  if (typeof title === 'string') {
    return title;
  }
  if (title && typeof title === 'object') {
    const record = title as { absolute?: unknown; default?: unknown };
    if (typeof record.absolute === 'string') return record.absolute;
    if (typeof record.default === 'string') return record.default;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Guard B — root layout metadata (the source of every inherited title)
// ---------------------------------------------------------------------------

describe('root layout metadata', () => {
  const apps = nextApps();

  it('covers every content frame, across both bundlers', () => {
    expect([...apps, ...viteApps(), ...astroApps()].map((app) => app.workspace).sort()).toEqual(
      [...EXPECTED_FRAMES].sort(),
    );
  });

  /*
   * Zero since the last frame left Next.js. The guard stays because the shape it
   * describes — `metadata.title.default` plus a `%s — UMAXICA (TLD)` template on
   * every root layout — is what a frame returning to Next.js would have to
   * satisfy, and it is the only place that is written down. The TanStack guard at
   * the end of this file is what is doing the work today, and the coverage
   * assertion above is what stops BOTH from passing vacuously.
   */
  it('has a statically imported layout for every Next.js unit it claims', () => {
    expect(Object.keys(ROOT_LAYOUTS).sort()).toEqual(apps.map((app) => app.workspace).sort());
  });

  it('has a statically imported layout for every unit', () => {
    expect(Object.keys(ROOT_LAYOUTS).sort()).toEqual(apps.map((app) => app.workspace).sort());
  });

  it.each(apps)('$workspace declares a contract-conforming title', ({ workspace, role, tld }) => {
    const title = ROOT_LAYOUTS[workspace]?.metadata.title;

    expect(title, `${workspace}: title must use default + template`).toBeTypeOf('object');
    expect(title?.default).toBe(expectedRootTitle(role, tld));
    expect(title?.template).toBe(`%s — UMAXICA (${tld})`);

    // The default is itself a rendered title and must satisfy the contract.
    expectTitleContract(`<title>${title?.default}</title>`, {
      tld,
      label: `${workspace} root title`,
    });
  });
});

// ---------------------------------------------------------------------------
// Guard A — missing-title regression: every page declares a title
// ---------------------------------------------------------------------------

describe('page title regression guard', () => {
  /**
   * A page is an app root when it is the deployment unit's index. Only these
   * may fall back to the root layout's `title.default`.
   */
  const isIndexPage = (file: string) =>
    file.endsWith('/src/app/page.tsx') || file.endsWith('/src/app/(page)/page.tsx');

  /**
   * Pages that render no HTML at all. `home/page.tsx` only calls `redirect()`,
   * and a redirect is explicitly outside the title contract.
   */
  const REDIRECT_ONLY = new Set(
    ['app', 'com', 'org'].map((family) => `${family}/core/src/app/(page)/home/page.tsx`),
  );

  const pages = trackedFiles().filter(
    (file) =>
      /\/src\/app\/.*page\.tsx$/u.test(file) &&
      !REDIRECT_ONLY.has(file) &&
      existsSync(join(repoRoot, file)),
  );

  it('finds a page in every Next.js unit', () => {
    // The count used to be pinned at 63. It is derived now, because the number
    // moves every time a frame leaves Next.js — but the property the literal was
    // protecting is unchanged: the glob must not silently stop matching, and no
    // Next unit may drop out of the guard.
    const covered = new Set(pages.map((file) => file.split('/').slice(0, 2).join('/')));
    expect([...covered].sort()).toEqual(
      nextApps()
        .map((app) => app.workspace)
        .sort(),
    );
  });

  const contentPages = pages.filter((file) => !isIndexPage(file));

  it.each(contentPages)('%s declares its own page-specific title', async (file) => {
    const module = (await import(/* @vite-ignore */ `../${file}`)) as Record<string, unknown>;

    expect(
      module['metadata'] !== undefined || module['generateMetadata'] !== undefined,
      `${file}: exports neither metadata nor generateMetadata — a new page must declare a title`,
    ).toBe(true);

    const title = await resolveTitle(module);
    const family = file.split('/')[0] ?? '';
    const tld = FAMILY_TLD[family] ?? '';

    // Rejects metadata = {}, title: '', title: '   ', and title: undefined.
    expect(typeof title, `${file}: resolved title is not a string`).toBe('string');
    expect((title ?? '').trim(), `${file}: resolved title is empty`).not.toBe('');

    // A page-specific title may not merely repeat the app root title.
    expect(title, `${file}: repeats the root title instead of naming the page`).not.toBe(
      `UMAXICA (${tld})`,
    );
    expect(title, `${file}: page title leaks a surface/runtime name`).not.toMatch(FORBIDDEN_TOKEN);
  });

  it.each(pages.filter(isIndexPage))('%s may inherit a contract-conforming root title', (file) => {
    const [family = '', role = ''] = file.split('/');
    const tld = FAMILY_TLD[family] ?? '';
    expectTitleContract(`<title>${expectedRootTitle(role, tld)}</title>`, {
      tld,
      label: `${file} inherited root title`,
    });
  });
});

// ---------------------------------------------------------------------------
// Guard A2 — the template actually composes end to end
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Guard D1 — global-not-found: Next.js Metadata API
// ---------------------------------------------------------------------------

describe('global-not-found documents', () => {
  const files = trackedFiles().filter((file) => file.endsWith('/src/app/global-not-found.tsx'));

  it('exists for every Next.js unit that routes one', () => {
    expect(files.length).toBe(nextApps().length);
  });

  it.each(files)('%s defines its title through the Metadata API', async (file) => {
    const module = (await import(/* @vite-ignore */ `../${file}`)) as Record<string, unknown>;
    const family = file.split('/')[0] ?? '';
    const tld = FAMILY_TLD[family] ?? '';

    // This document replaces the root layout, so no template can apply to it:
    // the title must be absolute and self-contained.
    const title = (module['metadata'] as { title?: { absolute?: string } })?.title;
    expect(title?.absolute, `${file}: expected an absolute title`).toBeTypeOf('string');

    expectTitleContract(`<title>${title?.absolute}</title>`, {
      tld,
      requirePageSpecific: true,
      label: file,
    });

    // It must still be a complete document.
    const html = renderToStaticMarkup(createElement(module['default'] as never));
    expect(html, `${file}: must render a full document`).toContain('<html');
  });
});

// ---------------------------------------------------------------------------
// Guard D2 — global-error: React 19 title hoisting (client component)
// ---------------------------------------------------------------------------

describe('global-error documents', () => {
  const files = trackedFiles().filter((file) => file.endsWith('/src/app/global-error.tsx'));

  it('exists for every Next.js unit', () => {
    expect(files.length).toBe(nextApps().length);
  });

  it.each(files)('%s renders a non-empty <title> in its final HTML', async (file) => {
    const module = (await import(/* @vite-ignore */ `../${file}`)) as Record<string, unknown>;
    const family = file.split('/')[0] ?? '';

    // A client component cannot export metadata, so the title is asserted on the
    // rendered output rather than on any exported value.
    const html = renderToStaticMarkup(
      createElement(module['default'] as never, {
        error: Object.assign(new Error('boom'), { digest: 'test' }),
        reset: () => {},
      }),
    );

    expectTitleContract(html, {
      tld: FAMILY_TLD[family] ?? '',
      requirePageSpecific: true,
      label: file,
    });
  });
});

// ---------------------------------------------------------------------------
// Guard D3 — 429 responses: hand-written HTML documents
// ---------------------------------------------------------------------------

describe('rate limited 429 documents', () => {
  const blocked = { limit: async () => ({ success: false }) };

  const coreUnits = ['app', 'com', 'org'] as const;

  it.each(coreUnits)('%s/core serves a full 429 document', async (family) => {
    const { checkRateLimit } = (await import(
      /* @vite-ignore */ `../${family}/core/src/lib/rate-limit.ts`
    )) as { checkRateLimit: (request: Request, limiter: unknown) => Promise<Response | null> };

    const response = await checkRateLimit(new Request('https://example.test/'), blocked);
    expect(response?.status).toBe(429);
    expect(response?.headers.get('content-type')).toContain('text/html');

    expectTitleContract(await (response as Response).text(), {
      tld: FAMILY_TLD[family] ?? '',
      requirePageSpecific: true,
      label: `${family}/core 429`,
    });
  });

  /*
   * The five apex Workers. Their 429 was a bare `Response('Too Many Requests')`
   * — untitled, no `Content-Type`, no `Cache-Control` — while every frame beside
   * them answered a titled document. This guard is what stops that from
   * reappearing: it drives the real function, so a 429 that stopped going
   * through `statusPage` would fail here even if the markup still existed
   * somewhere in the unit.
   */
  const apexUnits = ['app', 'com', 'dev', 'net', 'org'] as const;

  it('covers every apex worker', () => {
    expect(
      trackedFiles()
        .filter((file) => file.endsWith('/apex/src/rate-limit.ts'))
        .map((file) => file.split('/')[0] ?? '')
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual([...apexUnits].sort((a, b) => a.localeCompare(b)));
  });

  it.each(apexUnits)('%s/apex serves a full 429 document', async (family) => {
    const { checkRateLimit } = (await import(
      /* @vite-ignore */ `../${family}/apex/src/rate-limit.ts`
    )) as { checkRateLimit: (request: Request, limiter: unknown) => Promise<Response | null> };

    const response = await checkRateLimit(new Request('https://example.test/'), blocked);
    expect(response?.status).toBe(429);
    expect(response?.headers.get('content-type')).toContain('text/html');
    expect(response?.headers.get('cache-control')).toBe('no-store');

    expectTitleContract(await (response as Response).text(), {
      tld: FAMILY_TLD[family] ?? '',
      requirePageSpecific: true,
      label: `${family}/apex 429`,
    });
  });

  /*
   * The twelve Astro content surfaces (adr/015). Like the Cores they answer a
   * hand-written 429, and like the Cores the check runs at whatever their own
   * first touch is — here `src/middleware.ts`, because an Astro unit has no
   * `worker.ts`. That is the asymmetry adr/010 recorded, carried across the move
   * off TanStack Start.
   *
   * The guard drives `src/lib/rate-limit.ts` with an injected limiter — the same
   * shape as the two guards above — rather than driving the middleware, which
   * would need an Astro `APIContext` and the `cloudflare:workers` module, neither
   * of which exists in this root suite. Keeping the limiter a parameter of
   * `checkRateLimit` is what makes that possible.
   *
   * This replaces a guard that filtered `/src/middleware.ts` while excluding
   * `/core/` and asserted the count against `nextApps()`. Next.js has since left
   * the repository entirely, so that assertion became `12 === 0`; worse, the
   * filter silently re-aimed itself at the Astro middleware, whose export is
   * `onRequest`, not `middleware`. Matching on a filename could not see that the
   * rate limiting these twelve units owe had been dropped in the conversion.
   * Matching on `src/lib/rate-limit.ts` — the file that has to exist for the unit
   * to limit anything at all — can.
   */
  const contentSurfaces = astroApps().map((app) => app.workspace);

  it('covers every astro content surface', () => {
    expect(
      trackedFiles()
        .filter((file) => file.endsWith('/src/lib/rate-limit.ts') && !file.includes('/core/'))
        .map((file) => file.split('/').slice(0, 2).join('/'))
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(contentSurfaces);
  });

  it.each(contentSurfaces)('%s serves a full 429 document', async (workspace) => {
    const { checkRateLimit } = (await import(
      /* @vite-ignore */ `../${workspace}/src/lib/rate-limit.ts`
    )) as { checkRateLimit: (request: Request, limiter: unknown) => Promise<Response | null> };

    const response = await checkRateLimit(new Request('https://example.test/'), blocked);
    expect(response?.status).toBe(429);
    expect(response?.headers.get('content-type')).toContain('text/html');
    expect(response?.headers.get('cache-control')).toBe('no-store');

    expectTitleContract(await (response as Response).text(), {
      tld: FAMILY_TLD[workspace.split('/')[0] ?? ''] ?? '',
      requirePageSpecific: true,
      label: `${workspace} 429`,
    });
  });
});

// ---------------------------------------------------------------------------
// Guards C and C2 — REMOVED, and where they went
// ---------------------------------------------------------------------------
//
// This file used to end with two guards that drove the four Cloudflare apex
// workers and dev/apex through `app.request()` and asserted the title contract,
// the content types, the `/revision` key set and the
// root redirect status. The response was the subject, so under this
// repository's three-layer split they belong to Hurl, not to Vitest:
//
//   /about, /health, /offline, 404                 -> <unit>/api/title-contract.hurl
//   /health.html and /health.json are HTML 404     -> the same file
//   /revision text identity                        -> Playwright e2e/revision.spec.ts
//   /api/v0/revision.json key set                  -> <unit>/api/revision-api.hurl
//                                                     and title-contract.hurl (`$.title`)
//   the root redirect and its Location             -> <unit>/api/routes.hurl
//   the 500 document (needs a throwing route)      -> <unit>/test/title-contract.ts
//   dev/apex, all of the above                     -> dev/apex/test/*.ts, which is
//                                                     the documented exception —
//                                                     see that unit's app.test.ts
//
// One property genuinely changed hands rather than moving: these guards ran the
// four brands from ONE `it.each`, so a rule could not be satisfied in `app` and
// forgotten in `org`. That cross-brand sweep now lives in Guards A, B, A2, D1,
// D2 and D3 above — which still cover all fifteen frames and all twelve
// satellite middlewares from one table — plus `TITLE_CONTRACT` and
// `FORBIDDEN_TOKEN` here, which each unit's own `api/title-contract.hurl`
// restates verbatim. The regexes agreeing is now a copy, not a shared constant.
// If they drift, the place to notice is here.

// ---------------------------------------------------------------------------
// Guard E — TanStack Start units: the same contract, asserted on source
// ---------------------------------------------------------------------------

/*
 * The frames that have left Next.js are checked here rather than dropped.
 *
 * They cannot be checked the same way. The guards above import a module and read
 * `metadata`, which works because Next resolves a title into an exported object.
 * TanStack has no such object — `head()` returns a finished string that only
 * `<HeadContent />` renders — and importing a route from this workspace would
 * need the unit's own `@tanstack/react-router`, which the root package does not
 * have. Each unit renders its own documents through a real router in its own
 * suite (`<unit>/test/title-contract.test.tsx`), and its Hurl suite asserts on
 * real responses.
 *
 * What is left for THIS file is the part no single unit can see: that all three
 * families agree, that a frame cannot quietly stop declaring titles, and that
 * the one trap this migration actually hit stays closed — a title on the root
 * route plus a title in a failure document produces TWO `<title>` elements.
 */
describe('Astro content-surface title contract', () => {
  const apps = astroApps();
  const read = (relativePath: string) => readFileSync(join(repoRoot, relativePath), 'utf8');

  it.each(apps)('$workspace names the brand once, in one place', ({ workspace, tld }) => {
    const source = read(`${workspace}/src/lib/title.ts`);
    expect(source, `${workspace}: BRAND_TITLE must match the deployment family`).toContain(
      `export const BRAND_TITLE = 'UMAXICA (${tld})'`,
    );
    expect(source).toContain('return `${pageTitle} — ${BRAND_TITLE}`;');
  });

  it.each(apps)(
    '$workspace titles the layout from the page, not a root default',
    ({ workspace }) => {
      const layout = read(`${workspace}/src/layouts/Base.astro`);
      expect(layout).toContain('<title>{title}</title>');
      expect(layout).not.toMatch(/brandTitle\(/u);
    },
  );

  it.each(apps)('$workspace titles both public documents and the 404', ({ workspace, tld }) => {
    const pages = [
      `${workspace}/src/pages/ja/index.astro`,
      `${workspace}/src/pages/ja/about.astro`,
      `${workspace}/src/pages/[lang]/entries/index.astro`,
      `${workspace}/src/layouts/StatusSplash.astro`,
      `${workspace}/src/pages/404.astro`,
    ];
    for (const page of pages) {
      const source = read(page);
      expect(source, `${page}: declares no title`).toMatch(/brandTitle\(/u);
    }
    const notFound = read(`${workspace}/src/pages/404.astro`);
    expect(notFound).toContain('HTTP 404');
    expectTitleContract(`<title>ページが見つかりません — UMAXICA (${tld})</title>`, {
      tld,
      requirePageSpecific: true,
      label: `${workspace} 404`,
    });
  });
});

describe('TanStack Start title contract', () => {
  const apps = viteApps();
  const read = (relativePath: string) => readFileSync(join(repoRoot, relativePath), 'utf8');

  /** Every `'…'` or `"…"` string literal passed to `brandTitle(...)`. */
  const brandTitleArguments = (source: string): string[] =>
    [...source.matchAll(/brandTitle\(\s*'([^']+)'\s*\)/gu)].map((match) => match[1] ?? '');

  /** Every template literal that closes with the brand constant. */
  const brandedTemplateTitles = (source: string): string[] =>
    [...source.matchAll(/<title>\{`([^`]+)`\}<\/title>/gu)].map((match) =>
      (match[1] ?? '').replace(/\$\{BRAND_TITLE\}/u, 'UMAXICA (APP)'),
    );

  it.each(apps)('$workspace names the brand once, in one place', ({ workspace, tld }) => {
    const source = read(`${workspace}/src/lib/title.ts`);

    expect(source, `${workspace}: BRAND_TITLE must match the deployment family`).toContain(
      `export const BRAND_TITLE = 'UMAXICA (${tld})'`,
    );
    // The EM DASH, with one space on each side. Not a hyphen, not an EN DASH.
    expect(source).toContain('return `${pageTitle} — ${BRAND_TITLE}`;');
  });

  it.each(apps)('$workspace declares no title on the root route', ({ workspace }) => {
    /*
     * The trap this migration hit, measured before it was closed: `<HeadContent />`
     * renders the head tags of every matched route and React hoists a `<title>` a
     * component renders on top of that, so a root title plus the not-found
     * document's own title served TWO `<title>` elements — and the contract, in
     * this file and in every unit's Hurl suite, is exactly one.
     */
    const root = read(`${workspace}/src/routes/__root.tsx`);
    const head = /head:\s*\(\)\s*=>\s*\(\{[\s\S]*?\n  \}\),/u.exec(root)?.[0] ?? root;

    expect(head, `${workspace}: __root must contribute no title`).not.toMatch(/\btitle:/u);
  });

  /*
   * Two archetypes, two ways of naming a title, one contract.
   *
   * A satellite route calls `brandTitle('…')` inline. A Core route reads
   * `pageTitles.<key>`, resolved once in `src/lib/page-titles.ts` from the
   * default-locale dictionary — because a Core page title is a translated string,
   * and `head()` can run before the loader that would fetch it. The index route
   * of a Core carries the bare `BRAND_TITLE`, which is what its root layout's
   * `title.default` used to supply.
   *
   * So this asserts two things per frame: every document route names one of
   * those three sources, and every title the unit can actually produce conforms.
   */
  const TITLE_SOURCES = /brandTitle\(|pageTitles\.|BRAND_TITLE/u;

  it.each(apps)('$workspace gives every route document a title', ({ workspace }) => {
    const routesDir = join(repoRoot, workspace, 'src/routes');
    const documents = readdirSync(routesDir).filter(
      (name) =>
        name.endsWith('.tsx') &&
        name !== '__root.tsx' &&
        // The pathless layout wraps documents; it answers no URL of its own.
        name !== '_page.tsx' &&
        // A redirect renders nothing, so it is explicitly outside the contract.
        name !== '_page.home.tsx',
    );

    expect(documents.length, `${workspace}: found no route documents`).toBeGreaterThan(0);

    for (const name of documents) {
      const source = readFileSync(join(routesDir, name), 'utf8');
      expect(source, `${workspace}/src/routes/${name}: declares no title`).toMatch(TITLE_SOURCES);
    }
  });

  it.each(apps)('$workspace produces only conforming titles', ({ workspace, tld }) => {
    const unitRoot = join(repoRoot, workspace);
    const routesDir = join(unitRoot, 'src/routes');

    const literals = readdirSync(routesDir)
      .filter((name) => name.endsWith('.tsx'))
      .flatMap((name) => brandTitleArguments(readFileSync(join(routesDir, name), 'utf8')));

    // A Core resolves its page titles from the dictionary in one module.
    const titlesModule = join(unitRoot, 'src/lib/page-titles.ts');
    if (existsSync(titlesModule)) {
      const source = readFileSync(titlesModule, 'utf8');
      const dictionary = JSON.parse(
        readFileSync(join(unitRoot, 'src/i18n/dictionaries/ja.json'), 'utf8'),
      ) as Record<string, { title?: string }>;
      for (const key of [...source.matchAll(/brandTitle\(ja\.([a-z_]+)\.title\)/gu)]) {
        const title = dictionary[key[1] ?? '']?.title;
        expect(
          title,
          `${workspace}: page-titles names ja.${key[1]}, which the dictionary lacks`,
        ).toBeTypeOf('string');
        literals.push(title as string);
      }
    }

    expect(literals.length, `${workspace}: found no page titles at all`).toBeGreaterThan(0);
    for (const title of literals) {
      expectTitleContract(`<title>${title} — UMAXICA (${tld})</title>`, {
        tld,
        requirePageSpecific: true,
        label: `${workspace} page title`,
      });
    }
  });

  it.each(apps)('$workspace titles both failure documents', ({ workspace, tld }) => {
    const source = read(`${workspace}/src/components/status-documents.tsx`);
    const titles = brandedTemplateTitles(source).map((title) =>
      title.replace('UMAXICA (APP)', `UMAXICA (${tld})`),
    );

    // A not-found document and an error document, each with its own title.
    expect(titles, `${workspace}: expected two titled failure documents`).toHaveLength(2);
    for (const title of titles) {
      expectTitleContract(`<title>${title}</title>`, {
        tld,
        requirePageSpecific: true,
        label: `${workspace} failure document`,
      });
    }
    expect(source).toContain('HTTP 404');
    expect(source).toContain('HTTP 500');
  });

  it.each(apps)('$workspace serves a titled 429 document', ({ workspace, tld }) => {
    /*
     * The satellites' 429 lived in `src/middleware.ts` and was asserted by
     * importing it. A TanStack frame answers it from `src/rate-limit.ts`, called
     * by the server entry before the router runs — the same move the Cores made
     * (adr/010) — so the document is read from source here and exercised for real
     * by the unit's own `test/rate-limit.test.ts`.
     */
    /*
     * The satellites answer 429 from `src/rate-limit.ts`, called by their server
     * entry. The Cores answer it from `src/lib/rate-limit.ts`, called by
     * `src/worker.ts` — the first-touch entry ADR 010 moved it to. Same document,
     * same contract, two homes.
     */
    const rateLimitModule = ['src/rate-limit.ts', 'src/lib/rate-limit.ts']
      .map((rel) => `${workspace}/${rel}`)
      .find((rel) => existsSync(join(repoRoot, rel)));
    expect(rateLimitModule, `${workspace}: found no rate-limit module`).toBeTypeOf('string');
    const source = read(rateLimitModule as string);
    const title = /<title>([^<]+)<\/title>/u.exec(source)?.[1] ?? '';

    expectTitleContract(`<title>${title}</title>`, {
      tld,
      requirePageSpecific: true,
      label: `${workspace} 429`,
    });
    expect(source).toContain('HTTP 429');
    expect(source).toContain("'Cache-Control': 'no-store'");
    expect(source).toContain('status: 429');
  });
});
