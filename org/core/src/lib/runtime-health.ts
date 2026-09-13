/*
 * Kubernetes-style probes for this Worker. Startup and liveness are the
 * process itself: if this module ran, the isolate can serve. Readiness is
 * composed by the route: isolate first, then the Rails Health API consumer.
 * This module still does not fetch Rails — it only renders Edge's text/plain
 * contract from already-normalized probe statuses.
 */

/*
 * The two probes this frame answers from the isolate alone.
 *
 * Readiness is deliberately not one of them. The readiness route composes the
 * isolate status with the Rails Health API and hands the result to
 * `renderProbeStatus`, so a `renderProbe('readiness')` arm would be a second
 * definition of readiness — one that consults nothing, that nothing calls, and
 * that would answer `ok` while the real one answered `error`.
 */
export type ProbeName = 'startup' | 'liveness';
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
  return renderProbeStatus(
    name === 'startup' ? runtimeProbes.checkStartup() : runtimeProbes.checkLiveness(),
  );
}

export function renderProbeStatus(status: ProbeStatus): Response {
  return healthResponse(probeBody(status), status === 'ok');
}

export function renderAggregateHealth(
  readiness: ProbeStatus = runtimeProbes.checkReadiness(),
): Response {
  const startup = runtimeProbes.checkStartup();
  const liveness = runtimeProbes.checkLiveness();
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
