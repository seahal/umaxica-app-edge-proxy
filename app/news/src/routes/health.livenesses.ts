import { createFileRoute } from '@tanstack/react-router';

import { renderProbe } from '../lib/runtime-health';

export const Route = createFileRoute('/health/livenesses')({
  server: {
    handlers: {
      GET: () => renderProbe('liveness'),
    },
  },
});
