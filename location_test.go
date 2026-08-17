package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// stubExternalAPIs points every outbound API at one stub server and returns
// it. The handler routes by path prefix.
func stubExternalAPIs(t *testing.T, handler func(path, query string) (int, string)) *stubRoutes {
	t.Helper()
	srv := stubServer(t, handler)
	base := srv.URL
	overrideURL(t, &nominatimReverse, base+"/nominatim/reverse")
	overrideURL(t, &nominatimSearch, base+"/nominatim/search")
	overrideURL(t, &bigdatacloudReverse, base+"/bigdatacloud/reverse")
	overrideURL(t, &openMeteoSearch, base+"/open-meteo/search")
	overrideURL(t, &wikidataAPI, base+"/wikidata/api.php")
	overrideURL(t, &wikipediaAPI, base+"/wikipedia/api.php")
	overrideURL(t, &wikipediaSummary, base+"/wikipedia/summary/%s")
	overrideURL(t, &restCountriesName, base+"/restcountries/name/%s")
	overrideURL(t, &worldBankIndicator, base+"/worldbank/country/%s/indicator/SP.POP.TOTL")
	overrideURL(t, &celestrakSatcatURL, base+"/celestrek/satcat/records.php")
	overrideURL(t, &satnogsSatellitesURL, base+"/satnogs/satellites/")
	overrideURL(t, &countriesGeoJSONURL, base+"/countries.geo.json")
	return &stubRoutes{base: base}
}

type stubRoutes struct{ base string }

const mongoliaCountryJSON = `[
  {
    "name": {"official": "Mongolia"},
    "population": 3400000,
    "capital": ["Ulaanbaatar"],
    "region": "Asia",
    "subregion": "Eastern Asia",
    "currencies": {"MNT": {"name": "Mongolian togrog"}},
    "languages": {"mon": "Mongolian"},
    "timezones": ["UTC+08:00"],
    "independent": true,
    "unMember": true,
    "cca2": "MN",
    "flags": {"svg": "https://example.test/flag.svg"}
  }
]`

func TestSynthesizeLocationSummaryUsesCountryFacts(t *testing.T) {
	summary := synthesizeLocationSummary("Mongolia", "Mongolia", map[string]any{
		"region":           "Asia",
		"subregion":        "Eastern Asia",
		"capital":          "Ulan Bator",
		"population_label": "3.5M",
		"languages":        []any{"Mongolian"},
		"currencies":       []any{"Mongolian togrog"},
		"independent":      true,
		"un_member":        true,
	})
	for _, want := range []string{"Mongolia is in Mongolia", "The capital is Ulan Bator", "population 3.5M"} {
		if !strings.Contains(summary, want) {
			t.Errorf("summary %q missing %q", summary, want)
		}
	}
}

func TestBuildLocationIntelFallsBackWhenWikipediaMissing(t *testing.T) {
	stubExternalAPIs(t, func(path, query string) (int, string) {
		switch {
		case strings.HasPrefix(path, "/wikipedia/"):
			return 200, `{"query":{"geosearch":[],"search":[]}}`
		case strings.HasPrefix(path, "/restcountries/"):
			return 200, `[{"capital": ["Ulan Bator"], "population_label": "3.5M"}]`
		case strings.HasPrefix(path, "/worldbank/"):
			return 200, `[]`
		case strings.HasPrefix(path, "/open-meteo/"):
			return 200, `{"results":[]}`
		case strings.HasPrefix(path, "/wikidata/"):
			return 200, `{"search":[]}`
		}
		return 404, ""
	})

	a := newTestApp(t)
	payload := a.buildLocationIntel("Mongolia", "Mongolia", 46.86, 103.84)
	if strOf(payload, "name") != "Mongolia" {
		t.Errorf("name = %q", strOf(payload, "name"))
	}
	if strOf(payload, "summary") == "" {
		t.Error("summary empty")
	}
	ci, _ := payload["country_intel"].(map[string]any)
	if strOf(ci, "capital") != "Ulan Bator" {
		t.Errorf("country_intel.capital = %q", strOf(ci, "capital"))
	}
}

func TestBuildLocationIntelSeparatesPlaceAndCountryPopulation(t *testing.T) {
	stubExternalAPIs(t, func(path, query string) (int, string) {
		switch {
		case strings.HasPrefix(path, "/wikipedia/"):
			return 200, `{"query":{"geosearch":[],"search":[]}}`
		case strings.HasPrefix(path, "/restcountries/"):
			return 200, `[{"capital": ["Edinburgh"], "cca2": "GB"}]`
		case strings.HasPrefix(path, "/worldbank/"):
			return 200, `[{"indicator": {}}, [{"value": 69000000, "date": "2024"}]]`
		case strings.HasPrefix(path, "/open-meteo/"):
			return 200, `{"results":[{"name":"Whitburn","country":"United Kingdom","latitude":55.86,"longitude":-3.68,"population":10000}]}`
		case strings.HasPrefix(path, "/wikidata/"):
			return 200, `{"search":[]}`
		}
		return 404, ""
	})

	a := newTestApp(t)
	payload := a.buildLocationIntel("Whitburn", "United Kingdom", 55.86, -3.68)
	pi, _ := payload["place_intel"].(map[string]any)
	if strOf(pi, "population_label") != "10.0K" {
		t.Errorf("place_intel.population_label = %q", strOf(pi, "population_label"))
	}
	ci, _ := payload["country_intel"].(map[string]any)
	if strOf(ci, "population_label") != "69.0M" {
		t.Errorf("country_intel.population_label = %q", strOf(ci, "population_label"))
	}
}

