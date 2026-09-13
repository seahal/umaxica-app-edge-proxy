import { createFileRoute } from '@tanstack/react-router';

import { revisionTextResponse } from '../lib/version-metadata';

export const Route = createFileRoute('/revision')({
  server: {
    handlers: {
      GET: () => revisionTextResponse(),
    },
  },
});
