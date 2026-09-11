/*
 * The per-request CSP nonce, and the only channel that carries it.
 *
 * `createStartHandler` calls the router entry's `getRouter()` with no arguments,
 * once per request, so there is no parameter to thread a nonce through and a
 * module-level variable would be shared by every request the isolate has in
 * flight at once. `AsyncLocalStorage` is the one mechanism that scopes a value
 * to the request that created it; `nodejs_compat` is already on for this Worker.
 *
 * The nonce exists in PRODUCTION only. `vite dev` injects its own inline scripts
 * (the HMR client, React Refresh's preamble) which carry no nonce, and a policy
 * that names a nonce makes a browser IGNORE `'unsafe-inline'` entirely — so a
 * nonce in development would block the dev server's own bootstrap rather than
 * harden anything. `security-headers.ts` keeps the `'unsafe-inline'` branch for
 * that case and this module simply yields `undefined` there.
 *
 * This file is imported by `getRouter()`, which ships in the client bundle.
 * `node:async_hooks` cannot live here: Vite externalises it for the browser and
 * a top-level `new AsyncLocalStorage()` throws, which used to kill the whole
 * client graph — the service-worker `useEffect` never ran, and
 * `navigator.serviceWorker.ready` hung until the Playwright timeout. The Worker
 * installs the real store from `security-nonce-als.ts` (imported only from the
 * server handler). The default below is a nested-call stack for Vitest; it is
 * not safe across concurrent Worker requests, which is why the handler replaces
 * it before serving.
 */
export type NonceStore = {
  run: <T>(nonce: string, fn: () => T) => T;
  getStore: () => string | undefined;
};

let currentNonce: string | undefined;

let nonceStorage: NonceStore = {
  run: (nonce, fn) => {
    const previous = currentNonce;
    currentNonce = nonce;
    try {
      return fn();
    } finally {
      currentNonce = previous;
    }
  },
  getStore: () => currentNonce,
};

/** Replaces the process-wide store. Called once from the server handler. */
export function installNonceStore(store: NonceStore): void {
  nonceStorage = store;
}

/*
 * 128 bits from the runtime CSPRNG, base64-encoded.
 *
 * CSP requires a nonce to be unguessable per response; 16 bytes is the width the
 * spec's own guidance names. `crypto.getRandomValues` is the Workers CSPRNG —
 * `Math.random()` would be a predictable nonce, which is the same as no nonce.
 */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * Runs `fn` with `nonce` readable by `getRequestNonce()` for the whole
 * asynchronous extent of the call. A `undefined` nonce runs `fn` unwrapped, so
 * the development path pays nothing.
 */
export function runWithNonce<T>(nonce: string | undefined, fn: () => T): T {
  return nonce === undefined ? fn() : nonceStorage.run(nonce, fn);
}

/**
 * The nonce for the request currently being served, or `undefined` outside one —
 * which is every development request, and the build.
 */
export function getRequestNonce(): string | undefined {
  return nonceStorage.getStore();
}
