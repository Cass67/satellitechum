package main

import (
	"html/template"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// newTestApp builds an App with no rate limits and fresh caches.
func newTestApp(t *testing.T) *App {
	t.Helper()
	cfg := Config{
		Production:            false,
		UserAgent:             "test",
		RateLimitWindow:       60,
		RateLimits:            map[string]int{},
		MaxSatellites:         0,
		SatnogsPageSize:       20000,
		RequestTimeoutSeconds: 5,
		TLETimeout:            5,
		SatcatTimeout:         5,
	}
	oldDotEnv := dotEnvValues
	dotEnvValues = map[string]string{}
	t.Cleanup(func() { dotEnvValues = oldDotEnv })

	a := newApp(cfg)
	tmpl, err := template.ParseFiles("templates/index.html")
	if err != nil {
		t.Fatalf("parse template: %v", err)
	}
	a.tmpl = tmpl
	t.Cleanup(a.resetCaches)
	return a
}

// overrideURL temporarily repoints a package-level URL variable at a test
// server and restores it afterwards.
func overrideURL(t *testing.T, current *string, value string) {
	t.Helper()
	old := *current
	*current = value
	t.Cleanup(func() { *current = old })
}

// noResultsServer stubs nominatim (empty list) and open-meteo (empty results).
func noResultsServer(t *testing.T) *httptest.Server {
	t.Helper()
	return stubServer(t, func(path, query string) (int, string) {
		if strings.Contains(query, "q=") {
			return 200, "[]"
		}
		return 200, `{"results":[]}`
	})
}

func stubSearchURLs(t *testing.T) {
	t.Helper()
	srv := noResultsServer(t)
	overrideURL(t, &nominatimSearch, srv.URL+"/search")
	overrideURL(t, &openMeteoSearch, srv.URL+"/search")
}

// stubServer starts an httptest server with a path router.
func stubServer(t *testing.T, handler func(path, query string) (int, string)) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		status, body := handler(r.URL.Path, r.URL.RawQuery)
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return srv
}
