import { createFileRoute } from '@tanstack/react-router';

import { revisionJsonResponse } from '../lib/version-metadata';

/* Structured Workers version metadata. Not health. */
export const Route = createFileRoute('/api/v0/revision.json')({
  server: {
    handlers: {
      GET: () => revisionJsonResponse(),
    },
  },
});
