# Local walkthrough: `org/docs` (2026-09-02)

Host: `http://127.0.0.1:5306/`. Server: `pnpm --dir org/docs run dev` from 12:36:12.
Evidence: Astro/Vite request log **12:37:14–12:38:55**.

| Listed URL              | Seen         | Status                        |
| ----------------------- | ------------ | ----------------------------- |
| `/`                     | 12:37:14     | **302** → `/ja/` 200          |
| `/ja/`                  | 12:37:14     | **200**                       |
| `/en/`                  | 12:37:16     | **200** as `/en`              |
| `/ja/about/`            | 12:37:23     | **200** as `/ja/about`        |
| `/en/about/`            | 12:37:19     | **200** as `/en/about`        |
| `/offline`              | 12:38:04     | **404** (astro-dev; accepted) |
| `/__not-a-page`         | 12:38:55     | **404**                       |
| `/500`                  | 12:38:36     | **500**                       |
| `/health`               | 12:38:45     | **503**                       |
| `/revision`             | 12:38:40     | **200**                       |
| `/robots.txt`           | 12:37:29     | **200**                       |
| `/sitemap.xml`          | 12:37:36     | **200**                       |
| `/manifest.webmanifest` | many         | **200**                       |
| `/service-worker.js`    | **not seen** | —                             |

HTML + 404 + 500 + health + revision + robots + sitemap walked. Only **`/service-worker.js` as a tab** has no log line (often cached, not opened).
