// @ts-check
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, envField } from 'astro/config';

/*
 * Astro on Cloudflare Workers for this public content surface (adr/015).
 *
 * - `output: 'static'`. HTML routes prerender at build time. `/health`, `/`,
 *   and `/{lang}/entries/**` opt out with `export const prerender = false`.
 * - Security headers live in `public/_headers`.
 * - Region (jp/us) is a build-time `PUBLIC_REGION` input.
 * - Language (ja/en) is a URL path prefix; `/` negotiates.
 */
export default defineConfig({
  srcDir: './src',
  publicDir: './public',
  outDir: './dist/astro',
  // Content pages use the trailing-slash form everywhere it matters — canonical
  // tags, hreflang, nav links, sitemap, `start_url` — but the setting stays
  // `ignore` so the extension-less machine endpoints (`/health`, `/revision`)
  // are not forced through a 301 to a slashed spelling.
  trailingSlash: 'ignore',

  site:
    process.env.PUBLIC_REGION === 'us'
      ? 'https://docs-us.umaxica.org'
      : 'https://docs-jp.umaxica.org',

  output: 'static',
  adapter: cloudflare({
    configPath: './wrangler.jsonc',
    inspectorPort: 9306,
    platformProxy: { enabled: true, configPath: './wrangler.jsonc' },
    // A Workers VPC Service has no local simulator, so any build that tries to
    // resolve the binding opens a remote proxy session that only an interactive
    // `wrangler login` can authenticate. Prerendering never touches a binding —
    // run it in Node — and the build must not reach for the real binding.
    // Mirrors adr/013 sub-decision 3 (`remoteBindings: false unless CLOUDFLARE_ENV=vpc`).
    remoteBindings: process.env.CLOUDFLARE_ENV === 'vpc',
    prerenderEnvironment: 'node',
    // No image optimisation layer — the TanStack unit had none.
    imageService: 'passthrough',
  }),

  // This unit holds no session state; the adapter's KV session binding is inert
  // but declaring it off keeps the generated wrangler config honest.
  session: false,

  integrations: [react()],

  build: {
    // Force every stylesheet to an external same-origin file so the CSP can be
    // `style-src 'self'` with no `'unsafe-inline'` and no per-build hash.
    inlineStylesheets: 'never',
    assets: 'assets',
    format: 'directory',
  },

  env: {
    schema: {
      PUBLIC_REGION: envField.enum({
        context: 'client',
        access: 'public',
        values: ['jp', 'us'],
        default: 'jp',
      }),
      RAILS_STAFF_ORIGIN: envField.string({
        context: 'server',
        access: 'secret',
        default: 'http://base.org.localhost:3000',
      }),
    },
  },

  vite: {
    // Behind a Cloudflare Tunnel the dev server sees the public hostname in the
    // Host header; Vite blocks unknown hosts by default. Whitelist the two fixed
    // public hostnames (not `true`, which disables DNS-rebinding protection).
    server: {
      allowedHosts: ['docs-jp.umaxica.org', 'docs-us.umaxica.org'],
    },
    plugins: [
      tailwindcss(),
      // workerd's Vite module runner invalidates deps_ssr mid-reload when the
      // optimizer discovers `astro/assets/services/noop` on first request
      // (passthrough image service). Pre-include it so `astro dev` does not
      // crash with "The file does not exist at .../deps_ssr/server-*.js".
      {
        name: 'ssr-optimize-passthrough-image',
        configEnvironment(name) {
          if (name === 'client') return;
          return { optimizeDeps: { include: ['astro/assets/services/noop'] } };
        },
      },
    ],
  },
});
