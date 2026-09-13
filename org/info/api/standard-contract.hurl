# The standard URL contract: the paths every UMAXICA frame answers, and what
# they answer with.
#
# Moved out of `e2e/standard-contract.spec.ts`, whose first test was nine
# `request.get()` calls and four `content-type` reads — no page, no DOM, no
# script. Running it there started Chromium in order to read nine status lines.
# What stayed behind in that spec is the part that genuinely needs a browser:
# the manifest `<link>` and the service worker reaching `activated`.
#
# Assertions go past the status line on purpose. A `robots.txt` that answers 200
# with an empty body, or a `manifest.webmanifest` served as `text/html`, passes a
# status check and fails a user agent.

GET {{base}}/robots.txt
HTTP 200
[Asserts]
header "content-type" matches /^text\/plain/
body contains "User-Agent:"
# A robots.txt that does not point at the sitemap is the common way this file
# rots: the sitemap keeps being generated and nothing ever finds it.
body contains "Sitemap:"

GET {{base}}/sitemap.xml
HTTP 200
[Asserts]
header "content-type" matches /xml/
xpath "//*[local-name()='urlset']" exists

GET {{base}}/favicon.ico
HTTP 200
[Asserts]
header "content-type" matches /icon|image/

# The manifest is the file that decides whether the app is installable, so the
# keys an installer actually reads are pinned rather than just its media type.
GET {{base}}/manifest.webmanifest
HTTP 200
[Asserts]
header "content-type" matches /json/
jsonpath "$.name" exists
jsonpath "$.start_url" exists
jsonpath "$.display" exists
jsonpath "$.icons" count > 0

GET {{base}}/service-worker.js
HTTP 200
[Asserts]
header "content-type" matches /javascript/
# The offline fallback is the whole reason this file is served. A service worker
# that installs but never intercepts leaves `/offline` unreachable exactly when
# it is needed.
body contains "fetch"

GET {{base}}/offline
HTTP 200
[Asserts]
header "content-type" matches /^text\/html/

GET {{base}}/
HTTP 302
[Asserts]
header "location" matches "/(ja|en)/"

GET {{base}}/ja/
HTTP 200
[Asserts]
header "content-type" matches /^text\/html/

GET {{base}}/en/
HTTP 200
[Asserts]
header "content-type" matches /^text\/html/

GET {{base}}/__definitely_not_found__
HTTP 404
[Asserts]
header "content-type" matches /^text\/html/


# `/revision` is the compact operational deployment id (text/plain). Structured
# identity is `/api/v0/revision.json` (`api/revision-api.hurl`).
GET {{base}}/revision
HTTP 200
[Asserts]
header "content-type" matches /^text\/plain/
header "content-type" not contains "application/json"
header "content-type" not contains "text/html"


GET {{base}}/health
HTTP 200
[Asserts]
header "content-type" == "text/plain; charset=utf-8"
header "cache-control" == "no-store"
body contains "status: ok"
body contains "startup: ok"
body contains "liveness: ok"
body contains "readiness: ok"
body not contains "{"
body not contains "<html"
body not contains "Authorization"
body not contains "Cookie"
