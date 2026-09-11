/*
 * `@tanstack/react-start/server-only` is a side-effect marker: importing it in a
 * module the client bundle reaches makes the BUILD fail. There is nothing to
 * execute, which is why this file is empty apart from this comment — it exists
 * so Vitest, which is neither bundle, can resolve the specifier.
 */
export {};
