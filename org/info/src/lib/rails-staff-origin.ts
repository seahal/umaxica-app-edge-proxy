/*
 * Browser-facing Rails Base.Org / staff origin.
 *
 * This is the URL a browser follows to the authenticated Rails Publishing CMS.
 * It is not the Worker → Rails VPC transport (`UMAXICA_APPS_EDGE_CF_WORKERS_VPC`
 * / `*.{app,com,org}.localhost` surface hosts). Those two origins must stay
 * distinct: a private hop address must never become an `<a href>`.
 */

const VPC_SURFACE_HOST = /^(?:info|docs|news|help|core)\.(?:app|com|org)\.localhost(?::\d+)?$/iu;

export function parseRailsStaffOrigin(raw: string | undefined): string {
  if (raw === undefined || raw.trim() === '') {
    throw new Error('RAILS_STAFF_ORIGIN is not configured');
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('RAILS_STAFF_ORIGIN is not a valid URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('RAILS_STAFF_ORIGIN must be an http(s) origin');
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('RAILS_STAFF_ORIGIN must not include credentials');
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error('RAILS_STAFF_ORIGIN must be an origin with no path');
  }
  if (url.search !== '' || url.hash !== '') {
    throw new Error('RAILS_STAFF_ORIGIN must be an origin with no query or fragment');
  }
  if (VPC_SURFACE_HOST.test(url.host)) {
    throw new Error('RAILS_STAFF_ORIGIN must not be a Worker-to-Rails VPC hostname');
  }

  return url.origin;
}
