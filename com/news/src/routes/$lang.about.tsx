import { createFileRoute } from '@tanstack/react-router';

import { PageHero } from '../components/page-hero';
import { UI } from '../i18n';
import { documentHead } from '../lib/seo';
import { siteCopy } from '../lib/site-copy';
import { brandTitle } from '../lib/title';

/* `/{lang}/about/` — the "about this site" page the footer links to. */
export const Route = createFileRoute('/$lang/about')({
  head: ({ params }) =>
    documentHead({
      locale: params.lang,
      title: brandTitle(UI[params.lang].about),
      description: siteCopy(params.lang).description,
      path: '/about/',
    }),
  component: About,
});

function About() {
  const { lang } = Route.useParams();
  const copy = siteCopy(lang);
  return (
    <PageHero siteName={copy.siteName} title={UI[lang].about} paragraphs={copy.aboutParagraphs} />
  );
}
