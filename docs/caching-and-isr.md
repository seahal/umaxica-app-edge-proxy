# 公開系 surface のキャッシュ方針

> **2026-09-02 更新.** `adr/015-public-content-surfaces-astro.md` が公開系 12
> surface を Astro へ移行し、キャッシュ方針の所有者を確定させた:
> **Phase 1 はキャッシュなし(毎リクエスト Rails)**、correctness 確認後に
> **Phase 2 で Cloudflare Workers Cache**(Astro の cache abstraction 経由、
> short TTL + natural expiry、purge を correctness の必須条件にしない)。
> 下記の TTL 目安(info/news 300s、help/docs 1800s)は Phase 2 の初期値として
> 引き継ぐ。以下は移行前の記録。

## 現状(2026-08-23 更新)

**この文書が記録していた ISR 方針は、実装機構ごと失効した。**

元の決定(2026-07-16)は、公開系 surface(`{app,com,org}/{docs,news,help,info}`
の 12 アプリ)を「完全 SSG ではなくキャッシュされた動的レンダリング(ISR 相当)」
とし、そのキャッシュ契約を当時のフレームワーク固有のキャッシュ API で表現する、
というものだった。`adr/013-frames-tanstack-start.md` のスタック変更でその API は
repository から消え、置き換えも入っていない。したがって ISR 相当のキャッシュは
現在どこにも存在しない。

代わりに何がそこにあるかを、目標ではなく事実として書く。

- **HTML は毎リクエスト SSR される。** prerender は無効で、`vite.config.ts` に
  その理由が書いてある — Cloudflare は Worker より先に静的アセットを照合するので、
  prerender した HTML は `src/server.ts` のセキュリティヘッダとレートリミッタの
  手前に置かれてしまう。
- **静的アセットだけがキャッシュされる。** Vite が `dist/client/assets/` へ
  content hash 付きで出力し、`public/_headers` が `/assets/*` を
  `public, max-age=31536000, immutable` にする。fingerprint されたファイル名で
  なければ Cloudflare は `max-age=0, must-revalidate` を返すので、この 2 つは
  セットで意味を持つ。
- **HTML には Cache-Control が付いていない。** 付いているのは `no-store` 系だけ
  で、`/health`、`/revision`、429 応答の 3 つ。つまり公開ページの再検証ポリシーは
  現在「未決定」であって「毎回オリジン」ではない。

## 未解決事項

12 の公開系 surface は `/{lang}/entries/` を毎リクエスト Rails SSR する。この
フェーズでは application cache / Workers Cache / ISR は入れない。Phase 2 の
キャッシュ層は correctness 確認後の別作業。選択肢は Next の
ISR ではなくなったので、決め直しであって移植ではない:

- **HTTP キャッシュ**(`Cache-Control: s-maxage` + Cloudflare の edge cache、
  `Cache-Tag` による purge)。フレームワーク非依存で、今の構成に最も素直に載る。
- **Cache API / KV / R2** を Worker 内で明示的に使う。Rails 応答の粒度で持つなら
  こちら。
- 何もしない(毎リクエスト Rails)。TTL が短くてよい surface ならこれで足りる。

元の TTL 目安は判断材料として残す — info / news は 300 秒、help / docs は
1800 秒。将来的に publication 起点の on-demand purge へ移行し、この TTL は
「更新通知が失敗した場合の上限」として扱う、という位置づけも変わらない。

## Rails binding の方針

ここは移行の影響を受けていない。

- binding 名は `UMAXICA_APPS_EDGE_CF_WORKERS_VPC` を維持する。
- binding は capability であり、Rails を fetch しない worker には付与しない。
  5 つの apex Worker は `standalone` のままで、binding を持たない。
- 15 フレームは既に全て `railsBackedVite` で、binding を持っている。公開系 12
  surface でそれを使っているのは今のところ `/health` の Rails Health API
  (`src/lib/rails-health.ts`、ADR 016)だけで、コンテンツ取得はまだ入っていない。
  入れるときは既存の `src/lib/rails-client.ts` の中に足す — 分類の移動は不要で、
  `contentSurface` は空のまま(Rails を見ない frame が存在しないため)。
- 分類と wrangler 設定の整合は `pnpm run check:workers`(CI の `check-workers`
  ジョブ)が検査する。
- 将来課題: 現在 development/production が同一 VPC `service_id` + `remote: true`
  のため、ローカル開発から本番 Rails に到達できる。環境別に VPC Service を分離し、
  Wrangler environment ごとに `service_id` を分けることを検討する。
