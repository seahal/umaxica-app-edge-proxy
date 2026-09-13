import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';

import { getRouter } from '@/router';
import { Route as rootRoute } from '@/routes/__root';
import { Route as healthApiRoute } from '@/routes/api.v0.health[.]json';
import { Route as revisionApiRoute } from '@/routes/api.v0.revision[.]json';
import { Route as healthRoute } from '@/routes/health';
import { Route as healthLivenessesRoute } from '@/routes/health.livenesses';
import { Route as healthReadinessesRoute } from '@/routes/health.readinesses';
import { Route as healthStartupsRoute } from '@/routes/health.startups';
import { Route as manifestRoute } from '@/routes/manifest[.]webmanifest';
import { Route as revisionRoute } from '@/routes/revision';
import { Route as robotsRoute } from '@/routes/robots[.]txt';
import { Route as sitemapRoute } from '@/routes/sitemap[.]xml';

/*
 * The seam between this unit's tests and TanStack's route objects.
 *
 * A route is a value rather than a default export, so a test reaches its server
 * handler through `Route.options.server.handlers.GET`. Naming that once here
 * keeps the internal shape out of the test files, and keeps them asserting the
 * CONTRACT — the markup, the status, the headers — rather than the framework's
 * object layout.
 *
 * There is deliberately no "render a component in isolation" helper.
 * `<HeadContent />` reads router state, so rendering the shell without a
 * provider throws; `renderDocument()` drives a real memory-history router
 * instead, which is also the more faithful test — what comes back is the
 * document a browser would receive, `<head>` included.
 */
type Handler = () => Response | Promise<Response>;

function handlerOf(route: { options: unknown }): Handler {
  const { options } = route as { options: { server?: { handlers?: { GET?: Handler } } } };
  const get = options.server?.handlers?.GET;
  if (!get) throw new Error('route declares no GET handler');
  return get;
}

export const handlers = {
  health: handlerOf(healthRoute),
  healthApi: handlerOf(healthApiRoute),
  startups: handlerOf(healthStartupsRoute),
  livenesses: handlerOf(healthLivenessesRoute),
  readinesses: handlerOf(healthReadinessesRoute),
  revision: handlerOf(revisionRoute),
  revisionApi: handlerOf(revisionApiRoute),
  robots: handlerOf(robotsRoute),
  sitemap: handlerOf(sitemapRoute),
  manifest: handlerOf(manifestRoute),
};

/** The whole document this unit serves for `path`, rendered through a real router. */
export async function renderDocument(path: string): Promise<string> {
  const router = getRouter();
  router.update({ history: createMemoryHistory({ initialEntries: [path] }) });
  await router.load();
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

/**
 * The application mounted into the DOM at `path`, for the tests that interact
 * with it.
 *
 * `<Link>` reads router context, so a component holding one cannot be rendered
 * in isolation — the old tests mocked `usePathname` to get around that. Driving
 * the real router instead means `aria-current` is decided by the router's own
 * active-link matching rather than by a mock, which is what the current-page
 * assertions are actually about.
 */
export async function renderApp(path: string) {
  const router = getRouter();
  router.update({ history: createMemoryHistory({ initialEntries: [path] }) });
  await router.load();
  // The router comes back alongside the render result: a test that has to make a
  // navigation FAIL needs the route objects, and reaching them through the
  // rendered tree is not possible.
  return { ...render(<RouterProvider router={router} />), router };
}

/** The `<title>` a route declares through its `head()`, or `undefined`. */
export function headTitleOf(route: { options: unknown }, loaderData?: unknown): string | undefined {
  const { options } = route as {
    options: { head?: (ctx: { loaderData?: unknown }) => { meta?: readonly { title?: string }[] } };
  };
  const meta = options.head?.({ loaderData }).meta ?? [];
  return meta.find((entry) => typeof entry.title === 'string')?.title;
}

export { healthRoute, manifestRoute, revisionRoute, robotsRoute, rootRoute, sitemapRoute };
