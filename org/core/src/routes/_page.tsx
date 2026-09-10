import { Outlet, createFileRoute } from '@tanstack/react-router';

import { AppChrome } from '@/components/app-chrome';
import { SiteFooter } from '@/components/site-footer';
import { SkipLink } from '@/components/skip-link';
import { defaultLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';

const BRAND_NAME = 'UMAXICA';

/**
 * The UMAXICA application shell for this unit's user-facing pages.
 *
 *   header (brand + actions) · main navigation · main · footer
 *
 * It is a PATHLESS layout route — the `_` prefix — which is TanStack's
 * equivalent of the `(page)` route group it replaces: it wraps its children
 * without contributing a URL segment. The status surfaces stay outside it, so
 * `/offline` and the not-found and error documents remain chrome-free, which is
 * what a failure document should be.
 *
 * `<Outlet />` is rendered directly: every page under this layout already
 * supplies its own `<main>` through `<PageMain>`, and a second `<main>` would
 * break the document landmarks.
 *
 * The shell is a grid rather than nested flex boxes because header, navigation,
 * main and footer are four siblings — the contract keeps `<nav>` out of
 * `<header>`, so there is no wrapper to flex. Above the breakpoint the grid
 * gains a second column and the navigation and main content sit side by side;
 * below it there is one column and the four elements stack in source order.
 *
 * The dictionary is loaded in a `loader` rather than awaited in the component:
 * a TanStack route component is synchronous, and the loader is the documented
 * place for the await. It runs on the server during SSR, exactly as the async
 * layout did.
 */
export const Route = createFileRoute('/_page')({
  loader: () => getDictionary(defaultLocale),
  component: PageLayout,
});

function PageLayout() {
  const dict = Route.useLoaderData();

  // Main navigation: movement inside the application. Every entry is a route
  // this unit actually serves — `/rails-health` used to sit here and had been
  // dead since ADR 009 removed the route.
  const links = [
    { to: '/', label: dict.home.title },
    { to: '/explore', label: dict.explore.title },
    { to: '/messages', label: dict.messages.title },
    { to: '/notifications', label: dict.notifications.title },
    { to: '/configuration', label: dict.configuration.title },
    { to: '/publishing', label: dict.publishing.title },
    { to: '/about', label: dict.about.title },
  ] as const;

  return (
    <div className="grid min-h-screen grid-rows-[auto_1fr_auto] wide:grid-cols-[15rem_minmax(0,1fr)]">
      {/*
       * First in document order, and therefore the first thing a keyboard
       * reader reaches. It is `position: absolute`, so it claims no grid track
       * and the four shell rows below are unaffected.
       */}
      <SkipLink label={dict.nav.skip} />
      <AppChrome
        links={links}
        labels={{
          brand: BRAND_NAME,
          menu: dict.nav.menu,
          primaryNav: dict.nav.primary,
        }}
      />
      <Outlet />
      <SiteFooter
        labels={{
          brand: BRAND_NAME,
          utilityNav: dict.nav.utility,
          about: dict.about.title,
        }}
      />
    </div>
  );
}
