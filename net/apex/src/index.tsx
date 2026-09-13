/** @jsxImportSource hono/jsx */
import { timeout } from 'hono/timeout';

import { createApexApp } from './create-apex-app';
import { getAboutMeta, getHomeMeta, renderAboutContent, renderHomeContent } from './page-content';
import { setMeta } from './seo';

/*
 * `umaxica.net` answers its own root. This unit is a domain with a homepage,
 * not a redirector to one — `/` used to 301 to `/about`, which made the domain
 * look like a forwarder and gave it no canonical page of its own.
 *
 * `/about` is unchanged and still served: the two say different things, and
 * the footer's utility navigation still points at it.
 */
const app = createApexApp((pageRoutes) => {
  pageRoutes.get('/', timeout(2000), (c) => {
    setMeta(c, getHomeMeta(c.env, c.get('language')));
    return c.render(renderHomeContent(c.get('language')));
  });

  pageRoutes.get('/about', timeout(2000), (c) => {
    setMeta(c, getAboutMeta(c.env, c.get('language')));
    return c.render(renderAboutContent(c.get('language')));
  });
});

// Sentry: to re-enable, wrap app with Sentry.withSentry() and export the handler.
export default app;
