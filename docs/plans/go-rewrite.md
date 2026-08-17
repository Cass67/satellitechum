# Go Rewrite — satellite-chum

Status: done (2026-08-17). Reference implementation: `../uavchum` (already Go + distroless).

Parity verified against the Python app: all 10 API routes diffed side by side
(JSON-identical; index.html differs by one trailing newline from Jinja's
newline trimming). Turnstile 403/session flows match. distroless image built
(25.6 MB) and compose stack (redis + app + healthcheck) runs healthy.

## Feasibility

Yes. The app is a single-file Flask service (2,277 lines) with 10 routes, plain
HTTP/JSON, one background refresher thread, Redis-optional rate limiting, and a
single Jinja template with one variable. Frontend (static/app.js, style.css,
vendor libs, globe assets) is untouched — served as-is. No WebSockets, no
extensions, no gunicorn-specific behavior.

## Feature inventory to port (source: app.py)

1. **Routes**
   - `GET /` — index.html with `turnstile_site_key` injected
   - `GET /api/satellites` — TLE cache (items, fetched_at, source, source_groups, refreshing, last_error)
   - `GET /api/turnstile/session` — verify Turnstile token, set HMAC-signed session cookie
   - `GET /api/country` — reverse geocode country (BigDataCloud)
   - `GET /api/location-label` — reverse geocode place (BigDataCloud + Open-Meteo fallback)
   - `GET /api/search` — place search (Open-Meteo geocoding + Wikipedia)
   - `GET /api/satellite-lookup/<int:catnr>` — TLE item by NORAD id
   - `GET /api/countries` — country labels from GeoJSON
   - `GET /api/location-intel` — country intel (World Bank pop, Open-Meteo profile, Wikidata facts) + place reference (Wikipedia) + nearby landmarks
   - `GET /api/satellite/<int:catnr>` — details: Celestrak satcat → space-track fallback → SatNOGS → Wikipedia reference → profile inference (`infer_satellite_profile`, ~350 lines of heuristics) → field sources + confidence
2. **TLE pipeline** — Celestrak group fetch (visual/stations/active), SatNOGS TLE, parse,
   dedupe/merge, balanced subset (`SATELLITECHUM_MAX_SATELLITES`), fallback TLEs,
   background refresh worker with TTLs and failure TTLs.
3. **Rate limiting** — per-endpoint limits, memory + Redis backends, pruning,
   429 with `Retry-After` and JSON body.
4. **Turnstile** — token verify via Cloudflare API, HMAC-SHA256 signed session
   cookie with expiry, production env validation (site+secret keys must be set together).
5. **Middleware** — ProxyFix (X-Forwarded-Proto/Host), security headers (CSP,
   COOP/COEP-ish set, etc.), `no-store` cache headers.
6. **Config** — env vars + `.env` file loader (see `_load_dotenv_file`/`_env_value`),
   `SATELLITECHUM_ENV=production` checks, `SECRET_KEY` required in production.

## Go stack

- Go 1.26, `CGO_ENABLED=0`
- `github.com/go-chi/chi/v5` — router (same as uavchum)
- `github.com/redis/go-redis/v9` — Redis rate limiting (memory fallback when unset)
- stdlib `net/http`, `encoding/json`, `html/template`, `crypto/hmac`, `net/url`
- No CGO, no cgo-linked deps

## Step-by-step

- [x] 1. **Scaffold** — `go.mod`, `config.go` (env + .env loader, production
      validation), `main.go` (chi router, ProxyFix equivalent via
      `X-Forwarded-*` handling, security-header middleware, graceful shutdown,
      `PORT`/`GUNICORN_BIND` env).
- [x] 2. **TLE module** (`tle.go`) — Celestrak + SatNOGS fetch, TLE parse,
      dedupe/merge, balanced subset, fallback TLEs, background refresh goroutine
      with TTL/failure-TTL semantics matching Python exactly.
- [x] 3. **Rate limiter** (`ratelimit.go`) — sliding window, memory + Redis
      backend, per-endpoint limits, 429 JSON + Retry-After.
- [x] 4. **Turnstile** (`turnstile.go`) — token verification, signed session
      cookie, `_require_turnstile` guard for gated routes.
- [x] 5. **Location APIs** (`location.go`) — country reverse geocode, place
      label, country intel (World Bank / Open-Meteo / Wikidata), place
      reference, nearby landmarks, search.
- [x] 6. **Satellite details** (`satellite.go`) — Celestrak satcat, space-track
      (login + query), SatNOGS, Wikipedia reference, `infer_satellite_profile`
      heuristics port, field sources + confidence scoring.
- [x] 7. **Frontend** — serve `static/` and `templates/index.html` via
      `html/template` (replace `{{ turnstile_site_key }}` with `{{ .TurnstileSiteKey }}`
      — single variable, trivial).
- [x] 8. **Tests** — port `tests/test_location_intel.py` (377 lines) to Go table
      tests; add unit tests for TLE parse, rate limiter, turnstile cookie,
      profile inference. uavchum has `_test.go` patterns to copy.
- [x] 9. **Dockerfile** — mirror uavchum: `golang:1.26` builder
      (`CGO_ENABLED=0`, `-ldflags="-s -w"`) → `gcr.io/distroless/static:nonroot`
      with static busybox for healthcheck, `COPY static/ templates/`.
- [x] 10. **compose.yml** — swap app build; healthcheck → busybox
      `wget -qO- http://localhost:6666/` (or TCP via busybox); keep redis +
      cloudflared services; drop `GUNICORN_*` env, use `PORT=6666`.
- [x] 11. **Deploy** — verify `deploy/` (ansible, systemd unit, podman compose
      service) works unchanged against new image; update any
      gunicorn/python references.
- [x] 12. **Parity check** — run Python and Go side by side; diff API responses
      for all 10 routes (satellite details is the hairy one — compare
      `field_sources`/`source_confidence` JSON exactly).
- [x] 13. **Ship** — delete Python (`app.py`, `requirements.txt`,
      `gunicorn.conf.py`, `.venv`) once parity passes; update README +
      `.pre-commit-config.yaml` (add golangci-lint/go hooks if desired);
      merge to main.

## Risks

- `infer_satellite_profile` is a big heuristic block — port line-by-line,
  diff outputs against Python for a sample of catnrs.
- Redis rate-limit key format/semantics must match if a live Redis is shared
  during cutover (fresh keys fine if not).
- `.env` loader behavior (precedence vs real env) — replicate exactly.
