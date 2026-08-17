package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var parenRE = regexp.MustCompile(`\(([^)]+)\)`)

func (a *App) loadSatcatDetails(ctx context.Context, catnr int) map[string]any {
	now := float64(time.Now().Unix())
	if cached, ok := a.satcat.get(catnr, now, satcatCacheTTL, satcatFailTTL); ok {
		return cached
	}
	details := map[string]any{}
	var payload []map[string]any
	q := url.Values{}
	q.Set("CATNR", strconv.Itoa(catnr))
	q.Set("FORMAT", "json")
	if err := a.httpGetJSON(ctx, celestrakSatcatURL, q, a.satcatTimeout(), &payload); err == nil && len(payload) > 0 {
		details = payload[0]
	}
	a.satcat.set(catnr, details, now)
	return details
}

// spaceTrackCredentials mirrors app.py _space_track_credentials: real env
// vars in priority order, then .env values in priority order.
func spaceTrackCredentials() (string, string) {
	var username, password string
	for _, name := range []string{"SPACE_TRACK_IDENTITY", "SPACE_TRACK_USERNAME", "ST_USER"} {
		if v := strings.TrimSpace(os.Getenv(name)); v != "" {
			username = v
			break
		}
	}
	if username == "" {
		for _, name := range []string{"SPACE_TRACK_IDENTITY", "SPACE_TRACK_USERNAME", "ST_USER", "st-user"} {
			if v := strings.TrimSpace(dotEnvValues[name]); v != "" {
				username = v
				break
			}
		}
	}
	for _, name := range []string{"SPACE_TRACK_PASSWORD", "ST_PASS", "SPACETRACK_PASSWORD"} {
		if v := strings.TrimSpace(os.Getenv(name)); v != "" {
			password = v
			break
		}
	}
	if password == "" {
		for _, name := range []string{"SPACE_TRACK_PASSWORD", "ST_PASS", "SPACETRACK_PASSWORD", "st-pass"} {
			if v := strings.TrimSpace(dotEnvValues[name]); v != "" {
				password = v
				break
			}
		}
	}
	return username, password
}

func (a *App) loadSpaceTrackSatcatDetails(ctx context.Context, catnr int) map[string]any {
	now := float64(time.Now().Unix())
	if cached, ok := a.spaceTrack.get(catnr, now, satcatCacheTTL, satcatFailTTL); ok {
		return cached
	}
	username, password := spaceTrackCredentials()
	if username == "" || password == "" {
		details := map[string]any{}
		a.spaceTrack.set(catnr, details, now)
		return details
	}
	details := map[string]any{}
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	reqCtx, cancel := context.WithTimeout(ctx, a.satcatTimeout())
	defer cancel()

	form := url.Values{}
	form.Set("identity", username)
	form.Set("password", password)
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, spaceTrackLoginURL, strings.NewReader(form.Encode()))
	if err == nil {
		req.Header.Set("User-Agent", a.cfg.UserAgent)
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		resp, err := client.Do(req)
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				getReq, err := http.NewRequestWithContext(reqCtx, http.MethodGet,
					fmt.Sprintf(spaceTrackSatcatURL, catnr), nil)
				if err == nil {
					getReq.Header.Set("User-Agent", a.cfg.UserAgent)
					getResp, err := client.Do(getReq)
					if err == nil {
						defer getResp.Body.Close()
						if getResp.StatusCode >= 200 && getResp.StatusCode < 300 {
							var payload []map[string]any
							if err := jsonDecode(getResp, &payload); err == nil && len(payload) > 0 {
								details = payload[0]
							}
						}
					}
				}
			}
		}
	}
	a.spaceTrack.set(catnr, details, now)
	return details
}

func (a *App) loadSatnogsSatellite(ctx context.Context, catnr int) map[string]any {
	now := float64(time.Now().Unix())
	if cached, ok := a.satnogs.get(catnr, now, satcatCacheTTL, satcatCacheTTL); ok {
		return cached
	}
	details := map[string]any{}
	var payload []map[string]any
	if err := a.httpGetJSON(ctx, satnogsSatellitesURL, url.Values{
		"norad_cat_id": {strconv.Itoa(catnr)},
	}, a.satcatTimeout(), &payload); err == nil && len(payload) > 0 {
		details = payload[0]
	}
	a.satnogs.set(catnr, details, now)
	return details
}

