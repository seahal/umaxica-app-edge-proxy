/*
 * The `/vitest` subpath, not the package root. Its type augmentation targets
 * Vitest's own `Assertion<T>` shape; the root export augments a generic
 * `expect` interface that stopped matching Vitest 5's `Assertion<T, R>` and
 * left every jest-dom matcher (`toHaveAttribute`, `toHaveFocus`, …)
 * type-invisible on `expect(element)` while still working at runtime. Same
 * matcher set either way — this changes only which declaration file picks it
 * up.
 */
import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

/*
 * `createServerFn` is an RPC bridge in the Vite/Start build. Vitest has no
 * Start server, so the handler must run in-process. Other exports stay real.
 */
vi.mock('@tanstack/react-start', async (importOriginal) => {
  const actual: unknown = await importOriginal();
  if (typeof actual !== 'object' || actual === null) {
    throw new Error('expected @tanstack/react-start to export an object');
  }
  return {
    ...actual,
    createServerFn: () => ({
      handler: (fn: () => unknown) => fn,
    }),
  };
});
