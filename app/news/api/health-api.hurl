# Machine-facing Edge self-health API.
#
# This document describes THIS Edge runtime only. It must not proxy Rails,
# mix in revision, or negotiate language. `/health` remains the separate
# operational text/plain contract.

GET {{base}}/api/v0/health.json
HTTP 200
[Asserts]
header "content-type" contains "application/json"
header "content-type" not contains "text/html"
header "content-type" not contains "text/plain"
header "cache-control" contains "no-store"
header "x-robots-tag" == "noindex, nofollow"
header "location" not exists
header "set-cookie" not exists

jsonpath "$.status" == "pass"
jsonpath "$.checks" isObject
jsonpath "$.checks.startup" isObject
jsonpath "$.checks.startup.status" == "pass"
jsonpath "$.checks.liveness" isObject
jsonpath "$.checks.liveness.status" == "pass"
jsonpath "$.checks.readiness" isObject
jsonpath "$.checks.readiness.status" == "pass"
jsonpath "$.*" count == 2
jsonpath "$.checks.*" count == 3

jsonpath "$.rails" not exists
jsonpath "$.edge" not exists
jsonpath "$.revision" not exists
jsonpath "$.version" not exists
jsonpath "$.timestamp" not exists

body not contains "<html"

GET {{base}}/api/v0/health.json
Accept-Language: ja
HTTP 200
[Asserts]
header "content-type" contains "application/json"
header "set-cookie" not exists
jsonpath "$.status" == "pass"

GET {{base}}/api/v0/health.json
Accept-Language: en
HTTP 200
[Asserts]
header "content-type" contains "application/json"
header "set-cookie" not exists
jsonpath "$.status" == "pass"
jsonpath "$.checks.readiness.status" == "pass"
