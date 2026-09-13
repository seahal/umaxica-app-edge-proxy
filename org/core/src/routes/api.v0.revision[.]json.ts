import { createFileRoute } from '@tanstack/react-router';

import { revisionJsonResponse } from '../lib/version-metadata';

/*
 * Structured Workers version metadata. Server route only: no component, no
 * HTML, no Rails, no health. The filename escapes the literal `.json`.
 */
export const Route = createFileRoute('/api/v0/revision.json')({
  server: {
    handlers: {
      GET: () => revisionJsonResponse(),
    },
  },
});
