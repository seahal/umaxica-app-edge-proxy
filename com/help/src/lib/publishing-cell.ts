import type { PublishingAudience, PublishingSurface } from './publishing-model';

/*
 * THIS unit's cell, and the only source file that differs between the twelve
 * public content units. Everything else under `src/` and `test/` is
 * byte-identical across `{app,com,org}/{docs,help,info,news}` —
 * `test/publishing-cells.test.ts` at the repository root enforces both halves.
 *
 * Every value is a static literal on purpose. The cell is never inferred from a
 * hostname, a directory name or anything a request carries.
 */

/** Which content surface this unit serves. Rails calls this `namespace`. */
export const PUBLISHING_SURFACE: PublishingSurface = 'help';

/** Which brand family this unit serves. Rails calls this `surface`. */
export const PUBLISHING_AUDIENCE: PublishingAudience = 'com';

/**
 * The UMAXICA brand title for this family. `src/lib/title.ts` appends it to
 * every page title with an EM DASH.
 */
export const BRAND_TITLE = 'UMAXICA (COM)';

/**
 * This unit's public origin per region. Region is a build-time input
 * (`PUBLIC_REGION`), never a path segment; `src/lib/canonical.ts` picks one.
 */
export const CANONICAL_ORIGINS = {
  jp: 'https://help-jp.umaxica.com',
  us: 'https://help-us.umaxica.com',
} as const;

/*
 * The Rails entry point for this cell over the PRIVATE Worker → Rails hop.
 *
 * Workers VPC does NOT route on this host; the VPC Service decides where the
 * connection goes and this URL only populates the `Host` header, which Rails
 * dispatches on to `<Frame>::<Brand>::…`. Editing it changes which Rails
 * namespace answers. It never appears in a response and is never a browser link
 * — the browser-facing Rails staff origin is `RAILS_STAFF_BASE_ORIGIN`.
 */
export const PRIVATE_RAILS_ORIGIN = 'http://help.com.localhost:3000';
