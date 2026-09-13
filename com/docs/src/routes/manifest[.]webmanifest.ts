import { createFileRoute } from '@tanstack/react-router';

import { DEFAULT_LOCALE } from '../i18n';
import { PUBLISHING_AUDIENCE } from '../lib/publishing-cell';
import { homePath } from '../lib/publishing-routes';
import { siteCopy } from '../lib/site-copy';

/*
 * The Web App Manifest. `start_url` is the default-locale home, because the bare
 * `/` is a negotiating redirect rather than a document.
 */
export const Route = createFileRoute('/manifest.webmanifest')({
  server: {
    handlers: {
      GET: () => {
        const { product } = siteCopy(DEFAULT_LOCALE);
        return new Response(
          JSON.stringify({
            name: `UMAXICA ${product} (${PUBLISHING_AUDIENCE})`,
            short_name: `UMAXICA ${product}`,
            start_url: homePath(DEFAULT_LOCALE),
            display: 'standalone',
            background_color: '#f9fafb',
            theme_color: '#ffffff',
            icons: [{ src: '/favicon.ico', sizes: '32x32', type: 'image/x-icon' }],
          }),
          { headers: { 'Content-Type': 'application/manifest+json' } },
        );
      },
    },
  },
});
