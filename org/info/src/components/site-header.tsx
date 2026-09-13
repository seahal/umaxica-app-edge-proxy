import { UI, type Locale } from '../i18n';
import { entriesPath, homePath, searchPath } from '../lib/publishing-routes';

/**
 * The UMAXICA application shell header:
 *
 *   brand (link to this edition's home) · Home · Entries · Search
 *
 * Every link keeps the page's locale and is a plain `<a>`: a Publishing page is
 * a full document request, never a client-side navigation, because its data is
 * loaded on the server only (`src/lib/publishing-loaders.ts`).
 *
 * Brand is an `<a>`, never an `<h1>`: the `<h1>` belongs to the page, inside
 * `<main>`. The row is a wrapping flex row, so it holds from phone to desktop
 * without a media query.
 */
export function SiteHeader({ locale, pathname }: Readonly<{ locale: Locale; pathname: string }>) {
  const t = UI[locale];
  const links = [
    { href: homePath(locale), label: t.home, current: pathname === homePath(locale) },
    {
      href: entriesPath(locale),
      label: t.entries,
      current: pathname.startsWith(entriesPath(locale)),
    },
    { href: searchPath(locale), label: t.search, current: pathname === searchPath(locale) },
  ];

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex min-h-14 w-full max-w-7xl flex-wrap items-center justify-between gap-4 px-4 wide:px-8">
        <a
          className="inline-flex min-h-11 items-center text-xl font-bold tracking-wide"
          href={homePath(locale)}
        >
          {t.brand}
        </a>
        <nav aria-label={t.primaryNavLabel}>
          <ul className="flex flex-wrap items-center gap-x-4">
            {links.map((link) => (
              <li key={link.href}>
                <a
                  className="inline-flex min-h-11 items-center text-brand aria-[current=page]:font-semibold aria-[current=page]:text-gray-900"
                  href={link.href}
                  {...(link.current ? { 'aria-current': 'page' as const } : {})}
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}
