import { createFileRoute } from '@tanstack/react-router';

import { getEdgeBindings } from '../lib/env';
import { getRailsClient } from '../lib/rails-client';
import { checkRailsHealth, edgeReadinessFromRails } from '../lib/rails-health';
import { renderProbeStatus, runtimeProbes } from '../lib/runtime-health';

export const Route = createFileRoute('/health/readinesses')({
  server: {
    handlers: {
      GET: async () => {
        const isolate = runtimeProbes.checkReadiness();
        const readiness =
          isolate === 'ok'
            ? edgeReadinessFromRails(await checkRailsHealth(getRailsClient(getEdgeBindings())))
            : isolate;
        return renderProbeStatus(readiness);
      },
    },
  },
});
