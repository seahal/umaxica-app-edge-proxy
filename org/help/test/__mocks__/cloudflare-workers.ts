/*
 * Stand-in for the `cloudflare:workers` runtime module, which only workerd can
 * resolve. `vitest.config.ts` aliases the specifier here.
 *
 * `env` is mutable so a test can install exactly the bindings the case is about
 * — a VPC service, a REVISION, a RATE_LIMITER, or none at all — and
 * `src/lib/env.ts` reads it through one accessor, so nothing else has
 * to know this file exists.
 *
 * `setEnvShouldThrow` exists because the routes guard their binding reads with
 * try/catch and those branches have to stay exercised. `cloudflare:workers`
 * cannot throw on a read outside a request context, so the guard is defensive
 * rather than load-bearing (`adr/013-frames-tanstack-start.md`) — and this is
 * what still proves it fails to a 503 and to nulls instead of to an unhandled
 * exception.
 */
const backing: Record<string, unknown> = {};

let shouldThrow = false;

export function setEnvShouldThrow(value: boolean): void {
  shouldThrow = value;
}

export function resetEnv(): void {
  shouldThrow = false;
  for (const key of Object.keys(backing)) delete backing[key];
}

export function setEnv(values: Record<string, unknown>): void {
  resetEnv();
  Object.assign(backing, values);
}

export const env: Record<string, unknown> = new Proxy(backing, {
  get(target, property, receiver) {
    if (shouldThrow) throw new Error('the Workers environment is unavailable');
    return Reflect.get(target, property, receiver);
  },
});
