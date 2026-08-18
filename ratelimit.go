package main

import (
	"context"
	"fmt"
	"math"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

type rlKey struct{ endpoint, ip string }

type rlEntry struct {
	windowStart float64
	count       int
}

const rateLimitLua = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
    redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
    redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
    ttl = tonumber(ARGV[1])
end
return {count, ttl}
`

var rateLimitScript = redis.NewScript(rateLimitLua)

func (a *App) clientIP(r *http.Request) string {
	if a.cfg.Production {
		if v := strings.TrimSpace(r.Header.Get("CF-Connecting-IP")); v != "" {
			return v
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if host = strings.TrimSpace(host); host == "" {
		return "unknown"
	}
	return host
}

func (a *App) rateLimitMemory(endpoint, ip string, limit int) (int, int, int, bool) {
	window := a.cfg.RateLimitWindow
	now := float64(time.Now().Unix())
	a.rlMu.Lock()
	defer a.rlMu.Unlock()
	if len(a.rlState) > 4096 {
		for key, e := range a.rlState {
			if now-e.windowStart >= float64(window) {
				delete(a.rlState, key)
			}
		}
	}
	key := rlKey{endpoint: endpoint, ip: ip}
	e, ok := a.rlState[key]
	if !ok || now-e.windowStart >= float64(window) {
		e = rlEntry{windowStart: now, count: 0}
		a.rlState[key] = e
	}
	if e.count >= limit {
		retry := int(math.Ceil(float64(window) - (now - e.windowStart)))
		if retry < 1 {
			retry = 1
		}
		return retry, limit, window, true
	}
	e.count++
	a.rlState[key] = e
	return 0, 0, 0, false
}

func (a *App) rateLimitRedis(ctx context.Context, endpoint, ip string, limit int) (int, int, int, bool) {
	key := fmt.Sprintf("rl:%s:%s", endpoint, ip)
	resAny, err := rateLimitScript.Run(ctx, a.redis, []string{key}, a.cfg.RateLimitWindow).Result()
	if err != nil {
		a.logger.Warn("Redis rate limit error, falling back to memory", "err", err)
		return a.rateLimitMemory(endpoint, ip, limit)
	}
	res, _ := resAny.([]any)
	if len(res) < 2 {
		return a.rateLimitMemory(endpoint, ip, limit)
	}
	count, _ := res[0].(int64)
	ttl, _ := res[1].(int64)
	if count > int64(limit) {
		retry := int(ttl)
		if retry < 1 {
			retry = 1
		}
		return retry, limit, a.cfg.RateLimitWindow, true
	}
	return 0, 0, 0, false
}

// limited wraps a handler with the per-endpoint rate limit (app.py
// enforce_rate_limits before_request hook).
func (a *App) limited(endpoint string, next func(http.ResponseWriter, *http.Request)) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, r *http.Request) {
		limit := a.cfg.RateLimits[endpoint]
		if limit > 0 {
			ip := a.clientIP(r)
			var retry, lim, window int
			var exceeded bool
			if a.redis != nil {
				retry, lim, window, exceeded = a.rateLimitRedis(r.Context(), endpoint, ip, limit)
			} else {
				retry, lim, window, exceeded = a.rateLimitMemory(endpoint, ip, limit)
			}
			if exceeded {
				w.Header().Set("Retry-After", strconv.Itoa(retry))
				writeJSON(w, 429, map[string]any{
					"error":          "rate limit exceeded",
					"limit":          lim,
					"window_seconds": window,
					"retry_after":    retry,
				})
				return
			}
		}
		next(w, r)
	}
}
