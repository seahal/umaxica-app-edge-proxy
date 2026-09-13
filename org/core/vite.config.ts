import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/*
 * Vite is a BUILD tool here and nothing else, exactly as in the apex Workers
 * (adr/012-apex-vite-build-and-static-assets.md). `vite build` emits the Worker
 * bundle, the hashed client assets, and an output `wrangler.json` that
 * `wrangler deploy` reads on its own. There is no Vite in the request path and
 * no Node server in production.
 *
 * Three things are deliberately absent.
 *
 * There is no `assets.directory`, here or in wrangler.jsonc: the plugin fills it
 * in with the client build output when it writes the output config. Declaring it
 * in the input config is the documented way to get it wrong.
 *
 * There is no root `index.html`. Cloudflare matches static assets BEFORE the
 * Worker runs, so an `index.html` in the build output would answer `/` itself
 * and the route behind it would become unreachable — silently, and only in
 * production.
 *
 * There is no `prerender`. Every HTML route is server-rendered per request, so
 * the security headers and the rate limiter in `src/server.ts` apply to all of
 * them from one place. Prerendering three pages would move them behind the
 * asset matcher, where neither runs, and would additionally read local bindings
 * at build time.
 *
 * `inspectorPort` is pinned per unit because the root `dev` script runs every
 * unit in parallel; on the plugin's default (9229) they would collide.
 * `viteEnvironment: { name: 'ssr' }` is what the Cloudflare framework guide
 * requires so TanStack Start's server build targets the Worker environment.
 */
export default defineConfig({
  // The core's pages and components import through `@/`, declared in its own
  // tsconfig. Vite resolves it from there rather than from a second list here.
  resolve: { tsconfigPaths: true },
  // The Cloudflare Tunnel forwards the browser's Host unchanged, so `vite dev`
  // sees the public hostname and refuses it: Vite allowlists Hosts to block DNS
  // rebinding against a dev server. Only this unit's own two tunnel hostnames are
  // listed — never `true` and never a wildcard, which would give that defence
  // up. `server` is read while serving only, so `vite build` is unaffected.
  server: { allowedHosts: ['jp.umaxica.org', 'us.umaxica.org'] },
  plugins: [
    tailwindcss(),
    cloudflare({
      inspectorPort: 9305,
      viteEnvironment: { name: 'ssr' },
    }),
    tanstackStart(),
    viteReact(),
  ],
});