func countryLabelsFromCodes(value string) []string {
	output := []string{}
	for _, rawCode := range strings.Split(value, ",") {
		code := strings.ToUpper(strings.TrimSpace(rawCode))
		if code == "" {
			continue
		}
		if mapped, ok := satnogsCountryMap[code]; ok {
			output = append(output, mapped)
		} else {
			output = append(output, code)
		}
	}
	return dedupeText(output)
}

func cleanSatelliteAliases(value string) []string {
	aliases := []string{}
	for _, piece := range regexp.MustCompile(`[,/]`).Split(value, -1) {
		if cleaned := strings.TrimSpace(piece); cleaned != "" {
			aliases = append(aliases, cleaned)
		}
	}
	return dedupeText(aliases)
}

func compactISODate(value string) string {
	return strings.Split(value, "T")[0]
}

func satelliteQueryVariants(fallbackName string, satnogs map[string]any) []string {
	variants := []string{}
	baseNames := append(cleanSatelliteAliases(strOf(satnogs, "names")), strOf(satnogs, "name"), fallbackName)
	for _, name := range baseNames {
		cleaned := strings.TrimSpace(name)
		if cleaned == "" {
			continue
		}
		for _, match := range parenRE.FindAllStringSubmatch(cleaned, -1) {
			if part := strings.TrimSpace(match[1]); part != "" {
				variants = append(variants, part)
			}
		}
		variants = append(variants, cleaned)
		variants = append(variants, strings.TrimSpace(parenRE.ReplaceAllString(cleaned, "")))
	}
	return dedupeText(variants)
}

func (a *App) loadSatelliteReference(fallbackName string, satnogs map[string]any) map[string]any {
	for _, query := range satelliteQueryVariants(fallbackName, satnogs) {
		for _, title := range a.searchWikipediaTitles(query, 5) {
			summary := a.loadWikipediaSummaryByTitle(title)
			if len(summary) > 0 && satelliteReferenceLooksReliable(query, summary) {
				return summary
			}
		}
	}
	return map[string]any{}
}

// satelliteFieldSources mirrors app.py _satellite_field_sources.
func satelliteFieldSources(
	details, satnogs, reference map[string]any,
	profile SatelliteProfile,
	ownerLabel, operatorType string,
) map[string]any {
	sources := map[string]any{}
	catalogSource := profile.CatalogSource
	if catalogSource == "" {
		catalogSource = "CelesTrak SATCAT"
	}
	switch {
	case truthy(details["OBJECT_NAME"]) || truthy(details["OBJECT_ID"]):
		sources["identity"] = catalogSource
	case truthy(satnogs["name"]):
		sources["identity"] = "SatNOGS DB"
	default:
		sources["identity"] = "TLE name"
	}
	sources["classification"] = firstString(profile.ClassificationSource, "Unknown")
	switch {
	case truthy(details["OWNER"]) || truthy(details["OWNER_DESC"]):
		sources["owner"] = catalogSource
	case truthy(satnogs["countries"]) && ownerLabel != "":
		sources["owner"] = "SatNOGS DB"
	case ownerLabel != "":
		sources["owner"] = "Name heuristic"
	default:
		sources["owner"] = "Unknown"
	}
	switch {
	case truthy(details["OWNER"]) || truthy(details["OWNER_DESC"]):
		sources["operator_type"] = catalogSource
	case truthy(satnogs["website"]) && operatorType != "Unspecified":
		sources["operator_type"] = "SatNOGS DB"
	case operatorType != "" && operatorType != "Unspecified":
		sources["operator_type"] = "Name heuristic"
	default:
		sources["operator_type"] = "Unknown"
	}
	sources["orbit"] = "Derived from TLE"
	for _, key := range []string{"ORBIT_TYPE", "PERIOD", "INCLINATION", "APOGEE", "PERIGEE", "RCS"} {
		if truthy(details[key]) {
			sources["orbit"] = catalogSource
			break
		}
	}
	switch {
	case truthy(details["LAUNCH_DATE"]):
		sources["dates"] = catalogSource
	case truthy(satnogs["launched"]) || truthy(satnogs["deployed"]):
		sources["dates"] = "SatNOGS DB"
	default:
		sources["dates"] = "Unknown"
	}
	switch {
	case len(reference) > 0:
		sources["summary"] = "Wikipedia"
	case strOf(satnogs, "website") != "":
		sources["summary"] = "SatNOGS DB"
	default:
		sources["summary"] = "None"
	}
	return sources
}

