# The UMAXICA <title> contract, on every HTML document this frame serves.
#
#   Root title -> `UMAXICA (COM)`
#   Page title -> `{LOCALIZED_PAGE_TITLE} — UMAXICA (COM)`   (EM DASH, not a
#                                                             hyphen or a pipe)
#
# The rules, which every surface below must satisfy:
#
#   1. exactly one <title>
#   2. non-empty after trim
#   3. the brand is exactly "UMAXICA", casing does not vary
#   4. the TLD segment matches this deployment family — (COM)
#   5. a non-root surface carries a page-specific segment before the EM DASH
#   6. the title never names the surface or the runtime that served it
#
# Rule 6 is the one with teeth: Rails and Edge split routes inside one FQDN, and
# that split has to be invisible to a user reading their tab. `apex`, `core`,
# `hono`, `workers`, `cloudflare`, `next` and friends must not appear.
#
# `test/title-contract.test.tsx` keeps the metadata-level rules, which apply to
# every page's exported `metadata` before a request exists. This file is the
# other half: that the metadata survives rendering and reaches the wire.

# The root form is the one place the page segment is optional, and the frames
# differ: `core` serves the bare brand, while a content frame names itself
# (`Docs — UMAXICA (COM)`). Both satisfy the contract, so the assertion is the
# canonical regex from `test/utils/title-contract.ts` rather than a literal.
GET {{base}}/
HTTP 200
[Asserts]
xpath "count(//title)" == 1
xpath "normalize-space(//title)" != ""
xpath "string(//title)" matches /^(?:.+ — )?UMAXICA \(COM\)$/
xpath "string(//title)" not matches /(?i)\b(auth|core|apex|side|edge|next|nextjs|hono|workers?|cloudflare|opennext)\b/
xpath "string(//title)" not matches /Umaxica|umaxica/

GET {{base}}/about
HTTP 200
[Asserts]
xpath "count(//title)" == 1
xpath "string(//title)" matches /^.+ — UMAXICA \(COM\)$/
xpath "string(//title)" not matches /(?i)\b(auth|core|apex|side|edge|next|nextjs|hono|workers?|cloudflare|opennext)\b/
xpath "string(//title)" not matches /Umaxica|umaxica/

GET {{base}}/offline
HTTP 200
[Asserts]
xpath "count(//title)" == 1
xpath "string(//title)" matches /^.+ — UMAXICA \(COM\)$/
xpath "string(//title)" not matches /(?i)\b(auth|core|apex|side|edge|next|nextjs|hono|workers?|cloudflare|opennext)\b/

GET {{base}}/__definitely_not_found__
HTTP 404
[Asserts]
xpath "count(//title)" == 1
xpath "string(//title)" matches /^.+ — UMAXICA \(COM\)$/
xpath "string(//title)" not matches /(?i)\b(auth|core|apex|side|edge|next|nextjs|hono|workers?|cloudflare|opennext)\b/


# The contract applies to HTML and must leave machine surfaces alone: a `title`
# key appearing in the JSON identity payload would mean the renderer had reached
# a response it does not own.
GET {{base}}/api/v0/revision.json
HTTP 200
[Asserts]
header "content-type" matches /^application\/json/
jsonpath "$.title" not exists

GET {{base}}/revision
HTTP 200
[Asserts]
header "content-type" matches /^text\/plain/
body not contains "<title"

GET {{base}}/health
HTTP 200
[Asserts]
header "content-type" == "text/plain; charset=utf-8"
body not contains "<title"
