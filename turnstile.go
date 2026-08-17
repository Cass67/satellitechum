package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	turnstileCookieName = "satellite_chum_turnstile"
	turnstileSessionTTL = 60 * 60 * 2
)

func (a *App) turnstileEnabled() bool {
	return a.cfg.TurnstileSiteKey != "" && a.cfg.TurnstileSecretKey != ""
}

func turnstileSessionValue(secret string, expiresAt int64) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(strconv.FormatInt(expiresAt, 10)))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return fmt.Sprintf("%d:%s", expiresAt, sig)
}

func (a *App) validTurnstileSession(value string) bool {
	if a.cfg.TurnstileSecretKey == "" || value == "" || !strings.Contains(value, ":") {
		return false
	}
	expiresRaw, sig, _ := strings.Cut(value, ":")
	expiresAt, err := strconv.ParseInt(expiresRaw, 10, 64)
	if err != nil {
		return false
	}
	if time.Now().Unix() > expiresAt {
		return false
	}
	expected := turnstileSessionValue(a.cfg.TurnstileSecretKey, expiresAt)
	_, expected, _ = strings.Cut(expected, ":")
	return hmac.Equal([]byte(sig), []byte(expected))
}

// setTurnstileSessionCookie mirrors app.py _set_turnstile_session_cookie.
func (a *App) setTurnstileSessionCookie(w http.ResponseWriter, secure bool) {
	expiresAt := time.Now().Unix() + turnstileSessionTTL
	secure = secure || a.cfg.SessionCookieSecure
	http.SetCookie(w, &http.Cookie{
		Name:     turnstileCookieName,
		Value:    turnstileSessionValue(a.cfg.TurnstileSecretKey, expiresAt),
		MaxAge:   turnstileSessionTTL,
		Expires:  time.Unix(expiresAt, 0).UTC(),
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})
}

// requireTurnstile mirrors app.py _require_turnstile (session cookie only).
func (a *App) requireTurnstile(r *http.Request) (bool, string) {
	if !a.turnstileEnabled() {
		return true, ""
	}
	if cookie, err := r.Cookie(turnstileCookieName); err == nil {
		if a.validTurnstileSession(cookie.Value) {
			return true, ""
		}
	}
	return false, "Turnstile verification required."
}

// requireTurnstileToken mirrors app.py _require_turnstile_token.
func (a *App) requireTurnstileToken(ctx context.Context, r *http.Request) (bool, string) {
	if !a.turnstileEnabled() {
		return true, ""
	}
	token := r.Header.Get("X-Turnstile-Token")
	if token == "" {
		token = r.URL.Query().Get("turnstile_token")
	}
	if token != "" && a.verifyTurnstileToken(ctx, token) {
		return true, ""
	}
	return false, "Turnstile verification required."
}

func (a *App) verifyTurnstileToken(ctx context.Context, token string) bool {
	if a.cfg.TurnstileSecretKey == "" || token == "" {
		return false
	}
	body, err := json.Marshal(map[string]string{
		"secret":   a.cfg.TurnstileSecretKey,
		"response": token,
	})
	if err != nil {
		return false
	}
	reqCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, turnstileVerifyURL, bytes.NewReader(body))
	if err != nil {
		return false
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := a.http.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return false
	}
	var payload map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return false
	}
	return truthy(payload["success"])
}
