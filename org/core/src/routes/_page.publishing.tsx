import { createFileRoute } from '@tanstack/react-router';

import { PageHeading } from '@/components/page-heading';
import { PageMain } from '@/components/page-main';
import { defaultLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { pageTitles } from '@/lib/page-titles';
import {
  PUBLISHING_AUDIENCES,
  PUBLISHING_SURFACES,
  managementIndexUrl,
} from '@/lib/publishing-management';
import { getRailsStaffOrigin } from '@/lib/rails-staff-origin';

export const Route = createFileRoute('/_page/publishing')({
  loader: () => getDictionary(defaultLocale),
  head: () => ({ meta: [{ title: pageTitles.publishing }] }),
  component: PublishingPage,
});

const SURFACE_LABEL: Record<(typeof PUBLISHING_SURFACES)[number], { ja: string; en: string }> = {
  info: { ja: 'Info', en: 'Info' },
  docs: { ja: 'Docs', en: 'Docs' },
  news: { ja: 'News', en: 'News' },
  help: { ja: 'Help', en: 'Help' },
};

const AUDIENCE_LABEL: Record<(typeof PUBLISHING_AUDIENCES)[number], { ja: string; en: string }> = {
  app: { ja: 'App', en: 'App' },
  com: { ja: 'Com', en: 'Com' },
  org: { ja: 'Org', en: 'Org' },
};

function PublishingPage() {
  const dict = Route.useLoaderData();
  const origin = getRailsStaffOrigin();
  const lang = defaultLocale;

  return (
    <PageMain>
      <PageHeading>{dict.publishing.title}</PageHeading>
      <p className="max-w-prose text-gray-600">{dict.publishing.intro}</p>
      {PUBLISHING_SURFACES.map((surface) => (
        <section key={surface} className="grid gap-2">
          <h2 className="text-lg font-semibold">{SURFACE_LABEL[surface][lang]}</h2>
          <ul className="grid gap-1">
            {PUBLISHING_AUDIENCES.map((audience) => (
              <li key={audience}>
                <a className="underline" href={managementIndexUrl(origin, surface, audience)}>
                  {AUDIENCE_LABEL[audience][lang]}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </PageMain>
  );
}
