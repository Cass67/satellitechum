package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestSatelliteEndpointMergesSatnogsMetadataWhenSatcatMissing(t *testing.T) {
	stubExternalAPIs(t, func(path, query string) (int, string) {
		switch {
		case strings.HasPrefix(path, "/celestrek/"):
			return 200, `[]`
		case strings.HasPrefix(path, "/satnogs/"):
			return 200, `[
				{"norad_cat_id": 2768, "name": "ERS 20 (OV5-3)", "names": "OV5-3", "status": "alive",
				 "launched": "1967-04-28T00:00:00Z", "website": "https://en.wikipedia.org/wiki/OV5-3",
				 "countries": "US", "citation": "SatNOGS DB"}
			]`
		case strings.HasPrefix(path, "/wikipedia/api.php"):
			if strings.Contains(query, "list=search") {
				return 200, `{"query":{"search":[{"title":"OV5-3"}]}}`
			}
			return 200, `{"query":{"geosearch":[]}}`
		case strings.HasPrefix(path, "/wikipedia/summary/"):
			return 200, `{"title":"OV5-3","extract":"Orbiting Vehicle 5-3 was launched on 28 April 1967.","content_urls":{"desktop":{"page":"https://en.wikipedia.org/wiki/OV5-3"}}}`
		}
		return 404, ""
	})

	a := newTestApp(t)
	rec := doReq(t, a, http.MethodGet, "/api/satellite/2768?name=ERS%2020%20(OV5-3)", nil)
	if rec.Code != 200 {
		t.Fatalf("status = %d body = %s", rec.Code, rec.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if strOf(payload, "object_name") != "ERS 20 (OV5-3)" {
		t.Errorf("object_name = %q", strOf(payload, "object_name"))
	}
	if strOf(payload, "launch_date") != "1967-04-28" {
		t.Errorf("launch_date = %q", strOf(payload, "launch_date"))
	}
	raw, _ := json.Marshal(payload["countries"])
	if string(raw) != `["United States"]` {
		t.Errorf("countries = %s", raw)
	}
	if strOf(payload, "summary_url") != "https://en.wikipedia.org/wiki/OV5-3" {
		t.Errorf("summary_url = %q", strOf(payload, "summary_url"))
	}
	if strOf(payload, "classification_source") != "SatNOGS DB + Name heuristic" {
		t.Errorf("classification_source = %q", strOf(payload, "classification_source"))
	}
}

func TestSatelliteLookupEndpointReturnsCachedTLE(t *testing.T) {
	srv := stubServer(t, func(path, query string) (int, string) {
		if strings.Contains(query, "GROUP=visual") {
			return 200, issTLE
		}
		return 500, ""
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
	// Prime the TLE cache synchronously via a lookup that misses the cache
	// but hits celestrak CATNR (stubbed to the same server).
	overrideURL(t, &satnogsTLEURL, srv.URL+"/api/tle/")
	rec := doReq(t, a, http.MethodGet, "/api/satellite-lookup/25544", nil)
	if rec.Code != 200 {
		t.Fatalf("status = %d body = %s", rec.Code, rec.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if strOf(payload, "name") != "ISS (ZARYA)" {
		t.Errorf("name = %q", strOf(payload, "name"))
	}
	waitForRefresh(t, a)
}
