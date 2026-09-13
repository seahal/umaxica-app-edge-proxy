# Kubernetes-style runtime probes. All four are Worker-served text/plain.

GET {{base}}/health
HTTP 200
[Asserts]
header "content-type" == "text/plain; charset=utf-8"
header "cache-control" == "no-store"
body == "status: ok\nstartup: ok\nliveness: ok\nreadiness: ok\n"
body not contains "{"
body not contains "<html"

GET {{base}}/health/startups
HTTP 200
[Asserts]
header "content-type" == "text/plain; charset=utf-8"
header "cache-control" == "no-store"
body == "ok\n"

GET {{base}}/health/livenesses
HTTP 200
[Asserts]
header "content-type" == "text/plain; charset=utf-8"
header "cache-control" == "no-store"
body == "ok\n"

GET {{base}}/health/readinesses
HTTP 200
[Asserts]
header "content-type" == "text/plain; charset=utf-8"
header "cache-control" == "no-store"
body == "ok\n"
