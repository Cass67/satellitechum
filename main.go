package main

import (
	"context"
	"errors"
	"fmt"
	"html/template"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
)

type ctxKey int

const (
	ctxScheme ctxKey = iota
	ctxHost
)

func main() {
	cfg, err := loadConfig()
	if err != nil {
		slog.Error("config", "err", err)
		os.Exit(1)
	}
	a := newApp(cfg)
	a.initRedis()

	tmpl, err := template.ParseFiles("templates/index.html")
	if err != nil {
		slog.Error("template", "err", err)
		os.Exit(1)
	}
	a.tmpl = tmpl

	srv := &http.Server{
		Addr:              cfg.Bind,
		Handler:           a.router(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
		<-sig
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()
	slog.Info("satellite-chum listening", "addr", cfg.Bind, "production", cfg.Production)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("server", "err", err)
		os.Exit(1)
	}
}

// router wires all routes (also used by tests).
func (a *App) router() *chi.Mux {
	r := chi.NewRouter()
	r.Use(a.proxyFix)
	r.Use(a.securityHeaders)
	r.Use(a.trustedHosts)
	// Host header is not enforced on /healthz so the container healthcheck
	// works (see trustedHosts).
	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte("ok"))
	})
	r.Get("/", a.handleIndex)
	r.Get("/static/*", a.handleStatic)
	r.Get("/api/satellites", a.limited("satellites", a.handleSatellites))
	r.Get("/api/turnstile/session", a.handleTurnstileSession)
	r.Get("/api/country", a.limited("country", a.handleCountry))
	r.Get("/api/location-label", a.limited("location_label", a.handleLocationLabel))
	r.Get("/api/search", a.limited("search", a.handleSearch))
	r.Get("/api/satellite-lookup/{catnr}", a.limited("satellite_lookup", a.handleSatelliteLookup))
	r.Get("/api/countries", a.limited("countries", a.handleCountries))
	r.Get("/api/location-intel", a.limited("location_intel", a.handleLocationIntel))
	r.Get("/api/satellite/{catnr}", a.limited("satellite_details", a.handleSatelliteDetails))
	return r
}

// proxyFix mirrors werkzeug ProxyFix(x_proto=1, x_host=1): honor the first
// X-Forwarded-Proto / X-Forwarded-Host hop.
func (a *App) proxyFix(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		scheme := "http"
		if r.TLS != nil {
			scheme = "https"
		}
		if proto := r.Header.Get("X-Forwarded-Proto"); proto != "" {
			scheme = strings.ToLower(strings.TrimSpace(strings.Split(proto, ",")[0]))
		}
		host := r.Host
		if fh := r.Header.Get("X-Forwarded-Host"); fh != "" {
			host = strings.TrimSpace(strings.Split(fh, ",")[0])
		}
		ctx := context.WithValue(r.Context(), ctxScheme, scheme)
		ctx = context.WithValue(ctx, ctxHost, host)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func requestScheme(r *http.Request) string {
	if s, ok := r.Context().Value(ctxScheme).(string); ok {
		return s
	}
	return "http"
}

func requestHost(r *http.Request) string {
	if s, ok := r.Context().Value(ctxHost).(string); ok {
		return s
	}
	return r.Host
}

func (a *App) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Cache-Control", "no-store")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("Permissions-Policy", "geolocation=(self), microphone=(), camera=(), clipboard-write=(self)")
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		h.Set("Cross-Origin-Resource-Policy", "same-origin")
		h.Set("X-XSS-Protection", "0")
		h.Set("Content-Security-Policy",
			"default-src 'self'; "+
				"img-src 'self' data: https:; "+
				"style-src 'self'; "+
				"font-src 'self'; "+
				"script-src 'self' https://challenges.cloudflare.com; "+
				"connect-src 'self' https://challenges.cloudflare.com; "+
				"frame-src https://challenges.cloudflare.com; "+
				"object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'")
		next.ServeHTTP(w, r)
	})
}