// satelliteConfidence mirrors app.py _satellite_confidence.
func satelliteConfidence(fieldSources map[string]any) map[string]any {
	rank := func(source string) string {
		switch source {
		case "CelesTrak SATCAT", "Space-Track SATCAT":
			return "high"
		case "SatNOGS DB", "Derived from TLE":
			return "medium"
		case "Wikipedia", "Name heuristic", "TLE name":
			return "low"
		default:
			return "unknown"
		}
	}
	fields := map[string]any{}
	overall := "unknown"
	anyHigh, anyMedium, anyLow := false, false, false
	for key, value := range fieldSources {
		r := rank(fmt.Sprintf("%v", value))
		fields[key] = r
		switch r {
		case "high":
			anyHigh = true
		case "medium":
			anyMedium = true
		case "low":
			anyLow = true
		}
	}
	switch {
	case anyHigh:
		overall = "high"
	case anyMedium:
		overall = "medium"
	case anyLow:
		overall = "low"
	}
	return map[string]any{"overall": overall, "fields": fields}
}

// geometryBBoxCenter mirrors app.py _geometry_bbox_center.
func geometryBBoxCenter(geometry map[string]any) (lat, lon float64, ok bool) {
	coords, _ := geometry["coordinates"].([]any)
	var points [][2]float64
	addPoint := func(ptAny any) {
		pt, ok := ptAny.([]any)
		if !ok || len(pt) < 2 {
			return
		}
		lo, okLo := pt[0].(float64)
		la, okLa := pt[1].(float64)
		if !okLo || !okLa {
			return
		}
		points = append(points, [2]float64{lo, la})
	}
	switch strOf(geometry, "type") {
	case "Polygon":
		for _, ringAny := range coords {
			ring, _ := ringAny.([]any)
			for _, pt := range ring {
				addPoint(pt)
			}
		}
	case "MultiPolygon":
		for _, polyAny := range coords {
			poly, _ := polyAny.([]any)
			for _, ringAny := range poly {
				ring, _ := ringAny.([]any)
				for _, pt := range ring {
					addPoint(pt)
				}
			}
		}
	}
	if len(points) == 0 {
		return 0, 0, false
	}
	minLat, maxLat := points[0][1], points[0][1]
	minLon, maxLon := points[0][0], points[0][0]
	for _, pt := range points[1:] {
		if pt[1] < minLat {
			minLat = pt[1]
		}
		if pt[1] > maxLat {
			maxLat = pt[1]
		}
		if pt[0] < minLon {
			minLon = pt[0]
		}
		if pt[0] > maxLon {
			maxLon = pt[0]
		}
	}
	return (minLat + maxLat) / 2, (minLon + maxLon) / 2, true
}

func (a *App) loadCountryLabels(ctx context.Context) []map[string]any {
	a.countriesMu.Lock()
	now := float64(time.Now().Unix())
	if len(a.countriesCache.items) > 0 && now-a.countriesCache.fetchedAt < 3600*24 {
		items := a.countriesCache.items
		a.countriesMu.Unlock()
		return items
	}
	a.countriesMu.Unlock()

	items := []map[string]any{}
	var geojson map[string]any
	if err := a.httpGetJSON(ctx, countriesGeoJSONURL, nil, a.reqTimeout(), &geojson); err == nil {
		features, _ := geojson["features"].([]any)
		for _, fAny := range features {
			feature, _ := fAny.(map[string]any)
			geometry, _ := feature["geometry"].(map[string]any)
			centerLat, centerLon, ok := geometryBBoxCenter(geometry)
			if !ok {
				continue
			}
			props, _ := feature["properties"].(map[string]any)
			name := strOf(props, "name")
			if name == "" {
				continue
			}
			items = append(items, map[string]any{
				"name": name,
				"lat":  pyRound(centerLat, 2),
				"lon":  pyRound(centerLon, 2),
			})
		}
		a.countriesMu.Lock()
		a.countriesCache.items = items
		a.countriesCache.fetchedAt = now
		a.countriesMu.Unlock()
		return items
	}
	a.countriesMu.Lock()
	defer a.countriesMu.Unlock()
	return a.countriesCache.items
}
