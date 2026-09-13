import { BRAND_TITLE } from './publishing-cell';

/*
 * The UMAXICA brand title contract.
 *
 * The separator is an EM DASH (U+2014) with a single space on each side — not a
 * hyphen, not an EN DASH. `api/title-contract.hurl` and the repository-wide
 * suite match the exact character. The brand itself is this cell's
 * `BRAND_TITLE`, declared once in `src/lib/publishing-cell.ts`.
 */
export { BRAND_TITLE };

export function brandTitle(pageTitle: string): string {
  return `${pageTitle} — ${BRAND_TITLE}`;
}
