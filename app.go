package main

import (
	"context"
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

var (
	celestrakVisualURL   = "https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle"
	celestrakStationsURL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle"
	celestrakActiveURL   = "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle"
	satnogsTLEURL        = "https://db.satnogs.org/api/tle/"
	satnogsSatellitesURL = "https://db.satnogs.org/api/satellites/"
	celestrakSatcatURL   = "https://celestrak.org/satcat/records.php"
	spaceTrackLoginURL   = "https://www.space-track.org/ajaxauth/login"
	spaceTrackSatcatURL  = "https://www.space-track.org/basicspacedata/query/class/satcat/norad_cat_id/%d/format/json"
	countriesGeoJSONURL  = "https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json"
	bigdatacloudReverse  = "https://api.bigdatacloud.net/data/reverse-geocode-client"
	worldBankIndicator   = "https://api.worldbank.org/v2/country/%s/indicator/SP.POP.TOTL"
	openMeteoSearch      = "https://geocoding-api.open-meteo.com/v1/search"
	wikidataAPI          = "https://www.wikidata.org/w/api.php"
	nominatimReverse     = "https://nominatim.openstreetmap.org/reverse"
	nominatimSearch      = "https://nominatim.openstreetmap.org/search"
	wikipediaAPI         = "https://en.wikipedia.org/w/api.php"
	wikipediaSummary     = "https://en.wikipedia.org/api/rest_v1/page/summary/%s"
	restCountriesName    = "https://restcountries.com/v3.1/name/%s"
	turnstileVerifyURL   = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
)

const (
	tleCacheTTL    = 60 * 30
	satcatCacheTTL = 60 * 60 * 24
	satcatFailTTL  = 60 * 5
	earthRadiusKm  = 6371.0
	searchMax      = 80
)

var celestrakGroupURLs = [][2]string{
	{"visual", celestrakVisualURL},
	{"stations", celestrakStationsURL},
	{"active", celestrakActiveURL},
}

// App holds all server state: config, HTTP client, optional Redis, and the
// caches that mirror app.py's module-level state.
type App struct {
	cfg    Config
	http   *http.Client
	redis  *redis.Client
	logger *slog.Logger
	tmpl   *template.Template

	tleMu      sync.Mutex
	tleCache   tleCacheState
	satcat     *ttlCache
	spaceTrack *ttlCache
	satnogs    *ttlCache

	countriesMu    sync.Mutex
	countriesCache struct {
		fetchedAt float64
		items     []map[string]any
	}

	rlMu    sync.Mutex
	rlState map[rlKey]rlEntry

	// LRU caches (sizes mirror app.py lru_cache maxsize values).
	geoCountry    *lruCache[latlonKey, map[string]any]
	geoPlace      *lruCache[latlonKey, map[string]any]
	geoBigdata    *lruCache[latlonKey, map[string]any]
	worldBank     *lruCache[string, map[string]any]
	omCountry     *lruCache[string, map[string]any]
	omPlace       *lruCache[omPlaceKey, map[string]any]
	wikidataFacts *lruCache[string, map[string]any]
	countryIntel  *lruCache[string, map[string]any]
	wikiTitles    *lruCache[wikiSearchKey, []string]
	wikiSummary   *lruCache[string, map[string]any]
	landmarks     *lruCache[latlonKey, []map[string]any]
}

type latlonKey struct{ lat, lon float64 }

type omPlaceKey struct {
	name, country string
	lat, lon      float64
}

type wikiSearchKey struct {
	query string
	limit int
}

type tleCacheState struct {
	fetchedAt    float64
	items        []SatelliteItem
	source       string
	sourceGroups []string
	refreshing   bool
	lastError    string
	lastAttempt  float64
}

func newApp(cfg Config) *App {
	a := &App{
		cfg:           cfg,
		http:          &http.Client{},
		logger:        slog.Default(),
		rlState:       map[rlKey]rlEntry{},
		geoCountry:    newLRUCache[latlonKey, map[string]any](512),
		geoPlace:      newLRUCache[latlonKey, map[string]any](2048),
		geoBigdata:    newLRUCache[latlonKey, map[string]any](2048),
		worldBank:     newLRUCache[string, map[string]any](512),
		omCountry:     newLRUCache[string, map[string]any](256),
		omPlace:       newLRUCache[omPlaceKey, map[string]any](512),
		wikidataFacts: newLRUCache[string, map[string]any](256),
		countryIntel:  newLRUCache[string, map[string]any](256),
		wikiTitles:    newLRUCache[wikiSearchKey, []string](512),
		wikiSummary:   newLRUCache[string, map[string]any](512),
		landmarks:     newLRUCache[latlonKey, []map[string]any](512),
	}
	a.satcat = newTTLCache()
	a.spaceTrack = newTTLCache()
	a.satnogs = newTTLCache()
	a.tleCache = tleCacheState{source: "empty", sourceGroups: []string{}, items: []SatelliteItem{}}
	a.countriesCache.items = []map[string]any{}
	return a
}

// resetCaches clears all cached state (test helper mirroring app.py setUp).
func (a *App) resetCaches() {
	a.tleMu.Lock()
	a.tleCache = tleCacheState{source: "empty", sourceGroups: []string{}, items: []SatelliteItem{}}
	a.tleMu.Unlock()
	a.satcat = newTTLCache()
	a.spaceTrack = newTTLCache()
	a.satnogs = newTTLCache()
	a.geoCountry = newLRUCache[latlonKey, map[string]any](512)
	a.geoPlace = newLRUCache[latlonKey, map[string]any](2048)
	a.geoBigdata = newLRUCache[latlonKey, map[string]any](2048)
	a.worldBank = newLRUCache[string, map[string]any](512)
	a.omCountry = newLRUCache[string, map[string]any](256)
	a.omPlace = newLRUCache[omPlaceKey, map[string]any](512)
	a.wikidataFacts = newLRUCache[string, map[string]any](256)
	a.countryIntel = newLRUCache[string, map[string]any](256)
	a.wikiTitles = newLRUCache[wikiSearchKey, []string](512)
	a.wikiSummary = newLRUCache[string, map[string]any](512)
	a.landmarks = newLRUCache[latlonKey, []map[string]any](512)
}

func (a *App) initRedis() {
	if a.redis != nil {
		return
	}
	rawURL := envValue("REDIS_URL", "")
	if rawURL == "" {
		return
	}
	client := redis.NewClient(&redis.Options{Addr: rawURL, DialTimeout: 2 * time.Second})
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		a.logger.Warn("Redis unavailable, using in-memory rate limiting", "err", err)
		return
	}
	a.redis = client
}

