# Local HTML walkthrough (Astro content surfaces)

Human clicks + Playwright Chromium (`e2e/smoke.spec.ts`) cover **HTML documents only**.

Machine contracts (status, Content-Type, JSON keys) stay in `api/*.hurl`.
Service-worker / offline-fallback engine tests stay in `e2e/standard-contract.spec.ts` and are optional for a walkthrough.

`/offline` is listed for humans; `astro dev` currently 404s it — accepted. Do not put it in smoke until that is fixed.

## HTML (click these)

| What                 | Path            |
| -------------------- | --------------- |
| Language negotiation | `/`             |
| Home ja              | `/ja/`          |
| Home en              | `/en/`          |
| About ja             | `/ja/about/`    |
| About en             | `/en/about/`    |
| Offline splash       | `/offline`      |
| 404                  | `/__not-a-page` |
| 500 splash           | `/500`          |

Host: `http://127.0.0.1:<port>/` (compose publish). Ports: app/docs 5406, app/help 5408, app/info 5403, app/news 5407, com/docs 5106, com/help 5108, com/info 5103, com/news 5107, org/docs 5306, org/help 5308, org/info 5303, org/news 5307.

## API (do not click; Hurl)

`/health`, `/revision`, `/robots.txt`, `/sitemap.xml`, `/manifest.webmanifest`, `/favicon.ico`, `/service-worker.js`.
