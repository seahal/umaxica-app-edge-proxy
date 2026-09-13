import { createFileRoute } from '@tanstack/react-router';

import { PageHero } from '../components/page-hero';
import { UI } from '../i18n';
import { entriesPath, searchPath } from '../lib/publishing-routes';
import { documentHead } from '../lib/seo';
import { siteCopy } from '../lib/site-copy';
import { brandTitle } from '../lib/title';

/*
 * `/{lang}/`. Server-rendered on every request, with no data fetch and no cache
 * strategy of its own in this phase.
 */
export const Route = createFileRoute('/$lang/')({
  head: ({ params }) => {
    const copy = siteCopy(params.lang);
    return documentHead({
      locale: params.lang,
      title: brandTitle(copy.product),
      description: copy.description,
      path: '/',
    });
  },
  component: Home,
});

function Home() {
  const { lang } = Route.useParams();
  const copy = siteCopy(lang);
  const t = UI[lang];
  return (
    <PageHero
      siteName={copy.siteName}
      title={copy.heading}
      paragraphs={copy.paragraphs}
      actions={[
        { href: entriesPath(lang), label: t.viewEntries },
        { href: searchPath(lang), label: t.search },
      ]}
    />
  );
}
