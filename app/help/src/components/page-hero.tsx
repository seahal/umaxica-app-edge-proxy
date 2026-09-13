/**
 * The content block a home or about page opens with: the page's single `<h1>`,
 * the site it belongs to, its body copy, and optional calls to action.
 *
 * It sits on the shell's width carrier (`mx-auto w-full max-w-7xl px-4
 * wide:px-8`), so the `<h1>` starts on the same left edge as the brand above it
 * and the copyright below it (docs/design/ui-shell-contract.md §9).
 *
 * Paragraphs arrive as strings rather than as `children`, so a caller cannot put
 * a heading, a second `<main>` or an interactive control inside the hero without
 * saying so. `id="main-content"` with `tabIndex={-1}` is the skip link's target.
 */
const NO_ACTIONS: readonly { href: string; label: string }[] = [];

export function PageHero({
  siteName,
  title,
  paragraphs,
  actions = NO_ACTIONS,
}: Readonly<{
  siteName: string;
  title: string;
  paragraphs: readonly string[];
  actions?: readonly { href: string; label: string }[];
}>) {
  return (
    <main className="flex-1 py-12" id="main-content" tabIndex={-1}>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 wide:px-8">
        <div className="flex flex-col gap-3">
          <h1 className="max-w-prose text-4xl leading-heading font-bold tracking-tight wide:text-5xl">
            {title}
          </h1>
          <p className="text-sm text-gray-600">{siteName}</p>
        </div>
        <div className="flex flex-col gap-4">
          {paragraphs.map((paragraph) => (
            <p className="max-w-prose text-lg" key={paragraph}>
              {paragraph}
            </p>
          ))}
          {actions.length > 0 && (
            <ul className="flex flex-wrap gap-x-6">
              {actions.map((action) => (
                <li key={action.href}>
                  <a
                    className="inline-flex min-h-11 items-center text-lg underline"
                    href={action.href}
                  >
                    {action.label}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}