// trustedHosts mirrors Flask's TRUSTED_HOSTS enforcement in match_request.
func (a *App) trustedHosts(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/healthz" && len(a.cfg.TrustedHosts) > 0 {
			host := requestHost(r)
			if h, _, err := net.SplitHostPort(host); err == nil {
				host = h
			}
			host = strings.ToLower(host)
			matched := false
			for _, trusted := range a.cfg.TrustedHosts {
				trusted = strings.ToLower(trusted)
				// Flask's trusted_hosts also accepts *.example.com wildcards.
				if strings.HasPrefix(trusted, "*.") {
					if strings.HasSuffix(host, trusted[1:]) || host == trusted[2:] {
						matched = true
						break
					}
					continue
				}
				if trusted == host {
					matched = true
					break
				}
			}
			if !matched {
				http.Error(w, fmt.Sprintf("The request URI's host was not one of the trusted hosts for this application (%s).", strings.Join(a.cfg.TrustedHosts, ", ")), 400)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (a *App) handleStatic(w http.ResponseWriter, r *http.Request) {
	// Flask's /static/<path:filename> 404s on directories; http.FileServer
	// would show a listing. Match Flask.
	path := strings.TrimPrefix(r.URL.Path, "/static/")
	if info, err := os.Stat(filepath.Join("static", filepath.Clean("/"+path))); err == nil && info.IsDir() {
		http.NotFound(w, r)
		return
	}
	http.StripPrefix("/static/", http.FileServer(http.Dir("static"))).ServeHTTP(w, r)
}

func (a *App) handleIndex(w http.ResponseWriter, r *http.Request) {
	siteKey := ""
	if a.turnstileEnabled() {
		siteKey = a.cfg.TurnstileSiteKey
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := a.tmpl.ExecuteTemplate(w, "index.html", map[string]string{
		"TurnstileSiteKey": siteKey,
	}); err != nil {
		slog.Error("render index", "err", err)
	}
}

func (a *App) handleSatellites(w http.ResponseWriter, r *http.Request) {
	items := a.loadSatellites()
	a.tleMu.Lock()
	payload := map[string]any{
		"items":         items,
		"fetched_at":    int(a.tleCache.fetchedAt),
		"source":        a.tleCache.source,
		"source_groups": a.tleCache.sourceGroups,
		"refreshing":    a.tleCache.refreshing,
		"last_error":    a.tleCache.lastError,
	}
	a.tleMu.Unlock()
	writeJSON(w, 200, payload)
}

func (a *App) handleTurnstileSession(w http.ResponseWriter, r *http.Request) {
	ok, msg := a.requireTurnstileToken(r.Context(), r)
	if !ok {
		writeJSON(w, 403, map[string]any{"error": msg})
		return
	}
	if a.turnstileEnabled() {
		a.setTurnstileSessionCookie(w, requestScheme(r) == "https")
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

// parseFiniteLatLon mirrors app.py _parse_finite_lat_lon.
func parseFiniteLatLon(r *http.Request) (float64, float64, bool) {
	latStr := r.URL.Query().Get("lat")
	lonStr := r.URL.Query().Get("lon")
	lat, err1 := strconv.ParseFloat(latStr, 64)
	lon, err2 := strconv.ParseFloat(lonStr, 64)
	if err1 != nil || err2 != nil || !isFinite(lat) || !isFinite(lon) {
		return 0, 0, false
	}
	return lat, lon, true
}

func (a *App) handleCountry(w http.ResponseWriter, r *http.Request) {
	lat, lon, ok := parseFiniteLatLon(r)
	if !ok {
		writeJSON(w, 400, map[string]any{"error": "finite lat and lon are required"})
		return
	}
	latRound := pyRound(clamp(lat, -90, 90), 1)
	lonRound := pyRound(pyMod(lon+180, 360)-180, 1)
	writeJSON(w, 200, a.reverseGeocodeCountry(latRound, lonRound))
}

func (a *App) handleLocationLabel(w http.ResponseWriter, r *http.Request) {
	lat, lon, ok := parseFiniteLatLon(r)
	if !ok {
		writeJSON(w, 400, map[string]any{"error": "finite lat and lon are required"})
		return
	}
	latRound := pyRound(clamp(lat, -90, 90), 2)
	lonRound := pyRound(pyMod(lon+180, 360)-180, 2)
	writeJSON(w, 200, a.reverseGeocodePlace(latRound, lonRound))
}

func (a *App) handleSearch(w http.ResponseWriter, r *http.Request) {
	ok, msg := a.requireTurnstile(r)
	if !ok {
		writeJSON(w, 403, map[string]any{"error": msg})
		return
	}
	query := r.URL.Query().Get("q")
	writeJSON(w, 200, map[string]any{"items": a.searchPlaces(query)})
}

func (a *App) handleSatelliteLookup(w http.ResponseWriter, r *http.Request) {
	ok, msg := a.requireTurnstile(r)
	if !ok {
		writeJSON(w, 403, map[string]any{"error": msg})
		return
	}
	catnr, err := strconv.Atoi(chi.URLParam(r, "catnr"))
	if err != nil {
		writeJSON(w, 404, map[string]any{"error": "Not found"})
		return
	}
	item, found := a.loadSatelliteByCatnr(r.Context(), catnr)
	if !found {
		writeJSON(w, 404, map[string]any{"error": fmt.Sprintf("No satellite TLE found for NORAD %d", catnr)})
		return
	}
	writeJSON(w, 200, item)
}

func (a *App) handleCountries(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"items": a.loadCountryLabels(r.Context())})
}

func (a *App) handleLocationIntel(w http.ResponseWriter, r *http.Request) {
	ok, msg := a.requireTurnstile(r)
	if !ok {
		writeJSON(w, 403, map[string]any{"error": msg})
		return
	}
	name := strings.TrimSpace(r.URL.Query().Get("name"))
	country := strings.TrimSpace(r.URL.Query().Get("country"))
	lat, lon, finite := parseFiniteLatLon(r)
	if name == "" || !finite {
		writeJSON(w, 400, map[string]any{"error": "name, finite lat, and finite lon are required"})
		return
	}
	writeJSON(w, 200, a.buildLocationIntel(name, country, lat, lon))
}

func (a *App) handleSatelliteDetails(w http.ResponseWriter, r *http.Request) {
	ok, msg := a.requireTurnstile(r)
	if !ok {
		writeJSON(w, 403, map[string]any{"error": msg})
		return
	}
	catnr, err := strconv.Atoi(chi.URLParam(r, "catnr"))
	if err != nil {
		writeJSON(w, 404, map[string]any{"error": "Not found"})
		return
	}
	fallbackName := strings.TrimSpace(r.URL.Query().Get("name"))
	ctx := r.Context()

	details := a.loadSatcatDetails(ctx, catnr)
	if len(details) > 0 {
		details = mergeMaps(details, map[string]any{"__source": "celestrak"})
	} else {
		spaceTrack := a.loadSpaceTrackSatcatDetails(ctx, catnr)
		if len(spaceTrack) > 0 {
			details = mergeMaps(spaceTrack, map[string]any{"__source": "space-track"})
		} else {
			details = map[string]any{}
		}
	}
	satnogs := a.loadSatnogsSatellite(ctx, catnr)
	reference := a.loadSatelliteReference(fallbackName, satnogs)
	profile := inferSatelliteProfile(details, fallbackName)
	ownerLabel := profile.OwnerLabel
	operatorType := profile.OperatorType
	classificationSource := profile.ClassificationSource
	satnogsCountries := countryLabelsFromCodes(strOf(satnogs, "countries"))
	satnogsName := strOf(satnogs, "name")
	if ownerLabel == "" && len(satnogsCountries) > 0 {
		ownerLabel = strings.Join(satnogsCountries, ", ")
	}
	if classificationSource == "Name heuristic (satcat unavailable)" && len(satnogs) > 0 {
		classificationSource = "SatNOGS DB + Name heuristic"
	}
	if operatorType == "Unspecified" && strOf(satnogs, "website") != "" {
		operatorType = "Cataloged operator / mission source"
	}
	fieldSources := satelliteFieldSources(details, satnogs, reference, profile, ownerLabel, operatorType)
	confidence := satelliteConfidence(fieldSources)

	launchDate := strOf(details, "LAUNCH_DATE")
	if launchDate == "" {
		launchDate = compactISODate(strOf(satnogs, "launched"))
	}
	objectName := strOf(details, "OBJECT_NAME")
	if objectName == "" {
		objectName = firstString(satnogsName, fallbackName)
	}
	objectType := strOf(details, "OBJECT_TYPE")
	if objectType == "" {
		objectType = profile.ObjectType
	}
	summaryURL := strOf(reference, "content_url")
	if summaryURL == "" {
		summaryURL = strOf(satnogs, "website")
	}
	summarySource := ""
	if len(reference) > 0 {
		summarySource = "Wikipedia"
	} else if strOf(satnogs, "website") != "" {
		summarySource = "SatNOGS DB"
	}
	image := ""
	if img := strOf(satnogs, "image"); img != "" {
		image = "https://db.satnogs.org/media/" + img
	}

	writeJSON(w, 200, map[string]any{
		"purpose":               profile.Purpose,
		"object_name":           objectName,
		"object_id":             strOf(details, "OBJECT_ID"),
		"object_type":           objectType,
		"ops_status_code":       strOf(details, "OPS_STATUS_CODE"),
		"owner":                 strOf(details, "OWNER"),
		"owner_label":           ownerLabel,
		"operator_type":         operatorType,
		"classification_source": classificationSource,
		"launch_date":           launchDate,
		"deployed_date":         compactISODate(strOf(satnogs, "deployed")),
		"launch_site":           strOf(details, "LAUNCH_SITE"),
		"orbit_type":            strOf(details, "ORBIT_TYPE"),
		"period_minutes":        details["PERIOD"],
		"inclination_deg":       details["INCLINATION"],
		"apogee_km":             details["APOGEE"],
		"perigee_km":            details["PERIGEE"],
		"rcs":                   details["RCS"],
		"aliases":               cleanSatelliteAliases(strOf(satnogs, "names")),
		"website":               strOf(satnogs, "website"),
		"image":                 image,
		"countries":             satnogsCountries,
		"satnogs_status":        strOf(satnogs, "status"),
		"citation":              strOf(satnogs, "citation"),
		"summary":               strOf(reference, "summary"),
		"summary_url":           summaryURL,
		"summary_source":        summarySource,
		"field_sources":         fieldSources,
		"source_confidence":     confidence,
		"raw":                   details,
		"raw_satnogs":           satnogs,
	})
}
