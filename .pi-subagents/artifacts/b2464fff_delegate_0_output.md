Audit complete. Repo untouched (only pre-existing untracked `.pi-subagents/`).

# Production Audit — Go rewrite vs Flask reference (main:app.py)

## Findings

**1. BLOCKER — `turnstile.go:54-62` — Turnstile session cookie missing `Path: "/"`.**
Flask/Werkzeug always emits `Path=/`; Go's `http.Cookie` omits `Path` when empty, so per RFC 6265 the browser scopes the cookie to default-path `/api/turnstile`. Every guarded route (`/api/search`, `/api/satellite-lookup/*`, `/api/location-intel`, `/api/satellite/*`) then never receives the cookie → 403 → frontend `resetTurnstileSession()` → infinite Turnstile re-challenge loop. **Proven end-to-end** against the real router with an RFC-6265 cookie jar: `Set-Cookie: ...; HttpOnly; SameSite=Lax` (no Path) → `/api/search` with same jar = 403. Existing tests miss it because they hand-set the `Cookie` header (httptest doesn't enforce paths). Fix: add `Path: "/"` to the `http.Cookie` literal. (Only bites when Turnstile is enabled — which is the documented production config per `.env.example`.)

**2. MAJOR — `app.go:170` — `REDIS_URL` passed as literal `Addr`; go-redis v9 `NewClient` does not parse URLs.**
`redis.NewClient(&redis.Options{Addr: "redis://redis:6379/0"})` dials a host literally named `redis://redis:6379/0`. **Verified empirically** against the pinned v9.22.0: `dial tcp: address redis://127.0.0.1:1/0: too many colons in address`. In the compose deployment (which sets `REDIS_URL` and runs a redis container), ping always fails → silent in-memory rate-limit fallback: Redis container is dead weight and limits are per-container, not global, the moment you run >1 replica. Python's `Redis.from_url` parses correctly. Fix: `opts, err := redis.ParseURL(rawURL)` then `redis.NewClient(opts)`.

**3. MAJOR — `tle.go:65` — `extractCatnr` panics on malformed short TLE line1; no `recover()` anywhere.**
`line1[2:7]` panics when line1 is `"1 "` + <5 chars (verified: `"1 123"` → `slice bounds out of range`). Python's `line1[2:7]` is safe. There is no `recover()` in the codebase and no chi Recover middleware, so a malformed celestrak/satnogs line hitting the background `refreshSatellitesWorker` goroutine (`tle.go:284`, unguarded `go`) **crashes the whole process**; via `/api/satellite-lookup` it kills the connection mid-response. Fix: bounds-check (`if len(line1) < 7 { return nil }`) or `line1[2:min(7, len(line1))]`.

**4. MINOR (speculative) — `location.go:419-425` — `loadCountryIntel`: non-2xx on the first restcountries variant is fatal in Go; Python only treats exceptions as fatal and falls through to the second variant on non-ok status.**
Example: a name where `?fullText=true` 400s (ambiguous) but plain returns 200 → Python gets country intel, Go returns `{}`. Currently masked because restcountries v3.1 returns 200 for (nearly) everything, but the semantics diverge. Fix: on 4xx/404 continue the loop; only break-fatal on transport error.

**5. MINOR — `location.go:491` — `"timezones": item["timezones"]` emits JSON `null` when the key is absent; Python's `item.get("timezones") or []` emits `[]`.** Fix: default to `[]any{}`.

**6. MINOR — `main.go:174-176` — `/static/` serves a directory listing** (verified: contains `app.js`, `vendor/…`); Flask's `/static/<path:filename>` 404s. Minor info disclosure (filenames). Fix: wrap FileServer to 404 on `filepath.IsDir`, or serve via a handler that checks `os.Stat`.

**7. MINOR — `textutil.go:43` (and `dedupeText` keys, `satelliteDedupeKey` tle.go:76, exact-match checks location.go:218/322/350) — `strings.ToLower` vs Python `casefold()`.** Diverges on ß→ss, Σ→σ, ligatures — search/match behavior differs for non-ASCII place/satellite names. Edge-case; acceptable to leave.

**8. MINOR — `location.go:655-658` — Wikipedia summary: Go substitutes the requested title when the API returns `""`; Python's `payload.get("title", title)` keeps `""`.** Cosmetic edge case.

