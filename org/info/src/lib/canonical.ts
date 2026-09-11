import { CANONICAL_ORIGINS } from './publishing-cell';

/*
 * This unit's public origin, and the only place it is chosen.
 *
 * `robots.txt`, `sitemap.xml`, every `<link rel="canonical">` and every hreflang
 * alternate name it, and they must not disagree.
 *
 * Region (jp/us) is a build-time input: `vite.config.ts` replaces
 * `import.meta.env.PUBLIC_REGION` with a literal, so one build serves one
 * region. Anything other than `us` — including an unset variable under Vitest —
 * selects `jp`, which is what every build script passes today.
 */
export const CANONICAL_ORIGIN: string =
  import.meta.env.PUBLIC_REGION === 'us' ? CANONICAL_ORIGINS.us : CANONICAL_ORIGINS.jp;
