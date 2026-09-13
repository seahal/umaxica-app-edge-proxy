# Astro content surfaces reached through the Edge development Tunnel

## What was being verified

That the twelve Astro public content surfaces (`{app,com,org}/{info,docs,news,help}`) are
reachable from the public internet through Cloudflare Access and the Edge-owned development
Tunnel, and that the origin that answers is the local `astro dev` process in this Compose
project — not a deployed Worker.

## Why

Public Hostnames for those twelve FQDNs were moved onto this repository's tunnel
`DEV-MP4-EDGE` (`dd5500e6-97fe-434e-a389-6399aa866843`) on 2026-09-04, with origins
`http://core:<port>` on the Edge compose default network. Unauthenticated probes only
prove Access. A page request that lands in the local Vite access log is the origin-side
proof.

## Context

- Repository: `umaxica-apps-edge`
- Revision at time of check: `4f096943` (feature)
- Date: 2026-09-04
- Connector: Compose service `cloudflare-tunnel`, image `cloudflare/cloudflared:2026.8.2`,
  `GET http://cloudflare-tunnel:2000/ready` → `200`, `readyConnections: 4`,
  `connectorId` `98a16460-9254-4298-aee8-5db650791422`
- Tunnel ingress (dashboard / API version 35): each Astro hostname maps to `http://core:<port>`
  as in the table below. Catch-all is `http_status:404`.
- Access: whole host, no `/health*` Bypass. Unauthenticated `GET /` is 302 to
  `umaxica.cloudflareaccess.com`.
- `{app,com,org}/info` `allowedHosts` is the single global hostname `info.umaxica.{brand}`
  (no `info-jp` / `info-us`). docs/news/help keep `<frame>-jp` / `<frame>-us`.

## Result

**PASS for the twelve Astro surfaces.** After an operator browser session authenticated
through Access, each local `astro dev` log recorded `GET /` **302** then `GET /ja/` **200**.
That is the language negotiation those units implement, and it cannot be produced by
Access itself (Access never contacts the connector on an unauthenticated request).

Unauthenticated DNS-over-HTTPS plus `curl` against all twelve hostnames returned **302**
to the team domain with `cf-ray` present, so DNS and Access were in front independently
of the origin logs.

This record does not claim `{app,com,org}/core` or the five apexes. Core had no page
lines in the same window. Apex Hono structured logs are a separate surface.

## Origin mapping observed in the tunnel config

| Surface    | Public hostname       | Origin             |
| ---------- | --------------------- | ------------------ |
| `app/info` | `info.umaxica.app`    | `http://core:5403` |
| `com/info` | `info.umaxica.com`    | `http://core:5103` |
| `org/info` | `info.umaxica.org`    | `http://core:5303` |
| `app/docs` | `docs-jp.umaxica.app` | `http://core:5406` |
| `com/docs` | `docs-jp.umaxica.com` | `http://core:5106` |
| `org/docs` | `docs-jp.umaxica.org` | `http://core:5306` |
| `app/news` | `news-jp.umaxica.app` | `http://core:5407` |
| `com/news` | `news-jp.umaxica.com` | `http://core:5107` |
| `org/news` | `news-jp.umaxica.org` | `http://core:5307` |
| `app/help` | `help-jp.umaxica.app` | `http://core:5408` |
| `com/help` | `help-jp.umaxica.com` | `http://core:5108` |
| `org/help` | `help-jp.umaxica.org` | `http://core:5308` |

## Commands and observations

| Check                                                                             | Observed                                                                       |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `curl -sS http://cloudflare-tunnel:2000/ready`                                    | `200`, four ready connections                                                  |
| DoH `type=A` on each of the twelve FQDNs (`https://cloudflare-dns.com/dns-query`) | A records present (Cloudflare anycast)                                         |
| Unauthenticated `curl -H 'accept: text/html' https://<host>/`                     | `302` `Location` on `umaxica.cloudflareaccess.com` (query string not retained) |
| Local `pnpm --dir <unit> run dev` then operator-authenticated browser `GET /`     | Vite log: `[302] /` then `[200] /ja/` on all twelve units                      |
| Same window, `{app,com,org}/core` Vite logs                                       | no page lines                                                                  |

Excerpt (representative; all twelve matched this shape). Times are local container clock on 2026-09-04:

```text
app/docs  11:11:28 [302] / 8ms
app/docs  11:11:28 [200] /ja/ 3ms
com/info  11:11:21 [302] / 8ms
com/info  11:11:22 [200] /ja/ 18ms
org/help  11:11:35 [302] / 8ms
org/help  11:11:35 [200] /ja/ 17ms
```

Several units also logged `GET /offline` **200** on the same pass (service-worker / offline
document). That is application behaviour after the HTML landed, not a second ingress path.

## Not verified

- Brand mix-up on docs/news/help by ablation (stopping one brand and watching 502). Identity
  of those nine rests on the ingress table plus the frame marker in the HTML, not on a
  `/health.json` `service` field.
- Rails / Workers VPC on these requests. `astro dev` in this run used `CLOUDFLARE_ENV=local`
  with `remoteBindings` off.
- Persistence across a Dev Container recreate. Public Hostnames live in Cloudflare; `pnpm
run dev` does not.
- The authenticated Access JWT. Login URLs were not stored.
