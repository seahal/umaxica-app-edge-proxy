/**
 * The Rails origin this Core talks to, read from the `RAILS_ORIGIN` var.
 *
 * Rails is reached over the public internet with the Worker's ordinary `fetch` —
 * there is no Workers VPC binding (`adr/018-core-rails-direct-internet.md`). The
 * value differs per tier and lives in `wrangler.jsonc`, never in code.
 *
 * Anything that is not a bare origin counts as not configured, so a typo fails
 * closed instead of sending a request somewhere unintended. Plain `http` is
 * accepted only for a `*.localhost` host: the browser's own Cookie and
 * Authorization headers travel on this hop, and outside the development
 * container they must not cross the internet in cleartext.
 */
export function parseRailsOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') {
    return null;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const isLocalHost = url.hostname === 'localhost' || url.hostname.endsWith('.localhost');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHost)) {
    return null;
  }
  if (url.username !== '' || url.password !== '') {
    return null;
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    return null;
  }

  return url.origin;
}
