# The colour scheme, and the cookie that forces one.
#
# `theme=light` and `theme=dark` pin the scheme; anything else — the cookie
# missing, `system`, a stale value — leaves `data-theme` off the root element,
# which is what hands the decision to `prefers-color-scheme`. `src/theme.ts`
# makes that decision and `src/style.css` defines the `dark:` variant around
# the same three cases.
#
# Its own file for the reason `api/i18n.hurl` is: Hurl keeps one cookie jar per
# file, and the state under test here is a request that carries no cookie at
# all. The `Cookie:` header is written out on each request rather than left to
# the jar, because nothing in this unit ever sets `theme` — a jar could not
# acquire it.
#
# Every document this unit serves is covered, not only the shell: the status,
# offline and health pages are separate root documents, so each has to render
# the attribute itself.

# 1. No cookie. The attribute is absent — not `data-theme="system"`, which no
#    selector matches.
GET {{base}}/about
HTTP 200
[Asserts]
xpath "count(//html[@data-theme])" == 0

# 2. Forced dark, on the shell.
GET {{base}}/about
Cookie: theme=dark
HTTP 200
[Asserts]
xpath "string(//html/@data-theme)" == "dark"
# `lang` is untouched by it: it is pinned to this unit's default locale and
# drives `word-break: auto-phrase` (api/i18n.hurl).
xpath "string(//html/@lang)" == "ja"

# 3. Forced light. Distinct from absent, and deliberately so — it has to beat a
#    dark OS, which absence does not.
GET {{base}}/about
Cookie: theme=light
HTTP 200
[Asserts]
xpath "string(//html/@data-theme)" == "light"

# 4. An unrecognised value is not echoed into the document.
GET {{base}}/about
Cookie: theme=midnight
HTTP 200
[Asserts]
xpath "count(//html[@data-theme])" == 0

# 5. Alongside the `language` cookie this unit does set.
GET {{base}}/about?lang=ja
Cookie: theme=dark; language=ja
HTTP 200
[Asserts]
xpath "string(//html/@data-theme)" == "dark"
xpath "normalize-space(//footer//nav//a)" == "このサイトについて"

# 6. `/health.html` is a 404; the 404 document still takes a theme cookie.
GET {{base}}/health.html
Cookie: theme=dark
HTTP 404
[Asserts]
header "content-type" == "text/html; charset=UTF-8"
header "content-type" not contains "json"
xpath "string(//html/@data-theme)" == "dark"

# 7. So are the offline and 404 documents, which the error boundary and the
#    service worker reach without the renderer.
GET {{base}}/offline
Cookie: theme=light
HTTP 200
[Asserts]
xpath "string(//html/@data-theme)" == "light"

GET {{base}}/no-such-page
Cookie: theme=dark
HTTP 404
[Asserts]
xpath "string(//html/@data-theme)" == "dark"

GET {{base}}/no-such-page
HTTP 404
[Asserts]
xpath "count(//html[@data-theme])" == 0


# 8. Neither cookie appears in a URL, so nothing but the response itself can
#    tell a cache that two requests for the same path are not the same
#    document. `language` decides the copy and `theme` decides the scheme;
#    `Accept-Language` is the fallback the detector uses on a first visit.
#
#    Read by substring rather than whole: this Worker appends to `Vary` rather
#    than assigning it, and what else is in the header differs between
#    `vite dev` (which adds `Origin`) and a deployment.
GET {{base}}/about
HTTP 200
[Asserts]
header "vary" contains "Cookie"
header "vary" contains "Accept-Language"

GET {{base}}/offline
HTTP 200
[Asserts]
header "vary" contains "Cookie"
header "vary" contains "Accept-Language"

# ...and only where it is true. `/revision` is negotiated by nothing.
# `/health.json` is a 404 HTML document, not a JSON surface.
GET {{base}}/revision
HTTP 200
[Asserts]
header "vary" not contains "Cookie"

GET {{base}}/health.json
HTTP 404
[Asserts]
header "content-type" == "text/html; charset=UTF-8"
header "content-type" not contains "json"

GET {{base}}/health.html
HTTP 404
[Asserts]
header "content-type" == "text/html; charset=UTF-8"
header "content-type" not contains "json"

# A document a cache was told not to store has nothing left to vary.
GET {{base}}/no-such-page
HTTP 404
[Asserts]
header "cache-control" == "no-store"
header "vary" not contains "Cookie"
