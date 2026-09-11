import { createFileRoute, notFound } from '@tanstack/react-router';

import { isLocale, type Locale } from '../i18n';

/*
 * The mandatory locale prefix. Every document below `/{lang}/` is typed with
 * `lang: Locale` because this parser is the only way into it: `ja` and `en`
 * pass, anything else — `/fr/`, `/foo/`, `/JA/` — is the router's not-found
 * signal, which answers the root 404 document. An unsupported locale is never
 * rewritten to a supported one and never silently accepted.
 *
 * No component: the route renders its child through the router's default
 * outlet. The shell lives on the root route.
 */
export const Route = createFileRoute('/$lang')({
  params: {
    parse: ({ lang }): { lang: Locale } => {
      if (!isLocale(lang)) throw notFound();
      return { lang };
    },
    stringify: ({ lang }) => ({ lang }),
  },
});
