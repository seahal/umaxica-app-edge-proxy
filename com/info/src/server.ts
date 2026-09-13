import {
  createStartHandler,
  defaultRenderHandler,
  defineHandlerCallback,
} from '@tanstack/react-start/server';
import { createServerEntry } from '@tanstack/react-start/server-entry';

import { handleRequest } from './request-handler';
import './security-nonce-als';

/*
 * This unit's Worker entry (`main` in wrangler.jsonc), and wiring only: the
 * behaviour lives in `src/request-handler.ts`, because
 * `@tanstack/react-start/server-entry` resolves in the Worker build and nowhere
 * else — so a test can reach the boundary's logic but not this module.
 *
 * `defaultRenderHandler`, NOT `defaultStreamHandler`, and the choice is
 * load-bearing: streaming flushes the shell before a failure is known, which
 * produces a 200 with no `<title>` for a thrown error. Rendering to a string
 * first also means the status and the `headers()` of every matched route are
 * final before the first byte is sent. See adr/013-frames-tanstack-start.md.
 *
 * The ALS nonce store is installed here so `node:async_hooks` never enters the
 * client graph (`security-nonce-als.ts`).
 *
 * `import.meta.env.PROD` is replaced with a literal at build time, so the
 * development branch of the CSP is eliminated from the deployed bundle.
 */
const fetchHandler = createStartHandler(defineHandlerCallback((ctx) => defaultRenderHandler(ctx)));

export default createServerEntry({
  fetch: (request: Request) => handleRequest(request, fetchHandler, import.meta.env.PROD),
});
