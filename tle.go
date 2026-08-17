package main

import (
	"context"
	"fmt"
	"io"
	"net/url"
	"strconv"
	"strings"
	"time"
)

var fallbackTLES = `ISS (ZARYA)
1 25544U 98067A   26066.51879540  .00015903  00000+0  29038-3 0  9994
2 25544  51.6321  68.2848 0003503 147.9617 330.2048 15.49934412500783
HST
1 20580U 90037B   26066.19438100  .00000798  00000+0  34834-4 0  9993
2 20580  28.4694 322.0325 0001882  58.0536 302.0638 15.26235543863418
NOAA 15
1 25338U 98030A   26066.49663331  .00000085  00000+0  78692-4 0  9990
2 25338  98.7056 132.5837 0011970 109.3887 250.8539 14.27108081452527
`

// SatelliteItem is one TLE record plus its derived profile fields.
type SatelliteItem struct {
	Name                 string `json:"name"`
	Line1                string `json:"line1"`
	Line2                string `json:"line2"`
	Catnr                *int   `json:"catnr"`
	ObjectName           string `json:"object_name"`
	Purpose              string `json:"purpose"`
	OwnerLabel           string `json:"owner_label"`
	OperatorType         string `json:"operator_type"`
	ObjectType           string `json:"object_type"`
	ClassificationSource string `json:"classification_source"`
}

func parseTLEPayload(payload string) []SatelliteItem {
	lines := []string{}
	for _, line := range strings.Split(payload, "\n") {
		if line = strings.TrimSpace(line); line != "" {
			lines = append(lines, line)
		}
	}
	satellites := []SatelliteItem{}
	for idx := 0; idx+2 < len(lines); idx += 3 {
		name, line1, line2 := lines[idx], lines[idx+1], lines[idx+2]
		if !strings.HasPrefix(line1, "1 ") || !strings.HasPrefix(line2, "2 ") {
			continue
		}
		satellites = append(satellites, SatelliteItem{
			Name:  name,
			Line1: line1,
			Line2: line2,
			Catnr: extractCatnr(line1),
		})
	}
	return satellites
}

func extractCatnr(line1 string) *int {
	if !strings.HasPrefix(line1, "1 ") {
		return nil
	}
	token := strings.TrimSpace(line1[2:7])
	n, err := strconv.Atoi(token)
	if err != nil {
		return nil
	}
	return &n
}

func satelliteDedupeKey(item SatelliteItem) string {
	if item.Catnr != nil {
		return "catnr:" + strconv.Itoa(*item.Catnr)
	}
	return "name:" + strings.ToLower(strings.TrimSpace(item.Name)) + "|" + item.Line1 + "|" + item.Line2
}

func mergeSatelliteSets(groups [][]SatelliteItem) []SatelliteItem {
	merged := []SatelliteItem{}
	seen := map[string]bool{}
	for _, items := range groups {
		for _, item := range items {
			key := satelliteDedupeKey(item)
			if seen[key] {
				continue
			}
			seen[key] = true
			merged = append(merged, item)
		}
	}
	return merged
}

func serviceBucketForName(name string) string {
	profile := inferSatelliteProfile(nil, name)
	purpose := strings.ToLower(profile.Purpose)
	operatorType := strings.ToLower(profile.OperatorType)
	objectType := strings.ToLower(profile.ObjectType)
	switch {
	case strings.Contains(purpose, "rocket body") || strings.Contains(purpose, "debris") || objectType == "r/b" || objectType == "deb":
		return "debris"
	case strings.Contains(purpose, "crewed space station") || strings.Contains(purpose, "human"):
		return "human-spaceflight"
	case strings.Contains(purpose, "reconnaissance") || strings.Contains(purpose, "surveillance") || strings.Contains(operatorType, "military"):
		return "military"
	case strings.Contains(purpose, "communications") || strings.Contains(purpose, "broadcast") || strings.Contains(purpose, "tv"):
		return "comms"
	case strings.Contains(purpose, "navigation") || strings.Contains(purpose, "position"):
		return "navigation"
	case strings.Contains(purpose, "weather"):
		return "weather"
	case strings.Contains(purpose, "earth observation"):
		return "earth-observation"
	case strings.Contains(purpose, "science") || strings.Contains(purpose, "observatory") || strings.Contains(purpose, "technology"):
		return "science"
	}
	return "other"
}

