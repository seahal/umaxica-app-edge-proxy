import {
  createStartHandler,
  defaultRenderHandler,
  defineHandlerCallback,
} from '@tanstack/react-start/server';

import { handleAppRequest } from './app-request';
import '../security-nonce-als';

/*
 * The application half of this Worker, behind a one-function seam.
 *
 * `src/worker.ts` classifies the path, rate-limits once, dispatches Rails-owned
 * paths to Rails and strips `Cookie` in and `Set-Cookie` out around
 * whatever answers the rest (adr/007-shared-fqdn-core-dispatch.md). It names
 * this module rather than a framework, so which framework renders the
 * application half stays a detail of this file.
 *
 * The security headers are applied in `handleAppRequest` rather than in
 * `worker.ts`, and the distinction is the ADR 007 boundary itself: they belong
 * to documents this application renders. A Rails-owned response is Rails' to
 * header, and passing it through this function would have Edge silently rewrite
 * Rails' policy.
 *
 * `defaultRenderHandler`, not `defaultStreamHandler`, and the choice is
 * load-bearing: streaming flushes the shell before a failure is known, which
 * produces a 200 with no `<title>` for a thrown error. Measured, and one of the
 * four constraints in `adr/013-frames-tanstack-start.md`.
 *
 * This file is wiring only. The nonce mint and the header wrap live in
 * `src/lib/app-request.ts`, because `createStartHandler` resolves in the Worker
 * build and nowhere else — so a test can reach the behaviour but not this
 * module. The ALS store is installed here so `node:async_hooks` never enters
 * the client graph (`security-nonce-als.ts`).
 */
const fetchHandler = createStartHandler(defineHandlerCallback((ctx) => defaultRenderHandler(ctx)));

export default {
  async fetch(request: Request): Promise<Response> {
    return handleAppRequest(request, fetchHandler, import.meta.env.PROD);
  },
};
