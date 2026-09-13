import type { ErrorComponentProps } from '@tanstack/react-router';

import { BRAND_TITLE } from '@/lib/title';

/*
 * The two failure documents, in one module because the router and the root route
 * both have to name them.
 *
 * `src/routes/__root.tsx` sets them as the root route's own `notFoundComponent`
 * and `errorComponent`; `src/router.tsx` sets the same two as
 * `defaultNotFoundComponent` and `defaultErrorComponent`. Both are needed and
 * they are not redundant: the root's pair covers a failure in the root itself,
 * the router's defaults cover every descendant route that declares none.
 *
 * They render OUTSIDE `src/routes/_page.tsx`, the pathless layout that carries
 * the application chrome, so they stay chrome-free — that is what
 * `docs/design/ui-shell-contract.md` §15 asks of a failure document, and where
 * this archetype differs from the twelve satellites.
 *
 * Each renders its own `<title>`, which React hoists into `<head>`. That is why
 * `__root.tsx` deliberately emits no title: two sources would produce two
 * `<title>` elements and `api/title-contract.hurl` asserts there is exactly one.
 */

/** HTTP 404. The status comes from the router's not-found signal, not from here. */
export function NotFoundDocument() {
  return (
    <>
      <title>{`ページが見つかりません — ${BRAND_TITLE}`}</title>
      <main className="grid min-h-screen place-content-center gap-3 p-6 text-center">
        <h1 className="text-2xl leading-heading font-semibold">ページが見つかりません</h1>
        <p>HTTP 404</p>
        {/*
         * No reload control: a 404 is not a transient failure, and
         * `api/status-surfaces.hurl` asserts this document does not contain
         * 再読み込み.
         */}
        <a
          className="inline-flex min-h-11 items-center justify-self-center rounded-full border border-gray-300 bg-white px-4 py-2 hover:bg-gray-100"
          href="/"
        >
          トップへ戻る
        </a>
      </main>
    </>
  );
}

/**
 * HTTP 500.
 *
 * The reset control stays a plain `<button>`. It hand-maintains no keyboard,
 * focus or ARIA behaviour for React Aria to take over — the element already
 * carries all of it — and the shell contract reserves the library for the
 * interactive primitives that would otherwise be built by hand.
 */
export function ErrorDocument({ reset }: Readonly<ErrorComponentProps>) {
  return (
    <>
      <title>{`現在、このページを表示できません — ${BRAND_TITLE}`}</title>
      <main className="grid min-h-screen place-content-center gap-3 p-6 text-center">
        <h1 className="text-2xl leading-heading font-semibold">現在、このページを表示できません</h1>
        <p>HTTP 500</p>
        <button
          type="button"
          className="inline-flex min-h-11 cursor-pointer items-center justify-self-center rounded-full border border-gray-300 bg-white px-4 py-2 hover:bg-gray-100"
          onClick={() => reset()}
        >
          再読み込み
        </button>
        <p>
          <a className="text-brand" href="/">
            トップへ戻る
          </a>
        </p>
      </main>
    </>
  );
}
