import '@tanstack/react-start/server-only';
import { env } from 'cloudflare:workers';

/*
 * The Cloudflare bindings this unit reads, and the one place their shape is
 * named.
 *
 * The runtime's own `cloudflare:workers` module is the documented way to read a
 * binding from anywhere, including module scope. It is not an async-local
 * lookup, so it cannot throw for being called outside a request. Keeping it
 * behind this one accessor is what lets the Vitest suite substitute a plain
 * object (`vitest.config.ts` aliases the specifier).
 *
 * Every field is optional: `env.test` declares no VPC service, a plain
 * `vite build` has no bindings at all, and `getRailsClient()` selects its
 * transport by which binding EXISTS rather than by an environment name.
 *
 * Server-only. `RAILS_STAFF_BASE_ORIGIN` is a public URL, but the VPC binding
 * beside it is not, and nothing in this module may reach a client bundle.
 */
export interface EdgeBindings {
  UMAXICA_APPS_EDGE_CF_WORKERS_VPC?: {
    fetch(input: string, init?: RequestInit): Promise<Response>;
  };
  REVISION?: { id?: string; tag?: string; timestamp?: string };
  RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  /** Browser-facing Rails staff origin for management links. Not the VPC hop. */
  RAILS_STAFF_BASE_ORIGIN?: string;
}

export function getEdgeBindings(): EdgeBindings {
  return env;
}
