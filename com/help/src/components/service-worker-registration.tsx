'use client';

import { useEffect } from 'react';

const SERVICE_WORKER_URL = '/service-worker.js';
const SERVICE_WORKER_SCOPE = '/';

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      return;
    }

    void navigator.serviceWorker
      .register(SERVICE_WORKER_URL, {
        scope: SERVICE_WORKER_SCOPE,
        updateViaCache: 'none',
      })
      .catch(() => undefined);
  }, []);

  return null;
}
