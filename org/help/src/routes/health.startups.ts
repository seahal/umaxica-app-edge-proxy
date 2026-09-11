import { createFileRoute } from '@tanstack/react-router';

import { renderProbe } from '../lib/runtime-health';

export const Route = createFileRoute('/health/startups')({
  server: {
    handlers: {
      GET: () => renderProbe('startup'),
    },
  },
});
