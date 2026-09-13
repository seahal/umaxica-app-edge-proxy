# The UMAXICA <title> contract, on every HTML document this unit serves.
#
#   Root title -> `UMAXICA (APP)`
#   Page title -> `{LOCALIZED_PAGE_TITLE} — UMAXICA (APP)`   (EM DASH, not a
#                                                             hyphen or a pipe)
#
# The rules, which every surface below must satisfy:
#
#   1. exactly one <title>
#   2. non-empty after trim
#   3. the brand is exactly "UMAXICA", casing does not vary
#   4. the TLD segment matches this deployment family — (APP)
#   5. a non-root surface carries a page-specific segment before the EM DASH
#   6. the title never names the surface or the runtime that served it
#
# Rule 6 is the one with teeth: Rails and Edge split routes inside one FQDN, and
# that split has to be invisible to a user reading their tab. `apex`, `core`,
# `hono`, `workers`, `cloudflare`, `next` and friends must not appear.
#
# `test/title-contract.test.ts` keeps the one surface no client can request —
# the 500 document — using the same rules from `test/utils/title-contract.ts`.

GET {{base}}/about
HTTP 200
[Asserts]
xpath "count(//title)" == 1
xpath "normalize-space(//title)" != ""
xpath "string(//title)" matches /^.+ — UMAXICA \(APP\)$/
xpath "string(//title)" not matches /(?i)\b(auth|core|apex|side|edge|next|nextjs|hono|workers?|cloudflare|opennext)\b/
xpath "string(//title)" not matches /Umaxica|umaxica/

GET {{base}}/health
HTTP 200
[Asserts]
header "content-type" == "text/plain; charset=utf-8"
body not contains "<title"

# `/health.html` is a 404 HTML document, not a health page.
GET {{base}}/health.html
HTTP 404
[Asserts]
header "content-type" == "text/html; charset=UTF-8"
header "content-type" not contains "json"
xpath "count(//title)" == 1
xpath "string(//title)" matches /^.+ — UMAXICA \(APP\)$/
xpath "string(//title)" not matches /(?i)\b(auth|core|apex|side|edge|next|nextjs|hono|workers?|cloudflare|opennext)\b/

GET {{base}}/offline
HTTP 200
[Asserts]
xpath "count(//title)" == 1
xpath "string(//title)" matches /^.+ — UMAXICA \(APP\)$/
xpath "string(//title)" not matches /(?i)\b(auth|core|apex|side|edge|next|nextjs|hono|workers?|cloudflare|opennext)\b/

GET {{base}}/definitely-missing
HTTP 404
[Asserts]
xpath "count(//title)" == 1
xpath "string(//title)" matches /^.+ — UMAXICA \(APP\)$/
xpath "string(//title)" not matches /(?i)\b(auth|core|apex|side|edge|next|nextjs|hono|workers?|cloudflare|opennext)\b/


# `/health.json` is not a machine-readable health document. It is a 404 HTML
# page and still has to satisfy the title contract — the renderer must not
# invent a JSON body when the client asks for this path.
GET {{base}}/health.json
HTTP 404
[Asserts]
header "content-type" == "text/html; charset=UTF-8"
header "content-type" not contains "json"
xpath "count(//title)" == 1
xpath "string(//title)" matches /^.+ — UMAXICA \(APP\)$/
xpath "string(//title)" not matches /(?i)\b(auth|core|apex|side|edge|next|nextjs|hono|workers?|cloudflare|opennext)\b/

# Structured identity is JSON and must not grow a `title` from the HTML renderer.
GET {{base}}/api/v0/revision.json
HTTP 200
[Asserts]
header "content-type" matches /^application\/json/
jsonpath "$.title" not exists
jsonpath "$.*" count == 3

GET {{base}}/revision
HTTP 200
[Asserts]
header "content-type" matches /^text\/plain/
body not contains "<title"
