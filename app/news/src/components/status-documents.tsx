import type { ErrorComponentProps } from '@tanstack/react-router';

import { BRAND_TITLE } from '../lib/title';

/*
 * The two failure documents, in one module because the router and the root route
 * both have to name them.
 *
 * They render inside the root shell, so they carry the header and the footer —
 * the satellite archetype (docs/design/ui-shell-contract.md §15). They are
 * locale-less: an unmatched path, including an unsupported locale such as
 * `/fr/`, has no language to render in, so they speak the default locale and
 * link home to `/ja/`.
 *
 * Each renders its own `<title>`, which React hoists into `<head>`. That is why
 * `__root.tsx` emits no title, and why a Publishing route's `head()` emits none
 * when its loader produced no data: two sources would produce two `<title>`
 * elements, and `api/title-contract.hurl` asserts there is exactly one.
 */

/** HTTP 404. The status comes from the router's not-found signal, not from here. */
export function NotFoundDocument() {
  return (
    <>
      <title>{`ページが見つかりません — ${BRAND_TITLE}`}</title>
      <meta name="robots" content="noindex, nofollow" />
      <main
        className="grid flex-1 place-content-center gap-3 p-6 text-center"
        id="main-content"
        tabIndex={-1}
      >
        <h1 className="text-2xl leading-heading font-semibold">ページが見つかりません</h1>
        <p>HTTP 404</p>
        {/*
         * No reload control: a 404 is not a transient failure, and
         * `api/status-surfaces.hurl` asserts this document does not contain
         * 再読み込み.
         */}
        <a
          className="inline-flex min-h-11 items-center justify-self-center rounded-full border border-gray-300 bg-white px-4 py-2 hover:bg-gray-100"
          href="/ja/"
        >
          トップへ戻る
        </a>
      </main>
    </>
  );
}

/**
 * HTTP 500 — a route that threw. A failed Rails read does not come here; it
 * renders `PublishingUnavailable` with the status the failure mapped to.
 */
export function ErrorDocument({ reset }: Readonly<ErrorComponentProps>) {
  return (
    <>
      <title>{`現在、このページを表示できません — ${BRAND_TITLE}`}</title>
      <meta name="robots" content="noindex, nofollow" />
      <main
        className="grid flex-1 place-content-center gap-3 p-6 text-center"
        id="main-content"
        tabIndex={-1}
      >
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
          <a className="text-brand" href="/ja/">
            トップへ戻る
          </a>
        </p>
      </main>
    </>
  );
}
