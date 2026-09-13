/**
 * The first focusable element in the document, so a keyboard or switch user can
 * reach `<main>` without tabbing through the header
 * (docs/design/ui-shell-contract.md §12).
 *
 * Hidden by translating itself off the top edge rather than by `sr-only`, so it
 * stays in the accessibility tree and focusable, and the focused utility wins on
 * specificity rather than on emission order. No `transition`: an instant
 * position change is not motion.
 *
 * `href` points at the `id` every `<main>` on this unit carries, and each of them
 * also carries `tabIndex={-1}` so the browser moves focus rather than only
 * scrolling.
 */
export function SkipLink({ label }: Readonly<{ label: string }>) {
  return (
    <a
      className="absolute top-0 left-4 z-50 inline-flex min-h-11 -translate-y-full items-center rounded-b-lg border border-t-0 border-gray-200 bg-white px-4 text-brand focus:translate-y-0"
      href="#main-content"
    >
      {label}
    </a>
  );
}