func TestReverseGeocodePlacePrefersBigdatacloudDetails(t *testing.T) {
	stubExternalAPIs(t, func(path, query string) (int, string) {
		if strings.HasPrefix(path, "/bigdatacloud/") {
			return 200, `{"locality":"Qikiqtaaluk Region","city":"","principalSubdivision":"Nunavut","countryName":"Canada","countryCode":"CA"}`
		}
		return 404, ""
	})

	a := newTestApp(t)
	payload := a.reverseGeocodePlace(65.77, -82.19)
	if strOf(payload, "name") != "Qikiqtaaluk Region" {
		t.Errorf("name = %q", strOf(payload, "name"))
	}
	if strOf(payload, "region") != "Nunavut" {
		t.Errorf("region = %q", strOf(payload, "region"))
	}
	if strOf(payload, "display_name") != "Qikiqtaaluk Region, Nunavut, Canada" {
		t.Errorf("display_name = %q", strOf(payload, "display_name"))
	}
}

func TestLoadCountryIntelCombinesMultipleSources(t *testing.T) {
	stubExternalAPIs(t, func(path, query string) (int, string) {
		switch {
		case strings.HasPrefix(path, "/restcountries/"):
			return 200, mongoliaCountryJSON
		case strings.HasPrefix(path, "/worldbank/"):
			return 200, `[{"indicator": {}}, [{"value": 3504000, "date": "2024"}]]`
		case strings.HasPrefix(path, "/open-meteo/"):
			return 200, `{"results":[{"name":"Mongolia","population":3170208,"feature_code":"PCL.MN","country_code":"MN"}]}`
		case strings.HasPrefix(path, "/wikidata/"):
			if strings.Contains(query, "wbsearchentities") {
				return 200, `{"search":[{"id":"Q43249","label":"Mongolia","description":"country in Asia"}]}`
			}
			// wbgetentities: claims or labels
			if strings.Contains(query, "claims") {
				return 200, `{"entities":{"Q43249":{"claims":{"P122":[{"mainsnak":{"datavalue":{"value":{"id":"Q17155478"}}}}]}}}}`
			}
			return 200, `{"entities":{"Q17155478":{"labels":{"en":{"value":"unitary parliamentary republic"}}}}}`
		}
		return 404, ""
	})

	a := newTestApp(t)
	payload := a.loadCountryIntel("Mongolia")
	if got := payload["population"]; got != float64(3504000) {
		t.Errorf("population = %v", got)
	}
	if strOf(payload, "population_label") != "3.5M" {
		t.Errorf("population_label = %q", strOf(payload, "population_label"))
	}
	if strOf(payload, "population_year") != "2024" {
		t.Errorf("population_year = %q", strOf(payload, "population_year"))
	}
	if strOf(payload, "government_type") != "unitary parliamentary republic" {
		t.Errorf("government_type = %q", strOf(payload, "government_type"))
	}
	raw, _ := json.Marshal(payload["sources"])
	for _, want := range []string{"REST Countries", "World Bank", "Open-Meteo", "Wikidata"} {
		if !strings.Contains(string(raw), want) {
			t.Errorf("sources %s missing %q", raw, want)
		}
	}
}

func TestReverseGeocodeCountryParsesNominatim(t *testing.T) {
	srv := stubServer(t, func(path, query string) (int, string) {
		if strings.HasPrefix(path, "/nominatim/") {
			return 200, `{"address":{"country":"France","country_code":"fr"}}`
		}
		return 404, ""
	})
	overrideURL(t, &nominatimReverse, srv.URL+"/nominatim/reverse")

	a := newTestApp(t)
	payload := a.reverseGeocodeCountry(48.8, 2.3)
	if strOf(payload, "country") != "France" {
		t.Errorf("country = %q", strOf(payload, "country"))
	}
	if strOf(payload, "country_code") != "FR" {
		t.Errorf("country_code = %q", strOf(payload, "country_code"))
	}
}

func TestCountryEndpointRejectsNanCoords(t *testing.T) {
	a := newTestApp(t)
	rec := doReq(t, a, http.MethodGet, "/api/country?lat=nan&lon=10", nil)
	if rec.Code != 400 {
		t.Errorf("status = %d, want 400", rec.Code)
	}
}

func TestLocationIntelEndpointRejectsNonFiniteCoords(t *testing.T) {
	stubExternalAPIs(t, func(path, query string) (int, string) { return 404, "" })
	a := newTestApp(t)
	rec := doReq(t, a, http.MethodGet, "/api/location-intel?name=Test&country=Test&lat=1&lon=inf", nil)
	if rec.Code != 400 {
		t.Errorf("status = %d, want 400", rec.Code)
	}
}
