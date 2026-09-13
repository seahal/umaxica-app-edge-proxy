import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { renderToStaticMarkup } from 'react-dom/server';

import { getRouter } from '../../src/router';
import { Route as healthApiRoute } from '../../src/routes/api.v0.health[.]json';
import { Route as revisionApiRoute } from '../../src/routes/api.v0.revision[.]json';
import { Route as healthRoute } from '../../src/routes/health';
import { Route as healthLivenessesRoute } from '../../src/routes/health.livenesses';
import { Route as healthReadinessesRoute } from '../../src/routes/health.readinesses';
import { Route as healthStartupsRoute } from '../../src/routes/health.startups';
import { Route as indexRoute } from '../../src/routes/index';
import { Route as manifestRoute } from '../../src/routes/manifest[.]webmanifest';
import { Route as revisionRoute } from '../../src/routes/revision';
import { Route as robotsRoute } from '../../src/routes/robots[.]txt';
import { Route as sitemapRoute } from '../../src/routes/sitemap[.]xml';

/*
 * The seam between this unit's tests and TanStack's route objects.
 *
 * A route is a value rather than a default export, so a test reaches its server
 * handler through `Route.options.server.handlers.GET`, its `headers()` through
 * `Route.options.headers` and its loader through `Route.options.loader`. Naming
 * that once here keeps the framework's object layout out of the test files.
 *
 * Documents are rendered through a real memory-history router: `<HeadContent />`
 * reads router state, and what comes back is the document a browser would
 * receive, `<head>` included. The HTTP status and response headers of a document
 * are the Hurl suite's job (`api/`); here the route's `headers()` is called
 * directly with the loader data it would receive.
 */
type Handler = (ctx: { request: Request }) => Response | Promise<Response>;

function handlerOf(route: { options: unknown }) {
  const { options } = route as { options: { server?: { handlers?: { GET?: Handler } } } };
  const get = options.server?.handlers?.GET;
  if (!get) throw new Error('route declares no GET handler');
  return async (request = new Request('https://example.test/')): Promise<Response> =>
    get({ request });
}

export const handlers = {
  root: handlerOf(indexRoute),
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

/** What a route's `headers()` answers for the loader data it would receive. */
export function headersOf(route: { options: unknown }, loaderData: unknown) {
  const { options } = route as {
    options: {
      headers?: (ctx: { loaderData: unknown }) => Record<string, string> | undefined;
    };
  };
  return options.headers?.({ loaderData });
}

/** Run a route's loader with the given params, as the router would. */
export async function runLoader(
  route: { options: unknown },
  params: Record<string, string>,
): Promise<unknown> {
  const { options } = route as {
    options: { loader?: (ctx: { params: Record<string, string> }) => unknown };
  };
  if (!options.loader) throw new Error('route declares no loader');
  return options.loader({ params });
}
