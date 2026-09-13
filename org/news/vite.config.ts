import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/*
 * Vite is a BUILD tool here and nothing else, exactly as in the Cores and the
 * apex Workers (adr/012-apex-vite-build-and-static-assets.md). `vite build`
 * emits the Worker bundle, the hashed client assets, and an output
 * `wrangler.json` that `wrangler deploy` reads on its own. There is no Vite in
 * the request path and no Node server in production.
 *
 * Three things are deliberately absent.
 *
 * There is no `assets.directory`, here or in wrangler.jsonc: the plugin fills it
 * in with the client build output when it writes the output config.
 *
 * There is no root `index.html`. Cloudflare matches static assets BEFORE the
 * Worker runs, so an `index.html` in the build output would answer `/` itself
 * and the negotiating route behind it would become unreachable.
 *
 * There is no `prerender`. Every HTML route is server-rendered per request, so
 * the security headers, the rate limiter and the Publishing status mapping in
 * `src/request-handler.ts` apply to all of them from one place.
 *
 * `inspectorPort` is pinned per unit because the root `dev` script runs every
 * unit in parallel; on the plugin's default (9229) they would collide.
 * `viteEnvironment: { name: 'ssr' }` is what the Cloudflare framework guide
 * requires so TanStack Start's server build targets the Worker environment.
 */

/*
 * The two flags that select the direct Rails transport in
 * `src/lib/rails-client.ts`, bridged from the shell into the Worker.
 *
 * `vite dev` runs the Worker in workerd, whose `process.env` is built from the
 * Worker's own vars and NOT from the shell — so `EDGE_LOCAL_NODE_RUNTIME=1` in
 * the dev script and `EDGE_LOCAL_RAILS_ENABLED` from the container-wide Rails
 * overlay do not reach it on their own. Only names that are already set are
 * forwarded, so an unset overlay stays unset and the client keeps failing closed
 * to `not-configured`.
 *
 * **The forwarding happens only while SERVING, never while building.**
 * `compose.yaml` exports `EDGE_LOCAL_RAILS_ENABLED` container-wide, so without
 * the guard a `pnpm run build` inside the development container would bake both
 * flags into `dist/server/wrangler.json`, and a deployed production Worker would
 * take the direct transport to a `.localhost` origin instead of the VPC binding.
 */
const LOCAL_RAILS_FLAGS = ['EDGE_LOCAL_NODE_RUNTIME', 'EDGE_LOCAL_RAILS_ENABLED'] as const;

// Mutated in place rather than returned as a new object: the plugin MERGES what
// the customizer returns into the config it passed in, so `{ ...config }` comes
// back with `compatibility_flags` concatenated onto itself and workerd refuses to
// start — "Compatibility flag specified multiple times: nodejs_compat".
function forwardLocalRailsFlags(config: { vars?: Record<string, unknown> }): void {
  for (const name of LOCAL_RAILS_FLAGS) {
    const value = process.env[name];
    if (value === undefined) continue;
    config.vars = { ...config.vars, [name]: value };
  }
}

/*
 * `remoteBindings` is load-bearing, not a default being restated.
 *
 * The plugin defaults it to TRUE. A Workers VPC Service has no local simulator,
 * so with the default, any command that resolves a configuration declaring
 * `vpc_services` opens a remote proxy session that only an interactive
 * `wrangler login` can authenticate — `vite preview` of the production config
 * failed outright without credentials (measured 2026-08-22). `env.vpc` is the
 * one tier whose purpose is the real remote binding, so it is the one tier that
 * opts back in; everything else, including CI, stays credential-free.
 * See adr/006-development-workers-vpc-transport.md.
 */
const wantsRemoteBindings = process.env['CLOUDFLARE_ENV'] === 'vpc';

/*
 * Region (jp/us) is a build-time input, never a path segment. It selects the
 * canonical origin in `src/lib/canonical.ts`, and it is replaced with a literal
 * here so one build serves one region. Anything but `us` is `jp`.
 */
const publicRegion = process.env['PUBLIC_REGION'] === 'us' ? 'us' : 'jp';

export default defineConfig(({ command }) => ({
  define: { 'import.meta.env.PUBLIC_REGION': JSON.stringify(publicRegion) },
  // The Cloudflare Tunnel forwards the browser's Host unchanged, so `vite dev`
  // sees the public hostname and refuses it: Vite allowlists Hosts to block DNS
  // rebinding. Only this unit's own tunnel hostnames are listed — never `true`.
  server: { allowedHosts: ['news-jp.umaxica.org', 'news-us.umaxica.org'] },
  plugins: [
    tailwindcss(),
    cloudflare({
      inspectorPort: 9312,
      viteEnvironment: { name: 'ssr' },
      remoteBindings: wantsRemoteBindings,
      ...(command === 'serve' ? { config: forwardLocalRailsFlags } : {}),
    }),
    tanstackStart(),
    viteReact(),
  ],
}));
