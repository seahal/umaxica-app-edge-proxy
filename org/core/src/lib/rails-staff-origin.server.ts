import '@tanstack/react-start/server-only';
import { getEdgeEnv } from './cloudflare-env';
import { parseRailsStaffOrigin } from './rails-staff-origin';

export function getRailsStaffOrigin(): string {
  const raw = getEdgeEnv().RAILS_STAFF_BASE_ORIGIN;
  return parseRailsStaffOrigin(typeof raw === 'string' ? raw : undefined);
}
