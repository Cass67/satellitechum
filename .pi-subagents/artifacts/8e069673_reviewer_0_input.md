# Task for reviewer

Audit a completed Go rewrite of a Flask app at /Users/cass/git/satellite-chum (branch go-rewrite, HEAD 3085d93). The Python reference is available via `git -C /Users/cass/git/satellite-chum show main:app.py` (2,277 lines). The Go files are app.go, cache.go, config.go, location.go, main.go, profile.go, ratelimit.go, satellite.go, tle.go, textutil.go, turnstile.go + *_test.go, plus Dockerfile, compose.yml, deploy/satellite-chum.service.

Context: this is a satellite tracking web app. chi router, go-redis (optional), stdlib only. Frontend (static/) untouched. It already passed a side-by-side JSON parity check against the running Python app for all 10 routes, and `go test -race` is green.

Audit for REAL problems only (things that would misbehave in production), not style:
1. **Security**: header middleware, trusted-hosts enforcement, Turnstile cookie handling (HMAC, expiry, secure/httponly/samesite), rate limit bypasses, header injection, template injection via html/template, error info leaks, request body limits.
2. **Correctness vs Python reference**: porting bugs — string normalization (normalizeText/normalizeName/stripAccents), float formatting (pyRound/pyFloatStr/floatParam), TLE line parsing, balanced subset selection, country code lowercasing, satcat merge precedence, failure-cache TTLs, rate limit window math. Compare against `git show main:app.py`.
3. **Concurrency**: data races on App fields (caches, tleMu, rateMu), LRU cache correctness, background refresh goroutine lifecycle, context cancellation in httpGetJSON (cancelOnClose wrapper).
4. **Container/deploy**: Dockerfile (distroless/static:nonroot, busybox healthcheck, TLS certs for ca-certificates), compose.yml (healthcheck, env, redis), deploy/satellite-chum.service (ExecStart /app/satellitechum, EnvironmentFile .env, PORT=6666).
5. **Go-specific pitfalls**: JSON omitempty behavior differences vs Python dicts, html/template delimiters vs Jinja in templates/index.html, chi middleware ordering, http.ServeMux vs chi routing for /static.

Report: numbered findings, each with file:line, severity (blocker/major/minor), and a one-line fix suggestion. If a finding is speculative, say so. End with a verdict: SHIP / SHIP-WITH-NITS / FIX-FIRST.

## Acceptance Contract
Acceptance level: attested
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Return concrete findings with file paths and severity when applicable

Required evidence: review-findings, residual-risks

Finish with a fenced JSON block tagged `acceptance-report` in this shape:
Use empty arrays when no items apply; array fields contain strings unless object entries are shown.
`criteriaSatisfied[].status` must be exactly one of: satisfied, not-satisfied, not-applicable.
`commandsRun[].result` must be exactly one of: passed, failed, not-run.
`manualNotes` and `notes` are optional strings; an empty string means no note and does not satisfy `manual-notes` evidence.
```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "specific proof"
    }
  ],
  "changedFiles": [
    "src/file.ts"
  ],
  "testsAddedOrUpdated": [
    "test/file.test.ts"
  ],
  "commandsRun": [
    {
      "command": "command",
      "result": "passed",
      "summary": "short result"
    }
  ],
  "validationOutput": [
    "validation output or concise summary"
  ],
  "residualRisks": [
    "none"
  ],
  "noStagedFiles": true,
  "diffSummary": "short description of the diff",
  "reviewFindings": [
    "blocker: file.ts:12 - issue found, or no blockers"
  ],
  "manualNotes": "anything else the parent should know"
}
```