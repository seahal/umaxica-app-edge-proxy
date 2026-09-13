import { getEdgeBindings } from './env';

export type VersionMetadata = {
  id: string | null;
  tag: string | null;
  timestamp: string | null;
};

const EMPTY: VersionMetadata = { id: null, tag: null, timestamp: null };

/*
 * Cloudflare Workers version_metadata (bound as REVISION). One read, two
 * public representations: /revision (id text) and /api/v0/revision.json.
 */
export function readVersionMetadata(): VersionMetadata {
  try {
    const { id = null, tag = null, timestamp = null } = getEdgeBindings().REVISION ?? {};
    return { id: id ?? null, tag: tag ?? null, timestamp: timestamp ?? null };
  } catch {
    return EMPTY;
  }
}

export function revisionTextBody(metadata: VersionMetadata = readVersionMetadata()): string {
  return `${metadata.id ?? 'unknown'}\n`;
}

export function revisionTextResponse(): Response {
  return new Response(revisionTextBody(), {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

export function revisionJsonResponse(): Response {
  return new Response(JSON.stringify(readVersionMetadata()), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
