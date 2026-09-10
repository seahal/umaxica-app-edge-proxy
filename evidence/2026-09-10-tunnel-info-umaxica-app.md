# Cloudflare Tunnel: `info.umaxica.app` origin is up

## Result

**Origin PASS. External hostname reaches Cloudflare Access (expected).**

`app/info` is serving on `:5403` inside `core`. The Edge tunnel connector is
ready (`readyConnections: 4`). Unauthenticated HTTPS to `https://info.umaxica.app/`
returns Access `302` to `umaxica.cloudflareaccess.com` with `hostname` in the
JWT meta equal to `info.umaxica.app`. After Access login, the browser hits this
dev server.

## Local origin (`Host: info.umaxica.app`)

| URL                            | Status | Body                                    |
| ------------------------------ | ------ | --------------------------------------- |
| `http://127.0.0.1:5403/`       | 302    | `Location: http://info.umaxica.app/ja/` |
| `http://127.0.0.1:5403/health` | 200    | `status/startup/liveness/readiness: ok` |
| `http://127.0.0.1:5403/ja/`    | 200    | HTML                                    |

## Public

| URL                               | Status     | Meaning                                                    |
| --------------------------------- | ---------- | ---------------------------------------------------------- |
| `https://info.umaxica.app/`       | 302 Access | Tunnel hostname is published; Access is in front (ADR 008) |
| `https://info.umaxica.app/health` | 302 Access | same; `/health*` has no Bypass                             |

Connector: `cloudflare-tunnel` `10.89.4.2`, cloudflared 2026.8.2,
`GET http://cloudflare-tunnel:2000/ready` → `status:200`, 4 connections.

## Dev servers

Container `pids.max=2048`. Twenty concurrent Vite/Astro processes do not fit
(each unit is ~200 threads). Simultaneous start hit `EAGAIN`. Sequential start
got **9/20** before the cap:

UP: `app/apex` 5401, `app/info` 5403, `app/docs` 5406, `com/info` 5103,
`com/core` 5105, `net/apex` 5201, `org/info` 5303, `org/core` 5305,
`org/docs` 5306.

DOWN (cap): remaining 11 units. Raising `pids.max` from inside the container
fails (`Read-only file system`).

## Commands

- `pnpm --dir <unit> run dev` for all 20 (first wave parallel, then sequential)
- `curl -H 'Host: info.umaxica.app' http://127.0.0.1:5403/health`
- `curl -I https://info.umaxica.app/`
