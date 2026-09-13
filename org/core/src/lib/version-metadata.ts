import { getEdgeEnv } from './cloudflare-env';

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
    const { id = null, tag = null, timestamp = null } = getEdgeEnv().REVISION ?? {};
    return { id: id ?? null, tag: tag ?? null, timestamp: timestamp ?? null };
  } catch {
    return EMPTY;
  }
}

export function revisionTextBody(metadata: VersionMetadata = readVersionMetadata()): string {
  return `${metadata.id ?? 'unknown'}\n`;
}

const NO_STORE = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
} as const;

export function revisionTextResponse(): Response {
  return new Response(revisionTextBody(), {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      ...NO_STORE,
    },
  });
}

export function revisionJsonResponse(): Response {
  return Response.json(readVersionMetadata(), {
    headers: NO_STORE,
  });
}
