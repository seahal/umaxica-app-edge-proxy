import { createFileRoute } from '@tanstack/react-router';

import { renderHealthApi } from '../lib/runtime-health';

/*
 * Machine-facing Edge self-health API. This handler does not import Rails or any
 * other hop: it describes this Worker only.
 */
export const Route = createFileRoute('/api/v0/health.json')({
  server: {
    handlers: {
      GET: () => renderHealthApi(),
    },
  },
});
