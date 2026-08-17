package main

import (
	"net/url"
	"strings"
	"testing"
	"time"
)

const issTLE = `ISS (ZARYA)
1 25544U 98067A   26066.51879540  .00015903  00000+0  29038-3 0  9994
2 25544  51.6321  68.2848 0003503 147.9617 330.2048 15.49934412500783
`

const hstTLE = `HST
1 20580U 90037B   26066.19438100  .00000798  00000+0  34834-4 0  9993
2 20580  28.4694 322.0325 0001882  58.0536 302.0638 15.26235543863418
`

const cssTLE = `CSS (TIANHE)
1 48274U 21035A   26066.50000000  .00010000  00000+0  10000-3 0  9990
2 48274  41.4700 120.0000 0008000 180.0000 180.0000 15.60000000250000
`

const terraTLE = `TERRA
1 25994U 99068A   26066.50000000  .00000042  00000+0  18000-4 0  9996
2 25994  98.2050 120.0000 0001000  90.0000 270.0000 14.57100000123456
`

func TestFetchLiveSatellitesMergesGroupsAndDedupesByCatnr(t *testing.T) {
	payloads := map[string]string{
		"visual":   issTLE + hstTLE,
		"stations": issTLE + cssTLE,
		"active":   terraTLE,
	}
	srv := stubServer(t, func(path, query string) (int, string) {
		group := ""
		if q, err := url.ParseQuery(query); err == nil {
			group = q.Get("GROUP")
		}
		if body, ok := payloads[group]; ok {
			return 200, body
		}
		return 404, ""
	})

	celestrakGroupURLs = [][2]string{
		{"visual", srv.URL + "/gp.php?FORMAT=tle&GROUP=visual"},
		{"stations", srv.URL + "/gp.php?FORMAT=tle&GROUP=stations"},
		{"active", srv.URL + "/gp.php?FORMAT=tle&GROUP=active"},
	}
	t.Cleanup(func() {
		celestrakGroupURLs = [][2]string{
			{"visual", celestrakVisualURL},
			{"stations", celestrakStationsURL},
			{"active", celestrakActiveURL},
		}
	})

	a := newTestApp(t)
	items, groups, err := a.fetchLiveSatellites(t.Context())
	if err != nil {
		t.Fatalf("fetch error: %v", err)
	}
	var names []string
	var catnrs []int
	for _, item := range items {
		names = append(names, item.Name)
		if item.Catnr != nil {
			catnrs = append(catnrs, *item.Catnr)
		} else {
			catnrs = append(catnrs, -1)
		}
	}
	wantNames := []string{"ISS (ZARYA)", "HST", "CSS (TIANHE)", "TERRA"}
	if strings.Join(names, ",") != strings.Join(wantNames, ",") {
		t.Errorf("names = %v", names)
	}
	wantCatnrs := []int{25544, 20580, 48274, 25994}
	if len(catnrs) != len(wantCatnrs) {
		t.Fatalf("catnrs = %v", catnrs)
	}
	for i := range wantCatnrs {
		if catnrs[i] != wantCatnrs[i] {
			t.Errorf("catnrs = %v", catnrs)
		}
	}
	if strings.Join(groups, ",") != "visual,stations,active" {
		t.Errorf("groups = %v", groups)
	}
}

