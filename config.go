package main

import (
	"bufio"
	"log"
	"os"
	"strconv"
	"strings"
)

// Config holds all runtime configuration, resolved from the environment
// with an optional .env file fallback (mirroring app.py _env_value).
type Config struct {
	Bind                  string
	Production            bool
	TurnstileSiteKey      string
	TurnstileSecretKey    string
	SecretKey             string
	SessionCookieSecure   bool
	TrustedHosts          []string
	RateLimitWindow       int
	RateLimits            map[string]int
	TLETimeout            float64
	SatcatTimeout         float64
	MaxSatellites         int
	SatnogsPageSize       int
	UserAgent             string
	RequestTimeoutSeconds int
}

var dotEnvValues = loadDotEnvFile()

func loadDotEnvFile() map[string]string {
	values := map[string]string{}
	f, err := os.Open(".env")
	if err != nil {
		return values
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") || !strings.Contains(line, "=") {
			continue
		}
		key, value, _ := strings.Cut(line, "=")
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		value = strings.Trim(value, `'`)
		value = strings.Trim(value, `"`)
		if key != "" {
			values[key] = value
		}
	}
	return values
}

func envValue(name, def string) string {
	if v, ok := os.LookupEnv(name); ok {
		return v
	}
	if v, ok := dotEnvValues[name]; ok {
		return v
	}
	return def
}

func envFlag(name string, def bool) bool {
	v := envValue(name, "")
	if v == "" {
		return def
	}
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func envInt(name string, def int) int {
	v := envValue(name, "")
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		log.Printf("config: %s=%q not an int, using %d", name, v, def)
		return def
	}
	return n
}

func envFloat(name string, def float64) float64 {
	v := envValue(name, "")
	if v == "" {
		return def
	}
	n, err := strconv.ParseFloat(v, 64)
	if err != nil {
		log.Printf("config: %s=%q not a float, using %v", name, v, def)
		return def
	}
	return n
}

func isProduction() bool {
	env := envValue("SATELLITECHUM_ENV", envValue("FLASK_ENV", ""))
	return strings.ToLower(strings.TrimSpace(env)) == "production"
}

func loadConfig() (Config, error) {
	production := isProduction()
	cfg := Config{
		Production:         production,
		TurnstileSiteKey:   envValue("TURNSTILE_SITE_KEY", ""),
		TurnstileSecretKey: envValue("TURNSTILE_SECRET_KEY", ""),
		SecretKey:          envValue("SECRET_KEY", ""),
		UserAgent:          "SatelliteChum/0.1 (+https://localhost)",
	}
	if production && (cfg.TurnstileSiteKey == "") != (cfg.TurnstileSecretKey == "") {
		return cfg, errConfig("TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY must both be set together")
	}
	if production && cfg.SecretKey == "" {
		return cfg, errConfig("SECRET_KEY must be set when SATELLITECHUM_ENV=production")
	}
	cfg.SessionCookieSecure = envFlag("SESSION_COOKIE_SECURE", production)

	hosts := []string{}
	for _, item := range strings.Split(envValue("TRUSTED_HOSTS", ""), ",") {
		if item = strings.TrimSpace(item); item != "" {
			hosts = append(hosts, item)
		}
	}
	cfg.TrustedHosts = hosts
	if production && len(hosts) == 0 {
		return cfg, errConfig("TRUSTED_HOSTS must be set when SATELLITECHUM_ENV=production")
	}

	cfg.RateLimitWindow = envInt("SATELLITECHUM_RATE_LIMIT_WINDOW_SECONDS", 60)
	cfg.RateLimits = map[string]int{
		"satellites":        envInt("SATELLITECHUM_RATE_LIMIT_SATELLITES", 120),
		"country":           envInt("SATELLITECHUM_RATE_LIMIT_COUNTRY", 120),
		"location_label":    envInt("SATELLITECHUM_RATE_LIMIT_LOCATION_LABEL", 120),
		"search":            envInt("SATELLITECHUM_RATE_LIMIT_SEARCH", 30),
		"satellite_lookup":  envInt("SATELLITECHUM_RATE_LIMIT_SATELLITE_LOOKUP", 30),
		"countries":         envInt("SATELLITECHUM_RATE_LIMIT_COUNTRIES", 30),
		"location_intel":    envInt("SATELLITECHUM_RATE_LIMIT_LOCATION_INTEL", 20),
		"satellite_details": envInt("SATELLITECHUM_RATE_LIMIT_SATELLITE_DETAILS", 30),
	}

	cfg.TLETimeout = envFloat("SATELLITECHUM_TLE_TIMEOUT", 6)
	cfg.SatcatTimeout = envFloat("SATELLITECHUM_SATCAT_TIMEOUT", 2.5)
	cfg.MaxSatellites = envInt("SATELLITECHUM_MAX_SATELLITES", 0)
	if v := envValue("SATELLITECHUM_SATNOGS_PAGE_SIZE", ""); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			cfg.SatnogsPageSize = n
		}
	} else if cfg.MaxSatellites <= 0 {
		cfg.SatnogsPageSize = 20000
	} else {
		cfg.SatnogsPageSize = max(cfg.MaxSatellites, 1200)
	}

	if bind := envValue("GUNICORN_BIND", ""); bind != "" {
		cfg.Bind = bind
	} else {
		cfg.Bind = "0.0.0.0:" + envValue("PORT", "8000")
	}
	cfg.RequestTimeoutSeconds = 15
	return cfg, nil
}

type configError string

func (e configError) Error() string { return string(e) }

func errConfig(msg string) error { return configError(msg) }
