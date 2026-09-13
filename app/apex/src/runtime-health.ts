/*
 * Kubernetes-style probes for this Worker. Startup and liveness are the
 * process itself: if this module ran, the isolate can serve. Readiness does
 * not call Rails, CMS, KV, or any other hop — prerendered pages do not need
 * them, and a downstream outage must not mark a healthy Worker unready.
 */

export type ProbeName = 'startup' | 'liveness' | 'readiness';
export type ProbeStatus = 'ok' | 'error';

export const HEALTH_CONTENT_TYPE = 'text/plain; charset=utf-8';
export const HEALTH_CACHE_CONTROL = 'no-store';

const HEALTH_HEADERS = {
  'Content-Type': HEALTH_CONTENT_TYPE,
  'Cache-Control': HEALTH_CACHE_CONTROL,
  'X-Robots-Tag': 'noindex, nofollow',
} as const;

export const runtimeProbes = {
  checkStartup(): ProbeStatus {
    return 'ok';
  },
  checkLiveness(): ProbeStatus {
    return 'ok';
  },
  checkReadiness(): ProbeStatus {
    return 'ok';
  },
};

export function probeBody(status: ProbeStatus): string {
  return `${status}\n`;
}

export function aggregateBody(
  startup: ProbeStatus,
  liveness: ProbeStatus,
  readiness: ProbeStatus,
): string {
  const status: ProbeStatus =
    startup === 'ok' && liveness === 'ok' && readiness === 'ok' ? 'ok' : 'error';
  return `status: ${status}\nstartup: ${startup}\nliveness: ${liveness}\nreadiness: ${readiness}\n`;
}

function healthResponse(body: string, ok: boolean): Response {
  return new Response(body, {
    status: ok ? 200 : 503,
    headers: HEALTH_HEADERS,
  });
}

export function renderProbe(name: ProbeName): Response {
  const status =
    name === 'startup'
      ? runtimeProbes.checkStartup()
      : name === 'liveness'
        ? runtimeProbes.checkLiveness()
        : runtimeProbes.checkReadiness();
  return healthResponse(probeBody(status), status === 'ok');
}

export function renderAggregateHealth(): Response {
  const startup = runtimeProbes.checkStartup();
  const liveness = runtimeProbes.checkLiveness();
  const readiness = runtimeProbes.checkReadiness();
  const ok = startup === 'ok' && liveness === 'ok' && readiness === 'ok';
  return healthResponse(aggregateBody(startup, liveness, readiness), ok);
}

const HEALTH_API_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': HEALTH_CACHE_CONTROL,
  'X-Robots-Tag': 'noindex, nofollow',
} as const;

export type HealthApiStatus = 'pass' | 'warn' | 'fail';

export function healthApiDocument(): {
  status: HealthApiStatus;
  checks: {
    startup: { status: HealthApiStatus };
    liveness: { status: HealthApiStatus };
    readiness: { status: HealthApiStatus };
  };
} {
  return {
    status: 'pass',
    checks: {
      startup: { status: 'pass' },
      liveness: { status: 'pass' },
      readiness: { status: 'pass' },
    },
  };
}

export function renderHealthApi(): Response {
  return new Response(JSON.stringify(healthApiDocument()), {
    status: 200,
    headers: HEALTH_API_HEADERS,
  });
}
