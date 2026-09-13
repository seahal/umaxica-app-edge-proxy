import { HeadContent, Scripts, createRootRoute, useRouterState } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { RouteAnnouncer } from '../components/route-announcer';
import { ServiceWorkerRegistration } from '../components/service-worker-registration';
import { SiteFooter } from '../components/site-footer';
import { SiteHeader } from '../components/site-header';
import { SkipLink } from '../components/skip-link';
import { ErrorDocument, NotFoundDocument } from '../components/status-documents';
import { DEFAULT_LOCALE, UI, isLocale, type Locale } from '../i18n';

import styleUrl from '../style.css?url';

export const Route = createRootRoute({
  /*
   * There is deliberately NO title here, and no description.
   *
   * `<HeadContent />` renders the head tags of every matched route and React
   * hoists a `<title>` a component renders on top of that, so a root title plus
   * a failure document's own title produces TWO `<title>` elements —
   * `api/title-contract.hurl` asserts `count(//title) == 1`. Every route that
   * renders a document owns its title and description outright.
   */
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    ],
    links: [
      { rel: 'stylesheet', href: styleUrl },
      { rel: 'manifest', href: '/manifest.webmanifest' },
      { rel: 'icon', href: '/favicon.ico' },
    ],
  }),
  notFoundComponent: NotFoundDocument,
  errorComponent: ErrorDocument,
  shellComponent: RootDocument,
});

/**
 * The locale of the document being rendered: the `{lang}` path parameter of the
 * matched routes, which `src/routes/$lang.tsx` has already validated. Documents
 * outside `/{lang}/` — `/offline`, and any unmatched path including an
 * unsupported locale — speak the default locale.
 */
function documentLocale(matches: readonly { params: object }[]): Locale {
  for (const match of matches) {
    const lang: unknown = Reflect.get(match.params, 'lang');
    if (typeof lang === 'string' && isLocale(lang)) return lang;
  }
  return DEFAULT_LOCALE;
}

/*
 * The shell. `<html lang>` always equals the URL locale, so it can never
 * disagree with the copy, the canonical URL or the Rails `locale=` of the same
 * document.
 *
 * The failure documents render INSIDE this shell (the satellite archetype,
 * docs/design/ui-shell-contract.md §15), so they carry the header and footer.
 * A flex column, so `<main>`'s `flex-1` pushes the footer to the bottom of a
 * short page without anyone measuring a viewport.
 */
function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  const locale = useRouterState({ select: (state) => documentLocale(state.matches) });
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <html lang={locale}>
      <head>
        <HeadContent />
      </head>
      <body className="flex min-h-screen flex-col bg-gray-50 leading-body text-gray-900">
        <ServiceWorkerRegistration />
        <SkipLink label={UI[locale].skipToMain} />
        <SiteHeader locale={locale} pathname={pathname} />
        {children}
        <SiteFooter locale={locale} />
        <RouteAnnouncer />
        <Scripts />
      </body>
    </html>
  );
}