func balancedSatelliteSubset(items []SatelliteItem, limit int) []SatelliteItem {
	if limit <= 0 || len(items) <= limit {
		return items
	}
	bucketOrder := []string{
		"comms", "navigation", "weather", "earth-observation",
		"military", "human-spaceflight", "science", "debris", "other",
	}
	buckets := map[string][]SatelliteItem{}
	for _, key := range bucketOrder {
		buckets[key] = []SatelliteItem{}
	}
	for _, item := range items {
		buckets[serviceBucketForName(item.Name)] = append(buckets[serviceBucketForName(item.Name)], item)
	}
	selected := []SatelliteItem{}
	for len(selected) < limit {
		progressed := false
		for _, key := range bucketOrder {
			bucket := buckets[key]
			if len(bucket) == 0 {
				continue
			}
			selected = append(selected, bucket[0])
			buckets[key] = bucket[1:]
			progressed = true
			if len(selected) >= limit {
				break
			}
		}
		if !progressed {
			break
		}
	}
	return selected
}

func (a *App) fetchLiveSatellites(ctx context.Context) ([]SatelliteItem, []string, error) {
	groups := [][]SatelliteItem{}
	sourceGroups := []string{}
	celestrakOK := true
	for _, group := range celestrakGroupURLs {
		resp, err := a.httpGet(ctx, group[1], nil, a.tleTimeout())
		if err != nil {
			celestrakOK = false
			break
		}
		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil || resp.StatusCode < 200 || resp.StatusCode >= 300 {
			celestrakOK = false
			break
		}
		items := parseTLEPayload(string(body))
		if len(items) > 0 {
			groups = append(groups, items)
			sourceGroups = append(sourceGroups, group[0])
		}
	}
	if celestrakOK {
		merged := mergeSatelliteSets(groups)
		if len(merged) > 0 {
			return balancedSatelliteSubset(merged, a.cfg.MaxSatellites), sourceGroups, nil
		}
	}

	var rows []map[string]any
	if err := a.httpGetJSON(ctx, satnogsTLEURL, url.Values{
		"page_size": {strconv.Itoa(a.cfg.SatnogsPageSize)},
	}, a.tleTimeout(), &rows); err != nil {
		return nil, nil, err
	}
	items := []SatelliteItem{}
	for _, row := range rows {
		line1 := strings.TrimSpace(strOf(row, "tle1"))
		line2 := strings.TrimSpace(strOf(row, "tle2"))
		if !strings.HasPrefix(line1, "1 ") || !strings.HasPrefix(line2, "2 ") {
			continue
		}
		name := strings.TrimSpace(strOf(row, "tle0"))
		if name == "" {
			name = strings.TrimSpace(strOf(row, "name"))
		}
		if strings.HasPrefix(name, "0 ") {
			name = strings.TrimSpace(name[2:])
		}
		var catnr *int
		if id, ok := row["norad_cat_id"].(float64); ok && id != 0 {
			n := int(id)
			catnr = &n
		} else {
			catnr = extractCatnr(line1)
		}
		if name == "" {
			if id, ok := row["norad_cat_id"]; ok && id != nil {
				name = "NORAD " + fmt.Sprintf("%v", id)
			} else {
				name = "NORAD Unknown"
			}
		}
		items = append(items, SatelliteItem{
			Name:  name,
			Line1: line1,
			Line2: line2,
			Catnr: catnr,
		})
	}
	merged := mergeSatelliteSets([][]SatelliteItem{items})
	return balancedSatelliteSubset(merged, a.cfg.MaxSatellites), []string{"satnogs-tle"}, nil
}

