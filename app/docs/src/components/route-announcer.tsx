import { useRouterState } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

/*
 * The shape this reads out of a route match. Spelled with an explicit
 * `| undefined` because `exactOptionalPropertyTypes` is on: a `meta` entry is a
 * whole set of `<meta>` attributes, of which this needs exactly one.
 */
type HeadMeta = { readonly title?: string | undefined } | undefined;

/**
 * The title the matched routes resolve to — the SIGNAL that a navigation
 * finished, not the string that gets announced.
 *
 * Deepest match first, and last entry first within each match's `meta`, which is
 * the precedence `<HeadContent />` itself applies. Routes that declare no title
 * contribute nothing, so the empty string means "no route in this match set
 * named a title" rather than "the document has no title".
 */
function routeTitle(matches: readonly { readonly meta?: readonly HeadMeta[] | undefined }[]) {
  for (let match = matches.length - 1; match >= 0; match -= 1) {
    const meta = matches[match]?.meta ?? [];
    for (let entry = meta.length - 1; entry >= 0; entry -= 1) {
      const title = meta[entry]?.title;
      if (title) {
        return title;
      }
    }
  }
  return '';
}

/**
 * Announces a client-side navigation to a screen reader.
 *
 * This exists because every frame is a single-page application. A full page load
 * ends with the browser handing a new document to the assistive technology,
 * which announces its title; a `<Link>` navigation does none of that. The
 * `<title>`, the `<h1>` and the whole of `<main>` are replaced in place, focus
 * stays on the link the reader just activated, and nothing is spoken — so the
 * reader learns the page changed only if they think to go and check. That is the
 * one behaviour the shell lost by becoming an SPA, and this gives it back
 * (docs/design/ui-shell-contract.md §12).
 *
 * It announces the document's own `<title>`, brand suffix included, rather than
 * the `<h1>` or a string composed here: that is exactly what a full page load
 * would have announced, and anything else would make the SPA path say something
 * the document path does not.
 *
 * **What triggers the announcement and what gets announced are deliberately two
 * different values.** Both halves were measured rather than assumed:
 *
 * - The trigger is the title the ROUTER resolved. Keying on the pathname instead
 *   announces the previous page — the `<title>` that `<HeadContent />` renders
 *   lands in a later commit than the location does, so when the path changes the
 *   DOM still holds the old title. The router's title moves in the same commit
 *   as `<HeadContent />`'s, so by the time this effect runs the document is
 *   settled.
 * - The announced string is `document.title`, because the router's title is not
 *   always the document's. When a loader throws mid-navigation the router keeps
 *   the match's own `head()` title while the error document renders a different
 *   `<title>` of its own through React — the reader sees "現在、このページを表示
 *   できません" and would have been told they had arrived on the page that
 *   actually failed to load. `document.title` is what the browser and the
 *   assistive technology see, so it is what gets read out.
 *
 * **The region is rendered from the first paint, empty.** A live region has to be
 * in the accessibility tree BEFORE its content changes — one inserted into the
 * document together with its text is not reliably announced, because the
 * assistive technology never observed it as a region. That is why this sits in
 * the root shell holding an empty string rather than being rendered only once
 * there is something to say.
 *
 * The first render is deliberately silent: the browser has already announced the
 * document it just loaded, and saying it again would report a navigation that did
 * not happen. `useRef` seeded with the initial title is what makes that so — the
 * mount effect compares equal and says nothing. It also keeps a re-run of the
 * effect on an unchanged title silent, which is the same guarantee under React's
 * double-invoked effects.
 *
 * `sr-only` is correct here, unlike on the skip link. The objection recorded in
 * `skip-link.tsx` is that `sr-only` has to be undone by `not-sr-only` in a
 * `focus:` variant, two utilities fighting over one property. This region is
 * never focusable and never becomes visible, so it has no second state and
 * nothing to undo.
 */
export function RouteAnnouncer() {
  const title = useRouterState({ select: (state) => routeTitle(state.matches) });
  const [announcement, setAnnouncement] = useState('');
  const announced = useRef(title);

  useEffect(() => {
    if (announced.current === title) {
      return;
    }
    announced.current = title;
    setAnnouncement(document.title);
  }, [title]);

  /*
   * `<output>` rather than a `<p role="status">`: its implicit role IS `status`,
   * and the contract's rule is that ARIA never substitutes for a semantic
   * element. The two attributes beside it are that role's implicit live
   * properties written out, so the region does not depend on an assistive
   * technology mapping an element to them. `aria-atomic` is the load-bearing one
   * — the title has to be read out whole rather than as the diff against the
   * previous page's.
   */
  return (
    <output className="sr-only" aria-live="polite" aria-atomic="true">
      {announcement}
    </output>
  );
}
