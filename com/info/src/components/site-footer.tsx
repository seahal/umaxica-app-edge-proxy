import { UI, type Locale } from '../i18n';
import { CANONICAL_ORIGIN } from '../lib/canonical';
import { aboutPath } from '../lib/publishing-routes';

/**
 * The UMAXICA application shell footer, in two layers:
 *
 *   utility navigation  (About …)
 *   site identity       (© year UMAXICA)
 *
 * The utility navigation links only to surfaces that exist on this unit. There
 * is no privacy or terms route in this repository, so neither is linked — a
 * plausible dead link is worse than a missing one.
 */
export function SiteFooter({ locale }: Readonly<{ locale: Locale }>) {
  const t = UI[locale];
  const homeUrl = `${CANONICAL_ORIGIN}/`;

  return (
    <footer className="border-t border-gray-200 bg-white py-4">
      <nav
        className="mx-auto flex w-full max-w-7xl flex-wrap gap-x-6 px-4 wide:px-8"
        aria-label={t.utilityNavLabel}
      >
        <a
          className="inline-flex min-h-11 items-center text-sm text-brand"
          href={aboutPath(locale)}
        >
          {t.about}
        </a>
      </nav>
      <p className="mx-auto flex w-full max-w-7xl flex-wrap justify-between gap-2 px-4 text-sm text-gray-600 wide:px-8">
        <span>© {new Date().getUTCFullYear()} UMAXICA</span>
        <a className="text-brand" href={homeUrl}>
          {homeUrl}
        </a>
      </p>
    </footer>
  );
}
