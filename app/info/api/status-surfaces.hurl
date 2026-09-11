# The documents a user meets when something is wrong: the 404 and the offline
# page.
#
# Markup lives in `src/components/status-documents.tsx` and
# `src/routes/offline.tsx`. These requests prove the router actually serves them
# on the matching paths, not only that the components exist. A failed Rails read
# is a third document, asserted in `api/publishing.hurl`.

GET {{base}}/__definitely_not_found__
HTTP 404
[Asserts]
header "content-type" matches /^text\/html/
xpath "string(//html/@lang)" == "ja"
xpath "string(//title)" == "ページが見つかりません — UMAXICA (APP)"
xpath "//h1" exists
# A 404 offers a way home. It must not offer a reload — the request will not
# succeed the second time, and telling a user otherwise is the difference
# between the 404 document and the 500 one.
body not contains "再読み込み"

# A nested path proves the handler is global rather than attached to one route.
GET {{base}}/about/definitely/not/here
HTTP 404
[Asserts]
xpath "string(//title)" == "ページが見つかりません — UMAXICA (APP)"


# `/offline` is what the service worker serves from cache when the network is
# gone. It has to be a real, cacheable document served over the network first —
# a service worker cannot cache a route that never answered.
GET {{base}}/offline
HTTP 200
[Asserts]
header "content-type" matches /^text\/html/
xpath "string(//html/@lang)" == "ja"
xpath "string(//title)" == "オフライン — UMAXICA (APP)"
xpath "//h1" exists
