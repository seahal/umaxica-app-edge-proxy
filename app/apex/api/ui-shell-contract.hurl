# The UMAXICA application shell.
#
# What has to stay stable across every deployment unit is the emitted document —
# semantics, hierarchy, accessible names — not the way this unit happens to
# build it. `docs/design/ui-shell-contract.md` is normative.
#
# These assertions deliberately do not name a CSS class. Every visual rule is a
# Tailwind utility, so a class list is styling rather than structure: a test
# that pinned one would fail on a padding change while still passing if the
# `<nav>` lost its accessible name.
#
# Replaces `test/ui-shell-contract.test.tsx`, which asserted the same things on
# the same responses but had to reach them through happy-dom — including a
# regex that stripped `<link rel="stylesheet">` out of the document before
# parsing, because happy-dom would otherwise try to fetch `/style.css` over a
# network no unit test has. XPath over a real response needs none of that.

# `/about` is the only user-facing HTML page this unit serves, so it is the
# whole shell surface.
GET {{base}}/about
HTTP 200
[Asserts]
# Exactly one of each landmark, in document order.
xpath "count(//header)" == 1
xpath "count(//main)" == 1
xpath "count(//footer)" == 1
xpath "count(//body/header/following-sibling::main)" == 1
xpath "count(//body/main/following-sibling::footer)" == 1

# The brand links home and does not steal the page heading: the `<h1>` belongs
# to the page, inside `<main>`.
xpath "string(//header//a/@href)" == "/"
xpath "normalize-space(//header//a)" == "UMAXICA"
xpath "count(//header//h1)" == 0
xpath "count(//main//h1)" == 1

# No dead control in the header. Nothing on this unit toggles, so the header
# holds the brand link and nothing else interactive. The skip link asserted
# below is a sibling of `<header>`, not a child, so it is not counted here.
xpath "count(//header//a)" == 1
xpath "count(//header//button)" == 0

# The skip link (docs/design/ui-shell-contract.md §12). It has to be the first
# focusable element in the document — not merely the first link — so the union
# below is every element that can take focus, taken in document order.
xpath "count(//a[@href='#main-content'])" == 1
xpath "string((//a|//button|//input|//select|//textarea|//*[@tabindex])[1]/@href)" == "#main-content"
# No `Accept-Language` on this request, so the detector falls back to English —
# the same reason the utility nav reads "Utility navigation" below.
xpath "normalize-space(//a[@href='#main-content'])" == "Skip to main content"

# ...and its target has to exist and be able to take focus. `tabindex="-1"` is
# the half that is easy to leave out and the half that does the work: without
# it the browser scrolls to the fragment and leaves focus on the link, so the
# reader's next Tab returns to the header they just asked to skip. The control
# appears to work and does not.
xpath "string(//main/@id)" == "main-content"
xpath "string(//main/@tabindex)" == "-1"

# No main navigation, because this unit has no second destination. The only
# `<nav>` in the document is the footer's.
xpath "count(//nav)" == 1
xpath "count(//footer//nav)" == 1

# The footer has two layers: a named utility nav, then the site identity.
xpath "string(//footer//nav/@aria-label)" == "Utility navigation"
xpath "string(//footer//nav//a/@href)" == "/about"
xpath "normalize-space(//footer//nav//a)" == "About"
xpath "count(//footer//nav/following-sibling::p)" == 1
xpath "normalize-space(//footer//nav/following-sibling::p)" matches /©\s*\d{4} UMAXICA/
xpath "string(//footer//nav/following-sibling::p//a/@href)" == "https://umaxica.app/"
xpath "normalize-space(//footer//nav/following-sibling::p//a)" == "https://umaxica.app/"

# One compiled stylesheet, nothing inline. The CSS used to be an inline
# `<style>` whose sha256 was hand-maintained in the CSP; it is a static asset
# now, so no document may carry an inline stylesheet or a `style` attribute —
# `style-src-attr 'none'` would drop the latter anyway.
xpath "count(//link[@rel='stylesheet'])" == 1
xpath "string(//link[@rel='stylesheet']/@href)" matches /^\/[^"]+\.css(\?[^"]*)?$/
xpath "count(//style)" == 0
xpath "count(//*[@style])" == 0

# The shell must not link to a surface this unit does not serve. No Privacy,
# Terms or Preferences page exists here.
xpath "count(//a[@href='/privacy'])" == 0
xpath "count(//a[@href='/terms'])" == 0
xpath "count(//a[@href='/preferences'])" == 0
[Captures]
stylesheet_url: xpath "string(//link[@rel='stylesheet']/@href)"


# Rather than compare the shell's hrefs against a hand-kept allowlist, ask the
# server. Every internal destination the shell offers must answer.
GET {{base}}/about
HTTP 200

GET {{base}}/favicon.ico
HTTP 200

GET {{base}}/manifest.webmanifest
HTTP 200
[Asserts]
header "content-type" matches /json/

# Captured from the document above rather than written down: the URL differs
# between `vite dev` and a build. See api/status-surfaces.hurl.
GET {{base}}{{stylesheet_url}}
HTTP 200

GET {{base}}/service-worker-register.js
HTTP 200
[Asserts]
header "content-type" matches /javascript/


# The shell localises through the same language detector as the page copy.
# Sent first in this file's cookie jar, so `Accept-Language` still decides —
# see api/i18n.hurl for why that ordering matters.
GET {{base}}/about?lang=ja
HTTP 200
[Asserts]
xpath "string(//footer//nav/@aria-label)" == "ユーティリティナビゲーション"
xpath "normalize-space(//footer//nav//a)" == "このサイトについて"
# The skip link goes through the same detector. It is the first shell label
# added since the three i18n mechanisms were recorded (§13), and this is the
# only archetype where its English half is reachable at all — the assertion in
# the first request above is that English.
xpath "normalize-space(//a[@href='#main-content'])" == "本文へスキップ"


# `/health.html` is not a page. It is the same 404 document as any other miss.
GET {{base}}/health.html
HTTP 404
[Asserts]
header "content-type" == "text/html; charset=UTF-8"
header "content-type" not contains "json"
xpath "count(//header)" == 0
xpath "count(//nav)" == 0
