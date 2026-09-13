# Edge deployment revision

Two representations of **the same Cloudflare Workers version metadata**.

```text
GET /revision
  text/plain
  CF_VERSION_METADATA.id (or REVISION.id) only

GET /api/v0/revision.json
  application/json
  { id, tag, timestamp }
```

Neither is health. `/health` and `/api/v0/health.json` remain separate contracts.

## Authority

Cloudflare Workers `version_metadata` (`id`, `tag`, `timestamp`). Apex binds it
as `CF_VERSION_METADATA`. Frames bind it as `REVISION`. The HTTP contract does
not depend on the binding name.

Do not derive revision from Git SHA, package version, build time, Rails, or
Workers VPC.

The two URLs must not HTTP-fetch each other.

## `/revision`

```text
HTTP 200
Content-Type: text/plain; charset=utf-8
Cache-Control: no-store
X-Robots-Tag: noindex, nofollow
```

Body is the version id plus a trailing newline, for example:

```text
a33a8248-b055-41a7-a91f-d65d116b474c
```

When version metadata is missing (typical `vite dev` / `astro dev` without a
Worker version), the body is the non-JSON sentinel:

```text
unknown
```

`null` is not used as the text body because it is valid JSON.

`Accept` is ignored. The URL fixes the representation. No redirect, no language
cookie, no HTML.

Playwright owns this representation: `<unit>/e2e/revision.spec.ts`.

## `/api/v0/revision.json`

```text
HTTP 200
Content-Type: application/json
Cache-Control: no-store
X-Robots-Tag: noindex, nofollow
```

```json
{
  "id": "a33a8248-b055-41a7-a91f-d65d116b474c",
  "tag": null,
  "timestamp": "2026-09-04T12:00:00.000Z"
}
```

Exactly three keys. Local development without the binding returns:

```json
{ "id": null, "tag": null, "timestamp": null }
```

`Accept` is ignored; incompatible `Accept` values still receive JSON (same
policy as `/api/v0/health.json`). No 406.

Hurl owns this representation: `<unit>/api/revision-api.hurl`.

## Units

| Runtime        | Units                                 | Mechanism                                                                             |
| -------------- | ------------------------------------- | ------------------------------------------------------------------------------------- |
| Hono           | `{app,com,org,net,dev}/apex`          | `create-apex-app.ts`                                                                  |
| TanStack Start | `{app,com,org}/core`                  | `src/routes/revision.ts` and `src/routes/api.v0.revision[.]json.ts`                   |
| Astro          | `{app,com,org}/{docs,help,info,news}` | `src/pages/revision.ts` and `src/pages/api/v0/revision.json.ts` (`prerender = false`) |

No Next.js unit remains active.
