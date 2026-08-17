package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func newTurnstileTestApp(t *testing.T, siteKey, secretKey string) *App {
	t.Helper()
	a := newTestApp(t)
	a.cfg.TurnstileSiteKey = siteKey
	a.cfg.TurnstileSecretKey = secretKey
	return a
}

func doReq(t *testing.T, a *App, method, target string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, target, nil)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	a.router().ServeHTTP(rec, req)
	return rec
}

func TestTurnstileAcceptsValidSessionCookieWithoutToken(t *testing.T) {
	stubSearchURLs(t)
	a := newTurnstileTestApp(t, "test-site", "test-secret")
	cookieValue := turnstileSessionValue("test-secret", time.Now().Unix()+3600)
	rec := doReq(t, a, http.MethodGet, "/api/search?q=London", map[string]string{
		"Cookie": turnstileCookieName + "=" + cookieValue,
	})
	if rec.Code != 200 {
		t.Errorf("status = %d", rec.Code)
	}
}

func TestTurnstileGuardRejectsRawTokenWithoutSessionCookie(t *testing.T) {
	a := newTurnstileTestApp(t, "test-site", "test-secret")
	rec := doReq(t, a, http.MethodGet, "/api/search?q=London", map[string]string{
		"X-Turnstile-Token": "raw-token",
	})
	if rec.Code != 403 {
		t.Errorf("status = %d, want 403 (guard only accepts session cookies)", rec.Code)
	}
}

func TestIndexHidesTurnstileWhenSecretKeyMissing(t *testing.T) {
	a := newTurnstileTestApp(t, "test-site", "")
	rec := doReq(t, a, http.MethodGet, "/", nil)
	if rec.Code != 200 {
		t.Fatalf("status = %d", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "cf-turnstile") {
		t.Error("cf-turnstile widget present without secret key")
	}
}

func TestTurnstileSessionEndpointSetsCookieForGuardedRoutes(t *testing.T) {
	var verifyCalls atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		verifyCalls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success": true}`))
	}))
	t.Cleanup(srv.Close)
	overrideURL(t, &turnstileVerifyURL, srv.URL+"/siteverify")

	a := newTurnstileTestApp(t, "test-site", "test-secret")
	rec := doReq(t, a, http.MethodGet, "/api/turnstile/session", map[string]string{
		"X-Turnstile-Token": "raw-token",
	})
	if rec.Code != 200 {
		t.Fatalf("status = %d", rec.Code)
	}
	var cookieHeader string
	for _, h := range rec.Header().Values("Set-Cookie") {
		if strings.Contains(h, turnstileCookieName+"=") {
			cookieHeader = h
		}
	}
	if cookieHeader == "" {
		t.Fatal("no turnstile session cookie set")
	}
	if got := verifyCalls.Load(); got != 1 {
		t.Errorf("verify calls = %d, want 1", got)
	}

	stubSearchURLs(t)
	cookieValue := strings.TrimPrefix(strings.SplitN(cookieHeader, ";", 2)[0], turnstileCookieName+"=")
	rec2 := doReq(t, a, http.MethodGet, "/api/search?q=London", map[string]string{
		"Cookie": turnstileCookieName + "=" + cookieValue,
	})
	if rec2.Code != 200 {
		t.Errorf("guarded route with cookie: status = %d", rec2.Code)
	}
	if got := verifyCalls.Load(); got != 1 {
		t.Errorf("verify calls = %d, want 1 (cookie should not re-verify)", got)
	}
}

func TestValidTurnstileSessionRejectsExpired(t *testing.T) {
	a := newTurnstileTestApp(t, "test-site", "test-secret")
	value := turnstileSessionValue("test-secret", time.Now().Unix()-10)
	if a.validTurnstileSession(value) {
		t.Error("expired session accepted")
	}
}