func TestFetchLiveSatellitesFallsBackToSatnogs(t *testing.T) {
	srv := stubServer(t, func(path, query string) (int, string) {
		switch {
		case strings.Contains(path, "celestrak"):
			return 500, ""
		case path == "/api/tle/":
			return 200, `[
				{"tle0": "0 ISS", "tle1": "1 25544U 98067A   26066.51879540  .00015903  00000+0  29038-3 0  9994", "tle2": "2 25544  51.6321  68.2848 0003503 147.9617 330.2048 15.49934412500783", "norad_cat_id": 25544},
				{"tle0": "HST", "tle1": "1 20580U 90037B   26066.19438100  .00000798  00000+0  34834-4 0  9993", "tle2": "2 20580  28.4694 322.0325 0001882  58.0536 302.0638 15.26235543863418", "norad_cat_id": 20580}
			]`
		}
		return 404, ""
	})
	celestrakGroupURLs = [][2]string{
		{"visual", srv.URL + "/celestrak"},
		{"stations", srv.URL + "/celestrak"},
		{"active", srv.URL + "/celestrak"},
	}
	t.Cleanup(func() {
		celestrakGroupURLs = [][2]string{
			{"visual", celestrakVisualURL},
			{"stations", celestrakStationsURL},
			{"active", celestrakActiveURL},
		}
	})
	overrideURL(t, &satnogsTLEURL, srv.URL+"/api/tle/")

	a := newTestApp(t)
	items, groups, err := a.fetchLiveSatellites(t.Context())
	if err != nil {
		t.Fatalf("fetch error: %v", err)
	}
	var names []string
	var catnrs []int
	for _, item := range items {
		names = append(names, item.Name)
		if item.Catnr != nil {
			catnrs = append(catnrs, *item.Catnr)
		} else {
			catnrs = append(catnrs, -1)
		}
	}
	if strings.Join(names, ",") != "ISS,HST" {
		t.Errorf("names = %v", names)
	}
	if len(catnrs) != 2 || catnrs[0] != 25544 || catnrs[1] != 20580 {
		t.Errorf("catnrs = %v", catnrs)
	}
	if strings.Join(groups, ",") != "satnogs-tle" {
		t.Errorf("groups = %v", groups)
	}
}

func TestLoadSatellitesReturnsFallbackImmediatelyWhenCacheEmpty(t *testing.T) {
	srv := stubServer(t, func(path, query string) (int, string) { return 500, "" })
	celestrakGroupURLs = [][2]string{
		{"visual", srv.URL + "/celestrak"},
		{"stations", srv.URL + "/celestrak"},
		{"active", srv.URL + "/celestrak"},
	}
	t.Cleanup(func() {
		celestrakGroupURLs = [][2]string{
			{"visual", celestrakVisualURL},
			{"stations", celestrakStationsURL},
			{"active", celestrakActiveURL},
		}
	})
	overrideURL(t, &satnogsTLEURL, srv.URL+"/api/tle/")

	a := newTestApp(t)
	items := a.loadSatellites()
	var names []string
	for _, item := range items {
		names = append(names, item.Name)
	}
	if strings.Join(names, ",") != "ISS (ZARYA),HST,NOAA 15" {
		t.Errorf("names = %v", names)
	}
	a.tleMu.Lock()
	source := a.tleCache.source
	refreshing := a.tleCache.refreshing
	a.tleMu.Unlock()
	if source != "fallback" {
		t.Errorf("source = %q", source)
	}
	if !refreshing {
		t.Error("refresh not started")
	}
	waitForRefresh(t, a)
}

// waitForRefresh blocks until the background TLE refresh goroutine finishes
// (keeps it from racing the test's URL-override cleanups).
func waitForRefresh(t *testing.T, a *App) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		a.tleMu.Lock()
		refreshing := a.tleCache.refreshing
		a.tleMu.Unlock()
		if !refreshing {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("refresh did not finish in time")
}

func TestLoadSatnogsSatelliteReturnsMetadata(t *testing.T) {
	srv := stubServer(t, func(path, query string) (int, string) {
		if path == "/api/satellites/" {
			return 200, `[
				{"norad_cat_id": 2768, "name": "ERS 20 (OV5-3)", "names": "OV5-3", "status": "alive",
				 "launched": "1967-04-28T00:00:00Z", "website": "https://en.wikipedia.org/wiki/OV5-3", "countries": "US"}
			]`
		}
		return 404, ""
	})
	overrideURL(t, &satnogsSatellitesURL, srv.URL+"/api/satellites/")

	a := newTestApp(t)
	payload := a.loadSatnogsSatellite(t.Context(), 2768)
	if strOf(payload, "name") != "ERS 20 (OV5-3)" {
		t.Errorf("name = %q", strOf(payload, "name"))
	}
	if strOf(payload, "launched") != "1967-04-28T00:00:00Z" {
		t.Errorf("launched = %q", strOf(payload, "launched"))
	}
	if strOf(payload, "countries") != "US" {
		t.Errorf("countries = %q", strOf(payload, "countries"))
	}
}
