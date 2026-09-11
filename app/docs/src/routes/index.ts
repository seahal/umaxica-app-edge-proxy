import { createFileRoute } from '@tanstack/react-router';

import { negotiateLocale } from '../i18n';
import { homePath } from '../lib/publishing-routes';

/*
 * `/` has no locale, so it negotiates one from `Accept-Language` and redirects.
 * There is deliberately no default landing page: the locale prefix is mandatory
 * for every document on this unit.
 *
 * `302`, `no-store` and `Vary: Accept-Language`, because the answer depends on
 * the request header and must not be cached as if it did not.
 */
export const Route = createFileRoute('/')({
  server: {
    handlers: {
      GET: ({ request }) => {
        const locale = negotiateLocale(request.headers.get('accept-language'));
        return new Response(null, {
          status: 302,
          headers: {
            Location: new URL(homePath(locale), request.url).href,
            'Cache-Control': 'no-store',
            Vary: 'Accept-Language',
          },
        });
      },
    },
  },
});
