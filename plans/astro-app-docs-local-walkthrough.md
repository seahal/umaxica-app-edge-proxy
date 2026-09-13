# Local walkthrough: `app/docs` (2026-09-02)

Host: `http://127.0.0.1:5406/` (Podman publish). Server: `pnpm --dir app/docs run dev`.
Evidence: Astro/Vite request log on that process (session started 11:31:32).

The checklist pass is the burst at **12:26:42–12:29:59**. Earlier hits (11:31–12:19) are the same session’s exploratory browsing.

## Checklist vs log

| Listed URL              | Seen in log          | Status                 | Notes                                                                                                                  |
| ----------------------- | -------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `/`                     | 12:26:42             | **302**                | Followed by `/ja/` 200                                                                                                 |
| `/ja/`                  | 12:26:42             | **200**                |                                                                                                                        |
| `/en/`                  | 12:26:46             | **200** as `/en`       | Trailing slash omitted; Astro still served English                                                                     |
| `/ja/about/`            | 12:26:50             | **200** as `/ja/about` | Same                                                                                                                   |
| `/en/about/`            | 12:26:53             | **200** as `/en/about` | Same                                                                                                                   |
| `/offline`              | 12:27:00             | **404**                | Listed as a splash; **dev still 404s this route** (also `/offline/` as SW precache noise on other navigations)         |
| `/__not-a-page`         | **not seen**         | —                      | 404 document was hit as `/404` at 12:18:49 / 12:18:55 instead (also unmatched → 404 HTML)                              |
| `/500`                  | 12:27:07             | **500**                | Error document path, not a content URL. Earlier 12:08–12:18 also 500 (including a `title` throw before the splash fix) |
| `/health`               | 12:28:07             | **503**                | Rails not configured locally (ADR 009)                                                                                 |
| `/revision`             | 12:28:11, 12:29:59   | **200**                |                                                                                                                        |
| `/robots.txt`           | 12:28:19             | **200**                | `/robots` (no `.txt`) 404 at 12:28:23 — not a listed URL                                                               |
| `/sitemap.xml`          | 12:28:29             | **200**                | `/sitemap` (no `.xml`) 404 at 12:28:31                                                                                 |
| `/manifest.webmanifest` | many, incl. 12:28:52 | **200**                | Auto-fetched from HTML, not only a direct tab                                                                          |
| `/service-worker.js`    | **not seen**         | —                      | No document GET in this log (browser cache or not opened as a tab)                                                     |

## Verdict

HTML/locale/about/health/revision/robots/sitemap/manifest were walked. The 404 _document_ was walked via `/404`, not `__not-a-page`. **`/offline` was requested and 404’d** — that is a remaining defect on `astro dev`, not a missed click. `/service-worker.js` has no log line.

Do not treat this as production sign-off. Next unit when asked: `app/help` `:5408`.
