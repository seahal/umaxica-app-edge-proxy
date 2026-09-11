/*
 * The `/vitest` subpath, not the package root. Its type augmentation targets
 * Vitest's own `Assertion<T>` shape, so every jest-dom matcher is type-visible
 * on `expect(element)`.
 */
import '@testing-library/jest-dom/vitest';
