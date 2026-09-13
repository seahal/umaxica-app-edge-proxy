import { describe, it, expect } from 'vitest';

import type { RailsClient, RailsClientResult } from '../../src/lib/rails-client';
import { checkRailsHealth, edgeReadinessFromRails } from '../../src/lib/rails-health';

function makeClient(result: RailsClientResult): RailsClient {
  return {
    fetch: () => Promise.resolve(result),
  };
}

const PASS_DOCUMENT = {
  status: 'pass',
  timestamp: '2026-09-05T09:33:29Z',
  checks: {
    startup: { status: 'pass' },
    liveness: { status: 'pass' },
    readiness: { status: 'pass' },
  },
};

function jsonResponse(status: number, body: unknown, contentType = 'application/json'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': contentType },
  });
}

const LEAK_MARKERS = [
  'internal details',
  'connection refused to core.app.localhost',
  '019f5fe0-287f-7040-9f2f-036cb5b21df7',
  'session=abc123',
  'Bearer token-value',
  'localhost',
  'ProxyError',
];

describe('rails health api consumer', () => {
  it('requests the unprefixed Health API path and nothing else', async () => {
    const paths: string[] = [];
    const client: RailsClient = {
      fetch: (path) => {
        paths.push(path);
        return Promise.resolve({
          kind: 'ok',
          status: 200,
          response: jsonResponse(200, PASS_DOCUMENT),
        });
      },
    };

    await checkRailsHealth(client);

    expect(paths).toEqual(['/api/v0/health.json']);
  });

  it('reports not-configured when no client is available', async () => {
    const report = await checkRailsHealth(null);
    expect(report).toEqual({ kind: 'not-configured' });
    expect(edgeReadinessFromRails(report)).toBe('ok');
  });

  it('reports pass for HTTP 200 application/json with status=pass', async () => {
    const report = await checkRailsHealth(
      makeClient({ kind: 'ok', status: 200, response: jsonResponse(200, PASS_DOCUMENT) }),
    );
    expect(report).toEqual({ kind: 'pass', status: 200 });
    expect(edgeReadinessFromRails(report)).toBe('ok');
  });

  it('reports warn for HTTP 200 application/json with status=warn', async () => {
    const body = {
      ...PASS_DOCUMENT,
      status: 'warn',
      checks: { ...PASS_DOCUMENT.checks, readiness: { status: 'warn' } },
    };
    const report = await checkRailsHealth(
      makeClient({ kind: 'ok', status: 200, response: jsonResponse(200, body) }),
    );
    expect(report.kind).toBe('warn');
    expect(edgeReadinessFromRails(report)).toBe('ok');
  });

  it('reports fail for HTTP 503 application/json with status=fail', async () => {
    const body = {
      status: 'fail',
      timestamp: '2026-09-05T09:33:29Z',
      checks: {
        startup: { status: 'pass' },
        liveness: { status: 'pass' },
        readiness: { status: 'fail' },
      },
    };
    const report = await checkRailsHealth(
      makeClient({
        kind: 'http-error',
        status: 503,
        response: jsonResponse(503, body),
      }),
    );
    expect(report).toEqual({ kind: 'fail', status: 503 });
    expect(edgeReadinessFromRails(report)).toBe('error');
  });

  it('accepts charset parameters and additive unknown fields', async () => {
    const body = {
      status: 'pass',
      timestamp: '2026-09-05T09:33:29Z',
      checks: {
        startup: { status: 'pass' },
        liveness: { status: 'pass' },
        readiness: { status: 'pass' },
        storage: { status: 'warn' },
      },
      some_future_field: {},
    };
    const report = await checkRailsHealth(
      makeClient({
        kind: 'ok',
        status: 200,
        response: jsonResponse(200, body, 'application/json; charset=utf-8'),
      }),
    );
    expect(report.kind).toBe('pass');
  });

  it('reports invalid-contract for an unknown status vocabulary', async () => {
    const report = await checkRailsHealth(
      makeClient({
        kind: 'ok',
        status: 200,
        response: jsonResponse(200, { ...PASS_DOCUMENT, status: 'banana' }),
      }),
    );
    expect(report.kind).toBe('invalid-contract');
    expect(edgeReadinessFromRails(report)).toBe('error');
  });

  it('reports invalid-contract when HTTP 200 carries status=fail', async () => {
    const report = await checkRailsHealth(
      makeClient({
        kind: 'ok',
        status: 200,
        response: jsonResponse(200, { ...PASS_DOCUMENT, status: 'fail' }),
      }),
    );
    expect(report.kind).toBe('invalid-contract');
  });

  it('reports invalid-contract when HTTP 503 carries status=pass', async () => {
    const report = await checkRailsHealth(
      makeClient({
        kind: 'http-error',
        status: 503,
        response: jsonResponse(503, PASS_DOCUMENT),
      }),
    );
    expect(report.kind).toBe('invalid-contract');
  });

  it('reports invalid-contract for text/plain and text/html bodies', async () => {
    const plain = await checkRailsHealth(
      makeClient({
        kind: 'ok',
        status: 200,
        response: new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } }),
      }),
    );
    const html = await checkRailsHealth(
      makeClient({
        kind: 'ok',
        status: 200,
        response: new Response('<html></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      }),
    );
    expect(plain.kind).toBe('invalid-contract');
    expect(html.kind).toBe('invalid-contract');
  });

  it('reports invalid-contract for invalid JSON', async () => {
    const report = await checkRailsHealth(
      makeClient({
        kind: 'ok',
        status: 200,
        response: new Response('{', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      }),
    );
    expect(report.kind).toBe('invalid-contract');
  });

  it('reports invalid-contract when a required check is missing', async () => {
    const report = await checkRailsHealth(
      makeClient({
        kind: 'ok',
        status: 200,
        response: jsonResponse(200, {
          status: 'pass',
          checks: { startup: { status: 'pass' }, liveness: { status: 'pass' } },
        }),
      }),
    );
    expect(report.kind).toBe('invalid-contract');
  });

  it.each([
    ['missing', undefined],
    ['without a timezone', '2026-09-05T09:33:29'],
    ['with an invalid offset', '2026-09-05T09:33:29+99:00'],
  ])('reports invalid-contract for a timestamp %s', async (_label, timestamp) => {
    const body = { ...PASS_DOCUMENT, timestamp };
    const report = await checkRailsHealth(
      makeClient({ kind: 'ok', status: 200, response: jsonResponse(200, body) }),
    );
    expect(report).toEqual({ kind: 'invalid-contract', status: 200 });
  });

  it('accepts an explicit UTC offset in the timestamp', async () => {
    const body = { ...PASS_DOCUMENT, timestamp: '2026-09-05T18:33:29+09:00' };
    const report = await checkRailsHealth(
      makeClient({ kind: 'ok', status: 200, response: jsonResponse(200, body) }),
    );
    expect(report).toEqual({ kind: 'pass', status: 200 });
  });

  it('reports invalid-contract on a redirect', async () => {
    const report = await checkRailsHealth(
      makeClient({
        kind: 'http-error',
        status: 302,
        response: new Response(null, { status: 302, headers: { location: '/elsewhere' } }),
      }),
    );
    expect(report.kind).toBe('invalid-contract');
    expect(report.status).toBe(302);
  });

  it('reports http-error for a non-health HTTP failure', async () => {
    const report = await checkRailsHealth(
      makeClient({
        kind: 'http-error',
        status: 404,
        response: new Response('missing', { status: 404 }),
      }),
    );
    expect(report).toEqual({ kind: 'http-error', status: 404 });
    expect(JSON.stringify(report)).not.toContain('missing');
  });

  it('reports unreachable when the VPC cannot reach Rails', async () => {
    const report = await checkRailsHealth(
      makeClient({ kind: 'unreachable', errorMessage: 'connection refused to core.app.localhost' }),
    );
    expect(report).toEqual({ kind: 'unreachable' });
    expect(edgeReadinessFromRails(report)).toBe('error');
  });

  it('maps a ProxyError-shaped client result to unreachable without the body', async () => {
    const report = await checkRailsHealth(
      makeClient({ kind: 'unreachable', errorMessage: 'ProxyError: connection_refused' }),
    );
    expect(report.kind).toBe('unreachable');
    expect(JSON.stringify(report)).not.toContain('ProxyError');
  });

  it('publishes no timing for the private hop, in any outcome', async () => {
    const reports = [
      await checkRailsHealth(null),
      await checkRailsHealth(
        makeClient({ kind: 'ok', status: 200, response: jsonResponse(200, PASS_DOCUMENT) }),
      ),
      await checkRailsHealth(makeClient({ kind: 'unreachable', errorMessage: 'nope' })),
    ];

    for (const report of reports) {
      expect(Object.keys(report)).not.toContain('latency_ms');
      expect(JSON.stringify(report)).not.toContain('latency');
    }
  });

  it('maps an unexpected client kind to unreachable without naming the kind', async () => {
    const report = await checkRailsHealth(
      makeClient({ kind: 'timeout' } as unknown as RailsClientResult),
    );
    expect(report.kind).toBe('unreachable');
    expect(JSON.stringify(report)).not.toContain('timeout');
  });

  it('maps an invalid-path client result to unreachable without its reason', async () => {
    const report = await checkRailsHealth(
      makeClient({ kind: 'invalid-path', reason: 'path must not be empty' }),
    );
    expect(report.kind).toBe('unreachable');
    expect(JSON.stringify(report)).not.toContain('path must not be empty');
  });

  it.each(LEAK_MARKERS)('never surfaces %s, whatever the client reports', async (marker) => {
    for (const result of [
      { kind: 'unreachable', errorMessage: marker },
      { kind: 'invalid-path', reason: marker },
      { kind: 'http-error', status: 500, response: new Response(marker, { status: 500 }) },
      {
        kind: 'ok',
        status: 200,
        response: jsonResponse(200, { ...PASS_DOCUMENT, message: marker }),
      },
    ] satisfies RailsClientResult[]) {
      const report = await checkRailsHealth(makeClient(result));
      expect(JSON.stringify(report)).not.toContain(marker);
    }
  });
  /*
   * The parser's rejection paths, each reached by a body that is well-formed
   * JSON right up to the point it stops matching the Health API contract.
   * `parseHealthDocument` and `parseCheck` are not exported — they are reached
   * the way Rails reaches them, through `checkRailsHealth`, so these pin the
   * behaviour rather than the shape of a private function.
   */
  it.each([
    ['a JSON number', 42],
    ['a JSON string', 'pass'],
    ['a JSON array', [{ status: 'pass' }]],
    ['JSON null', null],
  ])('reports invalid-contract for a document that is %s', async (_label, body) => {
    const report = await checkRailsHealth(
      makeClient({ kind: 'ok', status: 200, response: jsonResponse(200, body) }),
    );
    expect(report).toEqual({ kind: 'invalid-contract', status: 200 });
  });

  it.each([
    ['a string', 'all good'],
    ['an array', []],
    ['null', null],
  ])('reports invalid-contract when checks is %s', async (_label, checks) => {
    const report = await checkRailsHealth(
      makeClient({
        kind: 'ok',
        status: 200,
        response: jsonResponse(200, { status: 'pass', checks }),
      }),
    );
    expect(report).toEqual({ kind: 'invalid-contract', status: 200 });
  });

  it('reports invalid-contract when a check carries an unknown status', async () => {
    // Distinct from the missing-check case above: `readiness` IS an object, so
    // `parseCheck` gets past its own shape guard and rejects on the vocabulary.
    const report = await checkRailsHealth(
      makeClient({
        kind: 'ok',
        status: 200,
        response: jsonResponse(200, {
          status: 'pass',
          checks: {
            startup: { status: 'pass' },
            liveness: { status: 'pass' },
            readiness: { status: 'degraded' },
          },
        }),
      }),
    );
    expect(report).toEqual({ kind: 'invalid-contract', status: 200 });
  });

  it('reports invalid-contract when the response declares no content type', async () => {
    // A body with no declared type is not a Health API document, however
    // well-formed it is: the media type is the contract, not the bytes.
    const report = await checkRailsHealth(
      makeClient({
        kind: 'ok',
        status: 200,
        // A stream body, because a string body makes the constructor default
        // `Content-Type` to `text/plain` — which is a DIFFERENT rejection, the
        // one two tests above already cover. This one has no type at all.
        response: new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(JSON.stringify(PASS_DOCUMENT)));
              controller.close();
            },
          }),
          { status: 200 },
        ),
      }),
    );
    expect(report).toEqual({ kind: 'invalid-contract', status: 200 });
  });

  it('reports invalid-contract for a body past the size bound, without parsing it', async () => {
    // The bound exists so a Rails response that is JSON but enormous cannot be
    // turned into work here. Padded past 65536 characters while staying valid
    // JSON and a valid document, so the size check is the only thing that can
    // reject it.
    const oversized = { ...PASS_DOCUMENT, note: 'x'.repeat(70000) };
    const report = await checkRailsHealth(
      makeClient({ kind: 'ok', status: 200, response: jsonResponse(200, oversized) }),
    );
    expect(report).toEqual({ kind: 'invalid-contract', status: 200 });
  });

  it('reports invalid-contract when the body stream fails mid-read', async () => {
    // Not producible by a Hurl request: the connection has to break after the
    // headers are already in hand. `app.request()` is not involved — the client
    // seam is the injection point.
    const failing = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error('stream broke'));
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );

    const report = await checkRailsHealth(
      makeClient({ kind: 'ok', status: 200, response: failing }),
    );

    expect(report).toEqual({ kind: 'invalid-contract', status: 200 });
    expect(JSON.stringify(report)).not.toContain('stream broke');
  });
});
