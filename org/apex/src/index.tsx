/** @jsxImportSource hono/jsx */
import { timeout } from 'hono/timeout';

import { createApexApp } from './create-apex-app';
import { getAboutMeta, renderAboutContent } from './page-content';
import { getDefaultRedirectUrl, resolveRedirectUrl } from './root-redirect';
import { setMeta } from './seo';

const app = createApexApp((pageRoutes) => {
  pageRoutes.get('/', (c) => {
    const regionParam = c.req.query('ri');
    const redirectUrl = resolveRedirectUrl(regionParam);
    if (redirectUrl) {
      return c.redirect(redirectUrl, 301);
    }
    // Always a URL: the default region is a constant key of `allowedUrls`.
    // There is deliberately no rejection branch. An unrecognised `ri` is not
    // an error to report back — it is a value that fails the allowlist, and
    // the safe answer is the default region rather than a 400 that tells a
    // prober its guess was parsed.
    return c.redirect(getDefaultRedirectUrl(), 301);
  });

  pageRoutes.get('/about', timeout(2000), (c) => {
    setMeta(c, getAboutMeta(c.env, c.get('language')));
    return c.render(renderAboutContent(c.get('language')));
  });
});

// Sentry: to re-enable, wrap app with Sentry.withSentry() and export the handler.
export default app;
