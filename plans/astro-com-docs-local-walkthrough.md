# Local walkthrough: `com/docs` (2026-09-02)

Host: `http://127.0.0.1:5106/`. Server: `pnpm --dir com/docs run dev` from 12:33:19.
Evidence: Astro/Vite request log, burst **12:33:22–12:35:23**.

| Listed URL              | Seen               | Status               | Notes                                       |
| ----------------------- | ------------------ | -------------------- | ------------------------------------------- |
| `/`                     | 12:33:26, 12:34:11 | **302** → `/ja/` 200 |                                             |
| `/ja/`                  | 12:33:26, 12:34:02 | **200**              |                                             |
| `/en/`                  | 12:34:16           | **200** as `/en`     |                                             |
| `/ja/about/`            | 12:34:07           | **200**              |                                             |
| `/en/about/`            | **not seen**       | —                    |                                             |
| `/offline`              | 12:33:22, 12:34:31 | **404**              | Same astro-dev defect as app/docs; accepted |
| `/__not-a-page`         | 12:34:39           | **404**              |                                             |
| `/500`                  | **not seen**       | —                    |                                             |
| `/health`               | 12:35:23           | **503**              |                                             |
| `/revision`             | 12:35:15           | **200**              |                                             |
| `/robots.txt`           | 12:35:08           | **200**              |                                             |
| `/sitemap.xml`          | 12:35:01           | **200**              |                                             |
| `/manifest.webmanifest` | many               | **200**              | Auto-fetched                                |
| `/service-worker.js`    | **not seen**       | —                    |                                             |

Extra: `/ds` 404 at 12:34:19 (typo).

HTML locale/about-ja/404/health/revision/robots/sitemap were walked. Missing from this burst: **English about** and **`/500`**.
