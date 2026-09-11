import { createFileRoute } from '@tanstack/react-router';

import { brandTitle } from '../lib/title';

/*
 * The document the service worker caches at install and serves for a
 * navigation that cannot reach the network. It must stay an ordinary route so
 * the service worker has something to cache.
 *
 * Locale-less, like the failure documents: it is fetched once, before anyone
 * knows which language the failed navigation was in, so it speaks the default
 * locale.
 */
export const Route = createFileRoute('/offline')({
  head: () => ({
    meta: [{ title: brandTitle('オフライン') }, { name: 'robots', content: 'noindex, nofollow' }],
  }),
  component: OfflinePage,
});

function OfflinePage() {
  return (
    <main
      className="grid flex-1 place-content-center gap-3 p-6 text-center"
      id="main-content"
      tabIndex={-1}
    >
      <h1 className="text-2xl leading-heading font-semibold">オフラインです</h1>
      <p>ネットワーク接続を確認して再読み込みしてください。</p>
      <a
        className="inline-flex min-h-11 items-center justify-self-center rounded-full border border-gray-300 bg-white px-4 py-2 hover:bg-gray-100"
        href="/ja/"
      >
        トップへ戻る
      </a>
    </main>
  );
}
