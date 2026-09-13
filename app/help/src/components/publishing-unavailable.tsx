import { UI, type Locale } from '../i18n';
import { homePath } from '../lib/publishing-routes';

/**
 * What a Publishing page renders when Rails could not supply its content —
 * unreachable, timed out, throttled, or answering outside its contract.
 *
 * Deliberately generic. The status class reaches the status line
 * (`src/lib/publishing-status.ts`); nothing else about the failure — no Rails
 * body, hostname, upstream status or exception text — reaches the document.
 * The title comes from the route's `head()`, so this component renders none.
 */
export function PublishingUnavailable({
  locale,
  status,
}: Readonly<{ locale: Locale; status: number }>) {
  const t = UI[locale];
  return (
    <main
      className="grid flex-1 place-content-center gap-3 p-6 text-center"
      id="main-content"
      tabIndex={-1}
    >
      <h1 className="text-2xl leading-heading font-semibold">{t.unavailableHeading}</h1>
      <p>{`HTTP ${String(status)}`}</p>
      <p className="text-gray-700">{t.unavailableBody}</p>
      <a className="text-brand" href={homePath(locale)}>
        {t.home}
      </a>
    </main>
  );
}
