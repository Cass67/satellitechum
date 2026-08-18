# Task for delegate

You are doing a read-only production audit of a completed Go rewrite of a Flask app. Repo: /Users/cass/git/satellite-chum (branch go-rewrite, HEAD 3085d93). Do NOT edit any files.

The Python reference is `git -C /Users/cass/git/satellite-chum show main:app.py` (2,277 lines). Go files: app.go, cache.go, config.go, location.go, main.go, profile.go, ratelimit.go, satellite.go, tle.go, textutil.go, turnstile.go + *_test.go, Dockerfile, compose.yml, deploy/satellite-chum.service.

Context: satellite tracking web app. chi router, go-redis (optional), stdlib otherwise. Frontend (static/) untouched. Already passed side-by-side JSON parity vs the running Python app for all 10 routes; `go test -race` green; staticcheck has 3 nits (SA6005 EqualFold at location.go:218,321; unused wsRE at textutil.go:14).

Audit for REAL production problems only, not style:
1. **Security**: header middleware, trusted-hosts enforcement, Turnstile cookie (HMAC, expiry, secure/httponly/samesite), rate limit bypasses, header injection, html/template injection, error info leaks, request body limits.
2. **Correctness vs Python**: porting bugs — normalizeText/normalizeName/stripAccents, float formatting (pyRound/pyFloatStr/floatParam), TLE line parsing, balanced subset selection, country code lowercasing, satcat merge precedence, failure-cache TTLs, rate limit window math. Compare against the Python reference.
3. **Concurrency**: data races on App fields (caches, tleMu, rateMu), LRU correctness, background refresh goroutine lifecycle, context cancellation in httpGetJSON (cancelOnClose).
4. **Container/deploy**: Dockerfile (distroless/static:nonroot, busybox healthcheck, ca-certificates), compose.yml, deploy/satellite-chum.service (ExecStart /app/satellitechum, EnvironmentFile, PORT=6666).
5. **Go pitfalls**: JSON omitempty vs Python dicts, html/template vs Jinja delimiters in templates/index.html, chi middleware ordering, /static routing.

Report: numbered findings with file:line, severity (blocker/major/minor), one-line fix. Mark speculative findings as such. End with verdict: SHIP / SHIP-WITH-NITS / FIX-FIRST.

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