**9. MINOR (speculative) — `main.go:150-160` — trusted-hosts: Go strips the port before matching (Flask matches `host:port`) and supports no `*.example.com` wildcard hosts (Flask does).** If `TRUSTED_HOSTS` ever contains a wildcard (plausible for rotating tunnel subdomains), Go 400s everything. Fix: implement suffix wildcard match; keep port-stripping decision deliberate.

**10. MINOR (speculative) — `satellite.go:84` — space-track login + query share one 2.5 s timeout budget; Python allows 2.5 s each (5 s total).** Slow space-track logins fail more often in Go. Fix: separate timeouts per request.

**11. MINOR — `compose.yml:36-40` — `tunnel` service mounts the same `env_file: .env`, exposing `SECRET_KEY`, `TURNSTILE_SECRET_KEY`, and space-track credentials to the cloudflared container.** Fix: use `environment:` with only `TUNNEL_TOKEN`/tunnel vars, or a second env file.

**12. MINOR (known nits) — staticcheck:** SA6005 `EqualFold` at `location.go:218,321`; unused `wsRE` at `textutil.go:14`.

## Verified correct (no finding)

- **Numeric parity**: `pyRound`/`pyMod`/`floatParam` match Python `round`/`%`/`str` on a differential battery (ties-to-even, negative mod, ±180 wrap).
- **TLE parsing/dedupe/balanced subset**: structurally identical to Python, incl. `range(0, len-2, 3)` ↔ `idx+2 < len`, satnogs fallback field precedence, `NORAD %v` formatting.
- **Satcat merge precedence** (celestrak → space-track → `{}`), failure TTLs (5 min) vs success TTL (24 h), satnogs 24 h TTL — all match.
- **Rate-limit window math**: memory fixed-window reset/retry-`ceil`, Lua script byte-identical, 4096-entry prune, CF-Connecting-IP in production — all match.
- **Turnstile HMAC**: RawURLEncoding == `urlsafe_b64encode().rstrip(b"=")`, constant-time compare, expiry, `secure`/`HttpOnly`/`SameSite=Lax` all match (only Path differs — finding 1).
- **Concurrency**: `tleMu`/`countriesMu`/`rlMu` cover all shared state; slices replaced not mutated; LRU is mutex-guarded and correct; `cancelOnClose` cancels ctx on body close; refresh goroutine resets `refreshing` in defer (but see finding 3 for the panic case).
- **Templates**: only the 5 turnstile lines changed Jinja→Go delimiters; no leftover `{%`/`{{` in JS; no inline scripts so CSP holds; html/template auto-escaping matches Jinja's.
- **Dockerfile**: distroless/static:nonroot + fully-static busybox for the HTTP `/healthz` healthcheck (which trustedHosts intentionally exempts), `PORT=6666`, static/templates copied, `GUNICORN_BIND` still honored for old envs.
- **Service unit**: `ExecStart=/opt/satellite-chum/satellitechum`, `WorkingDirectory` set (templates/static resolve), `EnvironmentFile` mandatory (same as pre-rewrite unit — not a regression), `PORT=6666` matches gunicorn's old default bind.
- **JSON shape**: no `omitempty` on `SatelliteItem` (empty strings/`null` catnr match Python dicts); `[]`-not-`null` for items/source_groups; only `timezones` diverges (finding 5).
- `go test -race -count=1` green; `go vet`/build clean.

## Residual risks

- Finding 1 is invisible to header-based parity tests — it only shows in a real browser (or cookie-jar) E2E; recommend adding the cookie-jar test before shipping.
- Findings 2/3 are latent until multi-replica scale / malformed upstream TLE respectively.
- `ttlCache` (satcat/space-track/satnogs) is unbounded — but identical to the Python original, so not a regression.
- `loadCountryIntel`/`searchPlaces` etc. use `context.Background()` for outbound calls (like Python); request ctx is only used on the satcat path, where a client disconnect now caches a 5-min failure (speculative, low impact).

## Verdict: **FIX-FIRST**

One true blocker (cookie `Path`) for the Turnstile-enabled production config, plus two majors worth the same commit. All fixes are ≤3 lines each. If Turnstile is currently disabled in the live deployment, this downgrades to SHIP-WITH-NITS.