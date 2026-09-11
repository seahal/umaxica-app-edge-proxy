import { describe, expect, it } from 'vitest';

import { CANONICAL_ORIGIN } from '../../src/lib/canonical';
import { documentHead, failureHead } from '../../src/lib/seo';

describe('document head', () => {
  it('emits a self-referencing canonical and one alternate per locale plus x-default', () => {
    const head = documentHead({
      locale: 'en',
      title: 'T',
      description: 'D',
      path: '/entries/page/2/',
    });

    expect(head.meta).toEqual([{ title: 'T' }, { name: 'description', content: 'D' }]);
    expect(head.links).toEqual([
      { rel: 'canonical', href: `${CANONICAL_ORIGIN}/en/entries/page/2/` },
      { rel: 'alternate', hrefLang: 'ja', href: `${CANONICAL_ORIGIN}/ja/entries/page/2/` },
      { rel: 'alternate', hrefLang: 'en', href: `${CANONICAL_ORIGIN}/en/entries/page/2/` },
      { rel: 'alternate', hrefLang: 'x-default', href: `${CANONICAL_ORIGIN}/ja/entries/page/2/` },
    ]);
  });

  it('keeps a noindex document canonical and adds robots', () => {
    const head = documentHead({
      locale: 'ja',
      title: 'T',
      description: 'D',
      path: '/search/',
      noindex: true,
    });
    expect(head.meta).toContainEqual({ name: 'robots', content: 'noindex, follow' });
    expect(head.links[0]).toEqual({ rel: 'canonical', href: `${CANONICAL_ORIGIN}/ja/search/` });
  });

  it('gives a failure document a title and no canonical', () => {
    expect(failureHead('F')).toEqual({
      meta: [{ title: 'F' }, { name: 'robots', content: 'noindex, nofollow' }],
      links: [],
    });
  });
});
