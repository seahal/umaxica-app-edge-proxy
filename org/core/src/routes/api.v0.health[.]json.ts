import { createFileRoute } from '@tanstack/react-router';

import { renderHealthApi } from '../lib/runtime-health';

/*
 * Machine-facing Edge self-health API. Server route only: no component, no
 * HTML, no Rails, no revision. The filename escapes the literal `.json`.
 */
export const Route = createFileRoute('/api/v0/health.json')({
  server: {
    handlers: {
      GET: () => renderHealthApi(),
    },
  },
});