func (a *App) ensureFallbackSatellites() {
	a.tleMu.Lock()
	defer a.tleMu.Unlock()
	if len(a.tleCache.items) > 0 {
		return
	}
	a.tleCache.items = decorateSatelliteItems(
		balancedSatelliteSubset(parseTLEPayload(fallbackTLES), a.cfg.MaxSatellites))
	a.tleCache.source = "fallback"
	a.tleCache.sourceGroups = []string{"fallback"}
}

func (a *App) refreshSatellitesWorker() {
	defer func() {
		a.tleMu.Lock()
		a.tleCache.refreshing = false
		a.tleMu.Unlock()
	}()
	satellites, sourceGroups, err := a.fetchLiveSatellites(context.Background())
	if err == nil {
		if len(satellites) > 0 {
			a.tleMu.Lock()
			a.tleCache.items = decorateSatelliteItems(satellites)
			a.tleCache.fetchedAt = float64(time.Now().Unix())
			a.tleCache.source = "live"
			a.tleCache.sourceGroups = sourceGroups
			a.tleCache.lastError = ""
			a.tleMu.Unlock()
			return
		}
		a.ensureFallbackSatellites()
		a.tleMu.Lock()
		a.tleCache.lastError = "No live TLE groups returned usable satellites."
		a.tleMu.Unlock()
		return
	}
	a.ensureFallbackSatellites()
	a.tleMu.Lock()
	a.tleCache.lastError = err.Error()
	a.tleMu.Unlock()
}

func (a *App) startSatelliteRefresh() {
	a.tleMu.Lock()
	if a.tleCache.refreshing {
		a.tleMu.Unlock()
		return
	}
	a.tleCache.refreshing = true
	a.tleCache.lastAttempt = float64(time.Now().Unix())
	a.tleMu.Unlock()
	go a.refreshSatellitesWorker()
}

func (a *App) loadSatellites() []SatelliteItem {
	a.tleMu.Lock()
	if len(a.tleCache.items) > 0 && a.tleCache.source == "live" &&
		float64(time.Now().Unix())-a.tleCache.fetchedAt < tleCacheTTL {
		items := a.tleCache.items
		a.tleMu.Unlock()
		return items
	}
	a.tleMu.Unlock()
	a.ensureFallbackSatellites()
	a.startSatelliteRefresh()
	a.tleMu.Lock()
	items := a.tleCache.items
	a.tleMu.Unlock()
	return items
}

func (a *App) loadSatelliteByCatnr(ctx context.Context, catnr int) (SatelliteItem, bool) {
	if catnr <= 0 {
		return SatelliteItem{}, false
	}
	for _, item := range a.loadSatellites() {
		if item.Catnr != nil && *item.Catnr == catnr {
			return item, true
		}
	}
	resp, err := a.httpGet(ctx, "https://celestrak.org/NORAD/elements/gp.php", url.Values{
		"CATNR":  {strconv.Itoa(catnr)},
		"FORMAT": {"tle"},
	}, a.tleTimeout())
	if err == nil {
		body, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()
		if readErr == nil && resp.StatusCode >= 200 && resp.StatusCode < 300 {
			items := parseTLEPayload(string(body))
			for _, item := range items {
				if item.Catnr != nil && *item.Catnr == catnr {
					return decorateSatelliteItem(item), true
				}
			}
			if len(items) > 0 {
				return decorateSatelliteItem(items[0]), true
			}
		}
	}
	return SatelliteItem{}, false
}

func decorateSatelliteItem(item SatelliteItem) SatelliteItem {
	profile := inferSatelliteProfile(nil, item.Name)
	item.ObjectName = item.Name
	item.Purpose = profile.Purpose
	item.OwnerLabel = profile.OwnerLabel
	item.OperatorType = profile.OperatorType
	item.ObjectType = profile.ObjectType
	item.ClassificationSource = profile.ClassificationSource
	return item
}

func decorateSatelliteItems(items []SatelliteItem) []SatelliteItem {
	out := make([]SatelliteItem, len(items))
	for i, item := range items {
		out[i] = decorateSatelliteItem(item)
	}
	return out
}
