import type { APIRoute } from 'astro';

import {
  publishingHttpStatus,
  railsLocaleFromPathLang,
  resolvePublishingApi,
} from '../../../lib/publishing-api';

/*
 * Same-origin JSON for the language-home React island. The browser never
 * talks to Rails; this Worker uses the existing VPC Rails client.
 */
export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const locale = railsLocaleFromPathLang(url.searchParams.get('locale') ?? undefined);
  if (locale === null) {
    return Response.json({ error: 'invalid-locale' }, { status: 400 });
  }

  let result;
  try {
    const api = resolvePublishingApi();
    if ('kind' in api) {
      result = api;
    } else {
      const cursor = url.searchParams.get('cursor') ?? undefined;
      result = await api.fetchEntriesPage(
        cursor === undefined ? { locale } : { locale, cursor },
      );
    }
  } catch {
    result = { kind: 'internal-error' as const };
  }

  const status = publishingHttpStatus(result);
  if (result.kind !== 'ok') {
    return Response.json({ error: 'unavailable' }, { status });
  }

  const data = result.value.data.map((entry) => ({
    public_id: entry.public_id,
    title: entry.title,
    summary: entry.summary,
  }));
  return Response.json(
    { data, page: result.value.page },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
};
