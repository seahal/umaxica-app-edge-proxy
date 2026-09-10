import { parseRailsStaffOrigin } from './rails-staff-origin';

export const PUBLISHING_SURFACES = ['info', 'docs', 'news', 'help'] as const;
export const PUBLISHING_AUDIENCES = ['app', 'com', 'org'] as const;

export type PublishingSurface = (typeof PUBLISHING_SURFACES)[number];
export type PublishingAudience = (typeof PUBLISHING_AUDIENCES)[number];

function isPublishingSurface(value: string): value is PublishingSurface {
  return (PUBLISHING_SURFACES as readonly string[]).includes(value);
}

function isPublishingAudience(value: string): value is PublishingAudience {
  return (PUBLISHING_AUDIENCES as readonly string[]).includes(value);
}

function requireCell(
  surface: string,
  audience: string,
): {
  surface: PublishingSurface;
  audience: PublishingAudience;
} {
  if (!isPublishingSurface(surface) || !isPublishingAudience(audience)) {
    throw new Error('unknown publishing cell');
  }
  return { surface, audience };
}

/**
 * Rails management index for one publishing cell.
 * Member identity is `public_id`, never a database id or slug.
 */
export function managementIndexUrl(
  origin: string,
  surface: PublishingSurface,
  audience: PublishingAudience,
): string {
  const cell = requireCell(surface, audience);
  return `${parseRailsStaffOrigin(origin)}/publishing/${cell.surface}/${cell.audience}/entries`;
}

export function managementEditUrl(
  origin: string,
  surface: PublishingSurface,
  audience: PublishingAudience,
  publicId: string,
): string {
  const cell = requireCell(surface, audience);
  if (publicId.length === 0) {
    throw new Error('public_id is required');
  }
  return `${parseRailsStaffOrigin(origin)}/publishing/${cell.surface}/${cell.audience}/entries/${encodeURIComponent(publicId)}/edit`;
}
