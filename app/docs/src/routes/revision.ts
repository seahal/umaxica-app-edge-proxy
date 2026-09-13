import { createFileRoute } from '@tanstack/react-router';

import { revisionTextResponse } from '../lib/version-metadata';

/*
 * Compact operational deployment revision: the Workers version id as text/plain.
 * Structured { id, tag, timestamp } is GET /api/v0/revision.json. Missing
 * metadata is the text sentinel `unknown`, never JSON.
 */
export const Route = createFileRoute('/revision')({
  server: {
    handlers: {
      GET: () => revisionTextResponse(),
    },
  },
});
