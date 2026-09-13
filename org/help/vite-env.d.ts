/*
 * The narrow slice of Vite's client types this unit actually uses.
 *
 * Referencing `vite/client` wholesale would pull in declarations for every asset
 * type Vite knows about; this unit imports exactly one, the compiled stylesheet
 * URL, and reads three build-mode flags plus the build-time region.
 *
 * It lives at the unit root rather than in `src/`: a `.d.ts` whose basename
 * matches a sibling `.ts` is treated by TypeScript as that file's generated
 * declaration and silently dropped from the program.
 */
declare module '*.css?url' {
  const url: string;
  export default url;
}

interface ImportMetaEnv {
  /** `'production'` after `vite build`, `'development'` under `vite dev`. */
  readonly MODE: string;
  readonly PROD: boolean;
  readonly DEV: boolean;
  /** `'jp'` or `'us'`, replaced with a literal by `vite.config.ts`. */
  readonly PUBLIC_REGION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
