import { describe, expect, it } from 'vitest';

import { defaultLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { PUBLISHING_CELLS, managementIndexUrl } from '@/lib/publishing-management';

import { setEnv } from './__mocks__/cloudflare-workers';
import { renderDocument } from './utils/routes';

const ORIGIN = 'https://www.umaxica.org';

describe('publishing hub', () => {
  it('renders /publishing with twelve Rails management indexes', async () => {
    setEnv({ RAILS_STAFF_BASE_ORIGIN: ORIGIN });
    const dict = await getDictionary(defaultLocale);
    const html = await renderDocument('/publishing');

    expect(html).toContain(dict.publishing.title);
    expect(html).toContain(dict.publishing.intro);
    expect(html).toContain('href="/publishing"');

    for (const { surface, audience } of PUBLISHING_CELLS) {
      const href = managementIndexUrl(ORIGIN, surface, audience);
      expect(html).toContain(`href="${href}"`);
      expect(href).toBe(`${ORIGIN}/publishing/${surface}/${audience}/entries`);
    }

    expect(html).not.toContain('news.org.localhost');
    expect(html).not.toContain('core.org.localhost');
    expect(html).not.toContain('UMAXICA_APPS_EDGE_CF_WORKERS_VPC');
    expect(html).not.toContain('/entries/welcome');
  });
});
