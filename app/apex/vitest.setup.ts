/*
 * The `/vitest` subpath, not the package root. Its type augmentation targets
 * Vitest's own `Assertion<T>` shape; the root export augments a generic
 * `expect` interface that stopped matching Vitest 5's `Assertion<T, R>` and
 * left every jest-dom matcher (`toHaveAttribute`, `toHaveFocus`, …)
 * type-invisible on `expect(element)` while still working at runtime. Same
 * matcher set either way — this changes only which declaration file picks it
 * up.
 */
import '@testing-library/jest-dom/vitest';
