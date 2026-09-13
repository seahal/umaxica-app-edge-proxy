/** @jsxImportSource hono/jsx */
import { timeout } from 'hono/timeout';

import { createApexApp } from './create-apex-app';
import { getAboutMeta, getHomeMeta, renderAboutContent, renderHomeContent } from './page-content';
import { setMeta } from './seo';

/*
 * `umaxica.dev` answers its own root. This unit is a domain with a homepage,
 * not a redirector to one.
 *
 * It used to 301 `/` to `https://www.umaxica.dev/`, a separate application
 * deployed elsewhere. That application has been removed and `www`
 * canonicalises to this host through a Cloudflare redirect rule, so serving a
 * redirect here would send the browser straight back — see
 * `docs/operations/net-www-canonicalisation.md`.
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

export default app;
