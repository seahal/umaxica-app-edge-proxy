import { AsyncLocalStorage } from 'node:async_hooks';

import { installNonceStore } from './security-nonce';

/*
 * The real per-request nonce store. Imported only from the server handler so
 * `node:async_hooks` never enters the client graph (see `security-nonce.ts`).
 */
const storage = new AsyncLocalStorage<string>();

installNonceStore({
  run: (nonce, fn) => storage.run(nonce, fn),
  getStore: () => storage.getStore(),
});
