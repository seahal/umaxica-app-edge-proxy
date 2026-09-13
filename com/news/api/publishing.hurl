# The public Publishing route contract, on a real server.
#
#   /{lang}/                        home
#   /{lang}/entries/                collection, page 1 (canonical)
#   /{lang}/entries/page/{N}/       collection, page N >= 2
#   /{lang}/entries/{public_id}/    one Entry
#   /{lang}/search/                 search (temporary fixture source)
#
# `api/run.mjs` starts `pnpm run dev`, whose `local` tier binds no Workers VPC
# service, so every Rails-backed route answers 503 here — and that is the
# point: it proves the fail-closed status, the uncacheable headers and the
# generic body a user sees when Rails is not there. What Rails can make a page
# say (entries, pagination links, management links, the public cache policy on
# a rendered Entry) is asserted against an injected binding in
# `test/publishing-pages.test.tsx`, the one layer that can produce it.

# --- locale ---------------------------------------------------------------

GET {{base}}/ja/
HTTP 200
[Asserts]
header "content-type" matches /^text\/html/
header "cache-control" not exists
xpath "string(//html/@lang)" == "ja"
xpath "string(//link[@rel='canonical']/@href)" == "https://news-jp.umaxica.com/ja/"
xpath "string(//link[@rel='alternate'][@hreflang='en']/@href)" == "https://news-jp.umaxica.com/en/"
xpath "string(//link[@rel='alternate'][@hreflang='x-default']/@href)" == "https://news-jp.umaxica.com/ja/"
xpath "count(//header//nav//a[@href='/ja/'])" == 1
xpath "count(//header//nav//a[@href='/ja/entries/'])" == 1
xpath "count(//header//nav//a[@href='/ja/search/'])" == 1

GET {{base}}/en/
HTTP 200
[Asserts]
xpath "string(//html/@lang)" == "en"
xpath "string(//link[@rel='canonical']/@href)" == "https://news-jp.umaxica.com/en/"
xpath "count(//header//nav//a[@href='/en/search/'])" == 1
xpath "count(//a[@href='/ja/entries/'])" == 0

# An unsupported locale is not a page — never rewritten onto ja or en.
GET {{base}}/fr/
HTTP 404
[Asserts]
xpath "string(//title)" == "ページが見つかりません — UMAXICA (COM)"

GET {{base}}/foo/
HTTP 404

GET {{base}}/fr/entries/
HTTP 404

GET {{base}}/fr/search/
HTTP 404

# --- collection and pagination -------------------------------------------

GET {{base}}/ja/entries/
HTTP 503
[Asserts]
header "content-type" matches /^text\/html/
header "cache-control" == "no-store"
header "x-robots-tag" contains "noindex"
header "x-umaxica-publishing-status" not exists
xpath "string(//html/@lang)" == "ja"
xpath "count(//title)" == 1
xpath "string(//title)" matches /^.+ — UMAXICA \(APP\)$/
body contains "HTTP 503"
body not contains "localhost"
body not contains "UMAXICA_APPS_EDGE_CF_WORKERS_VPC"

GET {{base}}/en/entries/page/2/
HTTP 503
[Asserts]
header "cache-control" == "no-store"
xpath "string(//html/@lang)" == "en"

# Page 1 has exactly one URL.
GET {{base}}/ja/entries/page/1/
HTTP 301
[Asserts]
header "location" endsWith "/ja/entries/"

GET {{base}}/en/entries/page/1/
HTTP 301
[Asserts]
header "location" endsWith "/en/entries/"

# Invalid page input is not a page, and never silently page 1.
GET {{base}}/ja/entries/page/0/
HTTP 404

GET {{base}}/ja/entries/page/-1/
HTTP 404

GET {{base}}/ja/entries/page/foo/
HTTP 404

GET {{base}}/ja/entries/page/1.5/
HTTP 404

GET {{base}}/ja/entries/page/01/
HTTP 404

# --- one Entry ------------------------------------------------------------

# A failed Entry read is never cached, even though a rendered Entry is.
GET {{base}}/ja/entries/01J9ZEXAMPLEPUBLICID/
HTTP 503
[Asserts]
header "cache-control" == "no-store"
header "cache-control" not contains "public"
header "x-robots-tag" contains "noindex"
body not contains "localhost"

# --- search ---------------------------------------------------------------

GET {{base}}/ja/search/
HTTP 200
[Asserts]
header "cache-control" not exists
xpath "string(//html/@lang)" == "ja"
xpath "count(//search/form[@method='get'][@action='/ja/search/'])" == 1
xpath "count(//form//input[@name='q'][@id='search-query'])" == 1
xpath "count(//label[@for='search-query'])" == 1
xpath "string(//link[@rel='canonical']/@href)" == "https://news-jp.umaxica.com/ja/search/"
xpath "count(//meta[@name='robots'])" == 0

# Results stay in this cell and this locale, and link by public_id.
GET {{base}}/en/search/?q=e
HTTP 200
[Asserts]
header "cache-control" not exists
xpath "string(//html/@lang)" == "en"
xpath "count(//main//li/a[starts-with(@href, '/en/entries/fixture-news-com-en-')])" >= 1
xpath "count(//main//li/a[not(starts-with(@href, '/en/entries/fixture-news-com-en-'))])" == 0
xpath "string(//meta[@name='robots']/@content)" == "noindex, follow"

GET {{base}}/en/search/?q=zzzz-no-such-term
HTTP 200
[Asserts]
body contains "No entries matched"
xpath "count(//main//li)" == 0