// cancelOnClose cancels the request context when the response body is
// closed, so the timeout bounds the whole read without cancelling a body
// that is still being decoded.
type cancelOnClose struct {
	io.ReadCloser
	cancel context.CancelFunc
}

func (c cancelOnClose) Close() error {
	err := c.ReadCloser.Close()
	c.cancel()
	return err
}

// httpGet issues a GET with the app user agent and a per-call timeout.
func (a *App) httpGet(ctx context.Context, rawURL string, q url.Values, timeout time.Duration) (*http.Response, error) {
	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	u := rawURL
	if q != nil {
		u += "?" + q.Encode()
	}
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, u, nil)
	if err != nil {
		cancel()
		return nil, err
	}
	req.Header.Set("User-Agent", a.cfg.UserAgent)
	resp, err := a.http.Do(req)
	if err != nil {
		cancel()
		return nil, err
	}
	resp.Body = cancelOnClose{ReadCloser: resp.Body, cancel: cancel}
	return resp, nil
}

// httpGetJSON fetches a URL and decodes the JSON body into out.
func (a *App) httpGetJSON(ctx context.Context, rawURL string, q url.Values, timeout time.Duration, out any) error {
	resp, err := a.httpGet(ctx, rawURL, q, timeout)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("http %d for %s", resp.StatusCode, rawURL)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func (a *App) reqTimeout() time.Duration {
	return time.Duration(a.cfg.RequestTimeoutSeconds) * time.Second
}

func jsonDecode(resp *http.Response, out any) error {
	return json.NewDecoder(resp.Body).Decode(out)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func (a *App) tleTimeout() time.Duration {
	return time.Duration(a.cfg.TLETimeout * float64(time.Second))
}

func (a *App) satcatTimeout() time.Duration {
	return time.Duration(a.cfg.SatcatTimeout * float64(time.Second))
}

// floatParam formats a float the way Python's str() does (shortest repr).
func floatParam(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }

// pyRound mirrors Python's round() (ties to even) for query param formatting.
func pyRound(v float64, nd int) float64 {
	s, _ := strconv.ParseFloat(strconv.FormatFloat(v, 'f', nd, 64), 64)
	return s
}

// strOf returns the string value for a map key, or "" when absent/non-string.
func strOf(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

// truthy mirrors Python truthiness for common JSON value shapes.
func truthy(v any) bool {
	switch t := v.(type) {
	case nil:
		return false
	case bool:
		return t
	case string:
		return t != ""
	case float64:
		return t != 0
	case []any:
		return len(t) > 0
	case map[string]any:
		return len(t) > 0
	default:
		return true
	}
}
