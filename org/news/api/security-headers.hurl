# The security header contract.
#
# This replaces `test/security-headers.test.ts`, which imported the header helper
# from `../security-headers`, awaited it, and asserted that the returned array
# contained the values the same file had just declared. That test could not fail
# for any reason a user would notice: it shared no code path with a served
# response, so it stayed green through any mistake in the wiring that applies
# those headers to a response.
#
# Asserting on a real response closes that gap. Read the header values here as
# the contract; `security-headers.ts` is one implementation of it.

GET {{base}}/ja/
HTTP 200
[Asserts]
header "content-security-policy" contains "default-src 'self'"
header "content-security-policy" contains "base-uri 'none'"
header "content-security-policy" contains "connect-src 'self'"
header "content-security-policy" contains "font-src 'self' data:"
header "content-security-policy" contains "form-action 'self'"
header "content-security-policy" contains "frame-ancestors 'none'"
header "content-security-policy" contains "img-src 'self' data:"
header "content-security-policy" contains "object-src 'none'"
header "content-security-policy" contains "upgrade-insecure-requests"
# THIS RUNNER STARTS A DEV SERVER, and the development policy is the loose one.
# `script-src` and `style-src` carry 'unsafe-inline' here, and `script-src` also
# carries 'unsafe-eval', because Vite injects inline scripts of its own.
#
# A PRODUCTION response carries none of the three: it names a per-request nonce
# instead, which TanStack stamps on the one inline script it emits. No client
# talking to a dev server can observe that, so the production half is asserted
# in test/content-security-policy.test.ts.
#
# The negative assertions below are the part with teeth: the loosening must stay
# confined to those two directives whichever server is answering.
header "content-security-policy" matches "script-src 'self' 'unsafe-inline'( 'unsafe-eval')?;"
header "content-security-policy" contains "style-src 'self' 'unsafe-inline'"
header "content-security-policy" not contains "default-src 'self' 'unsafe-inline'"
header "content-security-policy" not matches "(?:default-src|style-src|connect-src)[^;]*unsafe-eval"
# A nonce authorises elements, never attributes, so these two are stated in both
# builds rather than left to `script-src`.
header "content-security-policy" contains "script-src-attr 'none'"
header "content-security-policy" contains "style-src-attr 'none'"
header "content-security-policy" not contains "*"
header "strict-transport-security" contains "max-age=31536000"
header "strict-transport-security" contains "includeSubDomains"
header "x-content-type-options" == "nosniff"
header "x-frame-options" == "DENY"
header "referrer-policy" == "no-referrer"
header "permissions-policy" contains "accelerometer=()"
header "permissions-policy" contains "camera=()"
header "permissions-policy" contains "geolocation=()"
header "permissions-policy" contains "gyroscope=()"
header "permissions-policy" contains "magnetometer=()"
header "permissions-policy" contains "microphone=()"
header "permissions-policy" contains "payment=()"
header "permissions-policy" contains "usb=()"


# The `source: '/:path*'` pattern claims every path, so the error path has to
# carry the headers too — a 404 answering without a CSP is the case a
# happy-path-only assertion misses, and it is a page an attacker can always
# reach.
GET {{base}}/__definitely_not_found__
HTTP 404
[Asserts]
header "content-security-policy" contains "default-src 'self'"
header "content-security-policy" contains "frame-ancestors 'none'"
header "x-content-type-options" == "nosniff"
header "x-frame-options" == "DENY"
header "referrer-policy" == "no-referrer"

# And on a Publishing failure document, whose status the request boundary
# rewrites: the rewrite must not drop the headers.
GET {{base}}/ja/entries/
HTTP 503
[Asserts]
header "content-security-policy" contains "default-src 'self'"
header "content-security-policy" contains "frame-ancestors 'none'"
header "x-content-type-options" == "nosniff"
header "x-frame-options" == "DENY"
header "referrer-policy" == "no-referrer"

# And on a JSON route handler, which does not go through the page renderer at
# all.
GET {{base}}/revision
HTTP 200
[Asserts]
header "content-security-policy" contains "default-src 'self'"
header "x-content-type-options" == "nosniff"
header "x-frame-options" == "DENY"
