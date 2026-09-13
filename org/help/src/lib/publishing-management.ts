import { isPublishingAudience, isPublishingSurface, type PublishingCell } from './publishing-model';
import { parseRailsStaffOrigin } from './rails-staff-origin';

/*
 * Links from a public page into the Rails Publishing CMS.
 *
 * They are ALWAYS rendered. This unit is anonymous: it never reads a session,
 * never asks Rails who the visitor is, and so never decides whether to show a
 * management link. Rails is the authentication and authorization boundary —
 * following the link as a signed-in editor opens the CMS, as a stranger the
 * sign-in page, as an unauthorized account a denial.
 *
 * The origin is the browser-facing Rails staff origin (`RAILS_STAFF_BASE_ORIGIN`),
 * never the private Worker → Rails hop; `parseRailsStaffOrigin` refuses the
 * latter. Member identity is `public_id`, never a database id or slug.
 */

function requireCell(cell: PublishingCell): PublishingCell {
  if (!isPublishingSurface(cell.surface) || !isPublishingAudience(cell.audience)) {
    throw new Error('unknown publishing cell');
  }
  return cell;
}

/** `/publishing/{surface}/{audience}/entries` on the Rails staff origin. */
export function managementIndexUrl(origin: string, cell: PublishingCell): string {
  const { surface, audience } = requireCell(cell);
  return `${parseRailsStaffOrigin(origin)}/publishing/${surface}/${audience}/entries`;
}

/** `/publishing/{surface}/{audience}/entries/{public_id}/edit` on the Rails staff origin. */
export function managementEditUrl(origin: string, cell: PublishingCell, publicId: string): string {
  const { surface, audience } = requireCell(cell);
  if (publicId.length === 0) {
    throw new Error('public_id is required');
  }
  return `${parseRailsStaffOrigin(origin)}/publishing/${surface}/${audience}/entries/${encodeURIComponent(publicId)}/edit`;
}
