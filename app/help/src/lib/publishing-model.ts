/*
 * The two axes of the twelve-cell Publishing matrix, and nothing else.
 *
 * Every public content unit is exactly one cell: a `surface` (what kind of
 * content) crossed with an `audience` (which brand family). Both are closed
 * unions so that a cell can only ever be one of the twelve, and so that no
 * hostname, directory name or request input can mint a thirteenth.
 *
 * The values a unit actually serves are declared statically in
 * `src/lib/publishing-cell.ts` — the one source file that differs between the
 * twelve units. This file is byte-identical across all of them.
 *
 * Naming across the Rails boundary: Rails calls the surface `namespace` and the
 * audience `surface` in an Entry representation. `publishing-api.ts` is the only
 * place that translates between the two vocabularies.
 */
export const PUBLISHING_SURFACES = ['info', 'docs', 'news', 'help'] as const;
export const PUBLISHING_AUDIENCES = ['app', 'com', 'org'] as const;

export type PublishingSurface = (typeof PUBLISHING_SURFACES)[number];
export type PublishingAudience = (typeof PUBLISHING_AUDIENCES)[number];

export interface PublishingCell {
  surface: PublishingSurface;
  audience: PublishingAudience;
}

export function isPublishingSurface(value: string): value is PublishingSurface {
  return PUBLISHING_SURFACES.some((surface) => surface === value);
}

export function isPublishingAudience(value: string): value is PublishingAudience {
  return PUBLISHING_AUDIENCES.some((audience) => audience === value);
}
