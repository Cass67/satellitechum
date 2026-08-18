package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"
)

func (a *App) reverseGeocodeCountry(lat, lon float64) map[string]any {
	key := latlonKey{lat, lon}
	if v, ok := a.geoCountry.Get(key); ok {
		return v
	}
	result := map[string]any{"country": "Unknown", "country_code": ""}
	q := url.Values{}
	q.Set("lat", floatParam(lat))
	q.Set("lon", floatParam(lon))
	q.Set("format", "jsonv2")
	q.Set("zoom", "3")
	q.Set("accept-language", "en")
	var payload map[string]any
	if err := a.httpGetJSON(context.Background(), nominatimReverse, q, a.reqTimeout(), &payload); err == nil {
		address, _ := payload["address"].(map[string]any)
		country := "Open ocean"
		if v, ok := address["country"]; ok {
			if s, ok := v.(string); ok {
				country = s
			}
		}
		result = map[string]any{
			"country":      country,
			"country_code": strings.ToUpper(strOf(address, "country_code")),
		}
	}
	a.geoCountry.Set(key, result)
	return result
}

func (a *App) reverseGeocodePlaceBigdatacloud(lat, lon float64) map[string]any {
	key := latlonKey{lat, lon}
	if v, ok := a.geoBigdata.Get(key); ok {
		return v
	}
	result := map[string]any{}
	q := url.Values{}
	q.Set("latitude", floatParam(lat))
	q.Set("longitude", floatParam(lon))
	q.Set("localityLanguage", "en")
	var payload map[string]any
	if err := a.httpGetJSON(context.Background(), bigdatacloudReverse, q, a.reqTimeout(), &payload); err == nil {
		name := firstString(
			strOf(payload, "locality"),
			strOf(payload, "city"),
			strOf(payload, "principalSubdivision"),
			strOf(payload, "countryName"),
		)
		country := strOf(payload, "countryName")
		region := strOf(payload, "principalSubdivision")
		countryCode := strOf(payload, "countryCode")
		if name != "" || country != "" {
			result = map[string]any{
				"name":         firstString(name, country, "Ground track"),
				"country":      firstString(country, name, "Unknown"),
				"country_code": countryCode,
				"region":       region,
				"display_name": strings.Join(dedupeText([]string{name, region, country}), ", "),
			}
		}
	}
	a.geoBigdata.Set(key, result)
	return result
}

func (a *App) reverseGeocodePlace(lat, lon float64) map[string]any {
	key := latlonKey{lat, lon}
	if v, ok := a.geoPlace.Get(key); ok {
		return v
	}
	result := a.reverseGeocodePlaceBigdatacloud(lat, lon)
	if len(result) == 0 {
		result = a.reverseGeocodePlaceNominatim(lat, lon)
	}
	if len(result) == 0 {
		countryFallback := a.reverseGeocodeCountry(lat, lon)
		if c, _ := countryFallback["country"].(string); c != "" {
			result = map[string]any{
				"name":         c,
				"country":      c,
				"country_code": countryFallback["country_code"],
				"region":       "",
				"display_name": c,
			}
		}
	}
	if len(result) == 0 {
		result = map[string]any{
			"name":         "Ground track",
			"country":      "Unknown",
			"country_code": "",
			"region":       "",
			"display_name": "",
		}
	}
	a.geoPlace.Set(key, result)
	return result
}

func (a *App) reverseGeocodePlaceNominatim(lat, lon float64) map[string]any {
	for _, zoom := range []int{12, 10, 8, 6, 4} {
		q := url.Values{}
		q.Set("lat", floatParam(lat))
		q.Set("lon", floatParam(lon))
		q.Set("format", "jsonv2")
		q.Set("zoom", fmt.Sprintf("%d", zoom))
		q.Set("addressdetails", "1")
		q.Set("namedetails", "1")
		q.Set("accept-language", "en")
		var payload map[string]any
		if err := a.httpGetJSON(context.Background(), nominatimReverse, q, a.reqTimeout(), &payload); err != nil {
			continue
		}
		address, _ := payload["address"].(map[string]any)
		name := firstString(
			strOf(address, "city"),
			strOf(address, "town"),
			strOf(address, "village"),
			strOf(address, "municipality"),
			strOf(address, "county"),
			strOf(address, "state_district"),
			strOf(address, "state"),
			strOf(address, "country"),
		)
		country := strOf(address, "country")
		region := firstString(
			strOf(address, "state"),
			strOf(address, "territory"),
			strOf(address, "province"),
			strOf(address, "state_district"),
			strOf(address, "county"),
		)
		if name != "" || country != "" {
			return map[string]any{
				"name":         firstString(name, country, "Ground track"),
				"country":      firstString(country, name, "Unknown"),
				"country_code": strings.ToUpper(strOf(address, "country_code")),
				"region":       region,
				"display_name": strings.Join(dedupeText([]string{name, region, country}), ", "),
			}
		}
	}
	return map[string]any{}
}

func (a *App) loadWorldBankPopulation(countryCode2 string) map[string]any {
	key := countryCode2
	if v, ok := a.worldBank.Get(key); ok {
		return v
	}
	result := map[string]any{}
	if countryCode2 != "" {
		rawURL := fmt.Sprintf(worldBankIndicator, url.PathEscape(strings.ToLower(countryCode2)))
		q := url.Values{}
		q.Set("format", "json")
		q.Set("per_page", "8")
		var payload []any
		if err := a.httpGetJSON(context.Background(), rawURL, q, a.reqTimeout(), &payload); err == nil && len(payload) > 1 {
			if series, ok := payload[1].([]any); ok {
				for _, rowAny := range series {
					row, ok := rowAny.(map[string]any)
					if !ok {
						continue
					}
					if truthy(row["value"]) {
						value := row["value"]
						year := ""
						if y, ok := row["date"]; ok {
							if s, ok := y.(string); ok {
								year = s
							}
						}
						result = map[string]any{
							"population":       value,
							"population_label": formatPopulation(value),
							"population_year":  year,
						}
						break
					}
				}
			}
		}
	}
	a.worldBank.Set(key, result)
	return result
}

func (a *App) loadOpenMeteoCountryProfile(countryName string) map[string]any {
	key := countryName
	if v, ok := a.omCountry.Get(key); ok {
		return v
	}
	result := map[string]any{}
	cleaned := cleanSearchQuery(countryName)
	if cleaned != "" {
		q := url.Values{}
		q.Set("name", cleaned)
		q.Set("count", "8")
		q.Set("language", "en")
		q.Set("format", "json")
		var payload struct {
			Results []map[string]any `json:"results"`
		}
		if err := a.httpGetJSON(context.Background(), openMeteoSearch, q, a.reqTimeout(), &payload); err == nil && len(payload.Results) > 0 {
			var chosen map[string]any
			for _, row := range payload.Results {
				if strings.EqualFold(strOf(row, "name"), cleaned) &&
					strings.HasPrefix(strOf(row, "feature_code"), "PCL") {
					chosen = row
					break
				}
			}
			if chosen == nil {
				chosen = payload.Results[0]
			}
			result = map[string]any{
				"name":          strOf(chosen, "name"),
				"population":    chosen["population"],
				"country_code2": strOf(chosen, "country_code"),
				"source":        "Open-Meteo",
			}
		}
	}
	a.omCountry.Set(key, result)
	return result
}

func (a *App) loadOpenMeteoPlaceProfile(name, country string, lat, lon float64) map[string]any {
	key := omPlaceKey{name, country, lat, lon}
	if v, ok := a.omPlace.Get(key); ok {
		return v
	}
	result := map[string]any{}
	cleaned := cleanSearchQuery(name)
	if cleaned != "" {
		countryNorm := normalizeMatchText(country)
		q := url.Values{}
		q.Set("name", cleaned)
		q.Set("count", "10")
		q.Set("language", "en")
		q.Set("format", "json")
		var payload struct {
			Results []map[string]any `json:"results"`
		}
		if err := a.httpGetJSON(context.Background(), openMeteoSearch, q, a.reqTimeout(), &payload); err == nil {
			nameTokens := matchTokens(cleaned)
			var best map[string]any
			for _, row := range payload.Results {
				rowName := strOf(row, "name")
				rowCountry := strOf(row, "country")
				rowNameTokens := matchTokens(rowName)
				if len(nameTokens) > 0 && !subsetOf(nameTokens, rowNameTokens) {
					continue
				}
				if countryNorm != "" && !strings.Contains(normalizeMatchText(rowCountry), countryNorm) {
					continue
				}
				rowLat, okLat := row["latitude"].(float64)
				rowLon, okLon := row["longitude"].(float64)
				if !okLat || !okLon {
					continue
				}
				d := distanceKm(lat, lon, rowLat, rowLon)
				if d > 60 {
					continue
				}
				candidate := map[string]any{
					"name":             rowName,
					"country":          rowCountry,
					"population":       row["population"],
					"population_label": formatPopulation(row["population"]),
					"feature_code":     strOf(row, "feature_code"),
					"distance_km":      pyRound(d, 1),
					"source":           "Open-Meteo",
				}
				if best == nil || candidate["distance_km"].(float64) < best["distance_km"].(float64) {
					best = candidate
				}
			}
			if best != nil {
				result = best
			}
		}
	}
	a.omPlace.Set(key, result)
	return result
}

func (a *App) loadWikidataCountryFacts(countryName string) map[string]any {
	key := countryName
	if v, ok := a.wikidataFacts.Get(key); ok {
		return v
	}
	result := map[string]any{}
	cleaned := cleanSearchQuery(countryName)
	if cleaned != "" {
		q := url.Values{}
		q.Set("action", "wbsearchentities")
		q.Set("search", cleaned)
		q.Set("language", "en")
		q.Set("format", "json")
		q.Set("type", "item")
		q.Set("limit", "5")
		var searchPayload struct {
			Search []map[string]any `json:"search"`
		}
		if err := a.httpGetJSON(context.Background(), wikidataAPI, q, a.reqTimeout(), &searchPayload); err == nil {
			entityID := ""
			for _, hit := range searchPayload.Search {
				if strings.EqualFold(strOf(hit, "label"), cleaned) &&
					strings.Contains(strings.ToLower(strOf(hit, "description")), "country") {
					entityID = strOf(hit, "id")
					break
				}
			}
			if entityID == "" && len(searchPayload.Search) > 0 {
				entityID = strOf(searchPayload.Search[0], "id")
			}
			if entityID != "" {
				result = a.fetchWikidataGovernmentType(entityID)
			}
		}
	}
	a.wikidataFacts.Set(key, result)
	return result
}

func (a *App) fetchWikidataGovernmentType(entityID string) map[string]any {
	q := url.Values{}
	q.Set("action", "wbgetentities")
	q.Set("ids", entityID)
	q.Set("languages", "en")
	q.Set("props", "claims")
	q.Set("format", "json")
	var entityPayload struct {
		Entities map[string]map[string]any `json:"entities"`
	}
	if err := a.httpGetJSON(context.Background(), wikidataAPI, q, a.reqTimeout(), &entityPayload); err != nil {
		return map[string]any{}
	}
	entity, ok := entityPayload.Entities[entityID]
	if !ok {
		return map[string]any{}
	}
	claims, _ := entity["claims"].(map[string]any)
	governmentIDs := []string{}
	if p122, ok := claims["P122"].([]any); ok {
		for _, claimAny := range p122 {
			claim, ok := claimAny.(map[string]any)
			if !ok {
				continue
			}
			mainSnak, _ := claim["mainsnak"].(map[string]any)
			dataValue, _ := mainSnak["datavalue"].(map[string]any)
			value, _ := dataValue["value"].(map[string]any)
			if id, ok := value["id"].(string); ok && id != "" {
				governmentIDs = append(governmentIDs, id)
			}
		}
	}
	if len(governmentIDs) > 3 {
		governmentIDs = governmentIDs[:3]
	}
	if len(governmentIDs) == 0 {
		return map[string]any{}
	}
	q2 := url.Values{}
	q2.Set("action", "wbgetentities")
	q2.Set("ids", strings.Join(governmentIDs, "|"))
	q2.Set("languages", "en")
	q2.Set("props", "labels")
	q2.Set("format", "json")
	var labelsPayload struct {
		Entities map[string]map[string]any `json:"entities"`
	}
	if err := a.httpGetJSON(context.Background(), wikidataAPI, q2, a.reqTimeout(), &labelsPayload); err != nil {
		return map[string]any{}
	}
	governmentTypes := []string{}
	for _, itemID := range governmentIDs {
		entity, ok := labelsPayload.Entities[itemID]
		if !ok {
			continue
		}
		labels, _ := entity["labels"].(map[string]any)
		en, _ := labels["en"].(map[string]any)
		if v, ok := en["value"].(string); ok {
			governmentTypes = append(governmentTypes, v)
		}
	}
	return map[string]any{
		"government_type": strings.Join(dedupeText(governmentTypes), ", "),
		"source":          "Wikidata",
	}
}

func (a *App) loadCountryIntel(countryName string) map[string]any {
	key := countryName
	if v, ok := a.countryIntel.Get(key); ok {
		return v
	}
	result := map[string]any{}
	if countryName != "" {
		payloads := []url.Values{{"fullText": []string{"true"}}, {}}
		var payload []map[string]any
		ctx := context.Background()
		fatal := false
		for _, params := range payloads {
			// app.py treats non-ok responses as "try the next variant" and
			// only transport exceptions as fatal.
			var got []map[string]any
			status, err := a.httpGetJSONStatus(ctx, fmt.Sprintf(restCountriesName, url.PathEscape(countryName)), params, a.reqTimeout(), &got)
			if err != nil {
				fatal = true
				break
			}
			if status >= 200 && status < 300 {
				payload = got
				if len(payload) > 0 {
					break
				}
			}
		}
		if fatal {
			a.countryIntel.Set(key, result)
			return result
		}
		var item map[string]any
		if len(payload) > 0 {
			item = payload[0]
		}
		currencies, _ := item["currencies"].(map[string]any)
		currencyNames := []string{}
		for _, detailsAny := range currencies {
			details, _ := detailsAny.(map[string]any)
			if name := strOf(details, "name"); name != "" {
				currencyNames = append(currencyNames, name)
			}
		}
		languagesMap, _ := item["languages"].(map[string]any)
		languages := []string{}
		for _, v := range languagesMap {
			if s, ok := v.(string); ok {
				languages = append(languages, s)
			}
		}
		capitalsAny, _ := item["capital"].([]any)
		capitals := []string{}
		for _, c := range capitalsAny {
			if s, ok := c.(string); ok {
				capitals = append(capitals, s)
			}
		}
		worldBank := a.loadWorldBankPopulation(strOf(item, "cca2"))
		openMeteo := a.loadOpenMeteoCountryProfile(countryName)
		wikidata := a.loadWikidataCountryFacts(countryName)

		var population any
		for _, candidate := range []any{worldBank["population"], item["population"], openMeteo["population"]} {
			if truthy(candidate) {
				population = candidate
				break
			}
		}
		populationLabel := firstString(
			strOf(worldBank, "population_label"),
			formatPopulation(item["population"]),
			formatPopulation(openMeteo["population"]),
		)
		flags, _ := item["flags"].(map[string]any)
		demonyms, _ := item["demonyms"].(map[string]any)
		dem, _ := demonyms["eng"].(map[string]any)
		nameMap, _ := item["name"].(map[string]any)
		timezones := []any{}
		if tz, ok := item["timezones"].([]any); ok {
			timezones = tz
		}
		result = map[string]any{
			"official_name":    strOf(nameMap, "official"),
			"population":       population,
			"population_label": populationLabel,
			"population_year":  strOf(worldBank, "population_year"),
			"capital":          strings.Join(capitals, ", "),
			"region":           strOf(item, "region"),
			"subregion":        strOf(item, "subregion"),
			"area_km2":         item["area"],
			"languages":        languages,
			"currencies":       currencyNames,
			"timezones":        timezones,
			"demonym":          strOf(dem, "m"),
			"independent":      item["independent"],
			"un_member":        item["unMember"],
			"country_code2":    strOf(item, "cca2"),
			"flag":             firstString(strOf(flags, "svg"), strOf(flags, "png")),
			"government_type":  strOf(wikidata, "government_type"),
			"sources": dedupeText([]string{
				boolStr(len(item) > 0, "REST Countries"),
				boolStr(len(worldBank) > 0, "World Bank"),
				strOf(openMeteo, "source"),
				strOf(wikidata, "source"),
			}),
		}
	}
	a.countryIntel.Set(key, result)
	return result
}

func boolStr(cond bool, s string) string {
	if cond {
		return s
	}
	return ""
}

// synthesizeLocationSummary mirrors app.py synthesize_location_summary.
func synthesizeLocationSummary(name, country string, countryIntel map[string]any) string {
	parts := []string{}
	if name != "" {
		parts = append(parts, fmt.Sprintf("%s is in %s", name, firstString(country, "its country/region")))
	}
	if region := strOf(countryIntel, "region"); region != "" {
		regionBits := []string{region, strOf(countryIntel, "subregion")}
		filtered := []string{}
		for _, bit := range regionBits {
			if bit != "" {
				filtered = append(filtered, bit)
			}
		}
		if len(parts) > 0 {
			parts[len(parts)-1] = fmt.Sprintf("%s, in %s", parts[len(parts)-1], strings.Join(filtered, " / "))
		}
	}
	if capital := strOf(countryIntel, "capital"); capital != "" {
		parts = append(parts, "The capital is "+capital)
	}
	if label := strOf(countryIntel, "population_label"); label != "" {
		parts = append(parts, "population "+label)
	}
	languagesAny, _ := countryIntel["languages"].([]any)
	languages := []string{}
	for _, l := range languagesAny {
		if s, ok := l.(string); ok {
			languages = append(languages, s)
		}
	}
	if len(languages) > 3 {
		languages = languages[:3]
	}
	if len(languages) > 0 {
		parts = append(parts, "main languages: "+strings.Join(languages, ", "))
	}
	currenciesAny, _ := countryIntel["currencies"].([]any)
	currencies := []string{}
	for _, c := range currenciesAny {
		if s, ok := c.(string); ok {
			currencies = append(currencies, s)
		}
	}
	if len(currencies) > 2 {
		currencies = currencies[:2]
	}
	if len(currencies) > 0 {
		parts = append(parts, "currency: "+strings.Join(currencies, ", "))
	}
	statusBits := []string{}
	if truthy(countryIntel["independent"]) {
		statusBits = append(statusBits, "independent")
	}
	if truthy(countryIntel["un_member"]) {
		statusBits = append(statusBits, "UN member")
	}
	if len(statusBits) > 0 {
		parts = append(parts, strings.Join(statusBits, ", "))
	}
	if len(parts) == 0 {
		return ""
	}
	cleaned := []string{}
	for _, part := range parts {
		if part != "" {
			cleaned = append(cleaned, strings.TrimSuffix(part, "."))
		}
	}
	return strings.Join(cleaned, ". ") + "."
}

func (a *App) searchWikipediaTitles(query string, limit int) []string {
	key := wikiSearchKey{query, limit}
	if v, ok := a.wikiTitles.Get(key); ok {
		return v
	}
	result := []string{}
	cleaned := cleanSearchQuery(query)
	if cleaned != "" {
		srlimit := limit
		if srlimit < 1 {
			srlimit = 1
		}
		if srlimit > 10 {
			srlimit = 10
		}
		q := url.Values{}
		q.Set("action", "query")
		q.Set("list", "search")
		q.Set("srsearch", cleaned)
		q.Set("format", "json")
		q.Set("utf8", "1")
		q.Set("srlimit", fmt.Sprintf("%d", srlimit))
		var payload struct {
			Query struct {
				Search []map[string]any `json:"search"`
			} `json:"query"`
		}
		if err := a.httpGetJSON(context.Background(), wikipediaAPI, q, a.reqTimeout(), &payload); err == nil {
			for _, hit := range payload.Query.Search {
				if title := strOf(hit, "title"); title != "" {
					result = append(result, title)
				}
			}
		}
	}
	a.wikiTitles.Set(key, result)
	return result
}

func (a *App) loadWikipediaSummaryByTitle(title string) map[string]any {
	key := title
	if v, ok := a.wikiSummary.Get(key); ok {
		return v
	}
	result := map[string]any{}
	if title != "" {
		var payload struct {
			// RawMessage distinguishes a missing title (fall back to the
			// requested title) from an explicit empty one, like Python's
			// payload.get("title", title).
			Title       json.RawMessage `json:"title"`
			Extract     string          `json:"extract"`
			Description string          `json:"description"`
			Thumbnail   struct {
				Source string `json:"source"`
			} `json:"thumbnail"`
			ContentURLs struct {
				Desktop struct {
					Page string `json:"page"`
				} `json:"desktop"`
			} `json:"content_urls"`
		}
		if err := a.httpGetJSON(context.Background(), fmt.Sprintf(wikipediaSummary, url.PathEscape(title)), nil, a.reqTimeout(), &payload); err == nil {
			t := title
			if len(payload.Title) > 0 && string(payload.Title) != "null" {
				var got string
				if err := json.Unmarshal(payload.Title, &got); err == nil {
					t = got
				}
			}
			result = map[string]any{
				"title":       t,
				"summary":     payload.Extract,
				"description": payload.Description,
				"image":       payload.Thumbnail.Source,
				"content_url": payload.ContentURLs.Desktop.Page,
			}
		}
	}
	a.wikiSummary.Set(key, result)
	return result
}

func placeTitleMatches(name, country, title string) bool {
	nameTokens := matchTokens(name)
	titleTokens := matchTokens(title)
	if len(nameTokens) == 0 || len(titleTokens) == 0 {
		return false
	}
	return subsetOf(nameTokens, titleTokens)
}

func satelliteReferenceLooksReliable(query string, summary map[string]any) bool {
	queryNorm := normalizeMatchText(query)
	titleNorm := normalizeMatchText(strOf(summary, "title"))
	if queryNorm == "" || titleNorm == "" {
		return false
	}
	compactQuery := strings.ReplaceAll(queryNorm, " ", "")
	compactTitle := strings.ReplaceAll(titleNorm, " ", "")
	if compactQuery != "" && (compactQuery == compactTitle ||
		strings.Contains(compactTitle, compactQuery) ||
		strings.Contains(compactQuery, compactTitle)) {
		return true
	}
	queryTokens := matchTokens(query)
	titleTokens := matchTokens(strOf(summary, "title"))
	if len(queryTokens) > 0 && subsetOf(queryTokens, titleTokens) {
		descBlob := strings.ToLower(strings.Join([]string{
			strOf(summary, "title"),
			strOf(summary, "description"),
			strOf(summary, "summary"),
		}, " "))
		for _, token := range []string{
			"satellite", "spacecraft", "space station", "orbital",
			"orbit", "telescope", "observatory", "rocket", "debris",
		} {
			if strings.Contains(descBlob, token) {
				return true
			}
		}
	}
	return false
}

func (a *App) loadPlaceReference(name, country string, lat, lon float64) map[string]any {
	q := url.Values{}
	q.Set("action", "query")
	q.Set("list", "geosearch")
	q.Set("gscoord", floatParam(pyRound(lat, 4))+"|"+floatParam(pyRound(lon, 4)))
	q.Set("gsradius", "20000")
	q.Set("gslimit", "8")
	q.Set("format", "json")
	var payload struct {
		Query struct {
			Geosearch []map[string]any `json:"geosearch"`
		} `json:"query"`
	}
	if err := a.httpGetJSON(context.Background(), wikipediaAPI, q, a.reqTimeout(), &payload); err == nil {
		for _, hit := range payload.Query.Geosearch {
			title := strOf(hit, "title")
			if !placeTitleMatches(name, country, title) {
				continue
			}
			summary := a.loadWikipediaSummaryByTitle(title)
			if len(summary) > 0 {
				return summary
			}
		}
	}
	variants := []string{name}
	if country != "" {
		variants = []string{fmt.Sprintf("%s, %s", name, country), name}
	}
	for _, variant := range variants {
		for _, title := range a.searchWikipediaTitles(variant, 5) {
			if !placeTitleMatches(name, country, title) {
				continue
			}
			summary := a.loadWikipediaSummaryByTitle(title)
			if len(summary) > 0 {
				return summary
			}
		}
	}
	return map[string]any{}
}

func (a *App) loadNearbyLandmarks(lat, lon float64) []map[string]any {
	key := latlonKey{lat, lon}
	if v, ok := a.landmarks.Get(key); ok {
		return v
	}
	result := []map[string]any{}
	q := url.Values{}
	q.Set("action", "query")
	q.Set("list", "geosearch")
	q.Set("gscoord", floatParam(lat)+"|"+floatParam(lon))
	q.Set("gsradius", "10000")
	q.Set("gslimit", "6")
	q.Set("format", "json")
	var payload struct {
		Query struct {
			Geosearch []map[string]any `json:"geosearch"`
		} `json:"query"`
	}
	if err := a.httpGetJSON(context.Background(), wikipediaAPI, q, a.reqTimeout(), &payload); err == nil {
		for _, row := range payload.Query.Geosearch {
			title := strOf(row, "title")
			if title == "" {
				title = "Unknown"
			}
			result = append(result, map[string]any{
				"title":      title,
				"distance_m": row["dist"],
				"pageid":     row["pageid"],
			})
		}
	}
	a.landmarks.Set(key, result)
	return result
}

func (a *App) buildLocationIntel(name, country string, lat, lon float64) map[string]any {
	wiki := a.loadPlaceReference(name, country, lat, lon)
	countryIntel := a.loadCountryIntel(country)
	placeIntel := a.loadOpenMeteoPlaceProfile(name, country, pyRound(lat, 3), pyRound(lon, 3))
	landmarks := a.loadNearbyLandmarks(pyRound(lat, 2), pyRound(lon, 2))

	summary := strOf(wiki, "summary")
	if summary == "" {
		summary = synthesizeLocationSummary(name, country, countryIntel)
	}
	sourcesExtra := []string{}
	if ci, ok := countryIntel["sources"].([]any); ok {
		for _, s := range ci {
			if str, ok := s.(string); ok {
				sourcesExtra = append(sourcesExtra, str)
			}
		}
	}
	return map[string]any{
		"name":          name,
		"country":       country,
		"lat":           lat,
		"lon":           lon,
		"summary":       summary,
		"description":   strOf(wiki, "description"),
		"image":         strOf(wiki, "image"),
		"content_url":   strOf(wiki, "content_url"),
		"place_intel":   placeIntel,
		"country_intel": countryIntel,
		"landmarks":     landmarks,
		"sources": dedupeText(append([]string{
			boolStr(len(wiki) > 0, "Wikipedia"),
			boolStr(len(landmarks) > 0, "Wikipedia Geosearch"),
			strOf(placeIntel, "source"),
		}, sourcesExtra...)),
	}
}

func (a *App) searchPlaces(query string) []map[string]any {
	cleaned := cleanSearchQuery(query)
	if utf8.RuneCountInString(cleaned) < 2 {
		return []map[string]any{}
	}
	items := []map[string]any{}
	q := url.Values{}
	q.Set("q", cleaned)
	q.Set("format", "jsonv2")
	q.Set("limit", "8")
	q.Set("addressdetails", "1")
	q.Set("accept-language", "en")
	var rows []map[string]any
	if err := a.httpGetJSON(context.Background(), nominatimSearch, q, a.reqTimeout(), &rows); err == nil {
		parsed := []map[string]any{}
		failed := false
		for _, row := range rows {
			address, _ := row["address"].(map[string]any)
			name := strOf(row, "name")
			if name == "" {
				display := strOf(row, "display_name")
				if display == "" {
					display = "Unknown place"
				}
				name = strings.Split(display, ",")[0]
			}
			displayName := strOf(row, "display_name")
			if displayName == "" {
				displayName = "Unknown place"
			}
			latRaw, okLat := row["lat"].(string)
			lonRaw, okLon := row["lon"].(string)
			if !okLat || !okLon {
				failed = true
				break
			}
			latF, err1 := strconv.ParseFloat(latRaw, 64)
			lonF, err2 := strconv.ParseFloat(lonRaw, 64)
			if err1 != nil || err2 != nil {
				failed = true
				break
			}
			parsed = append(parsed, map[string]any{
				"name":         name,
				"display_name": displayName,
				"lat":          latF,
				"lon":          lonF,
				"country":      strOf(address, "country"),
				"country_code": strings.ToUpper(strOf(address, "country_code")),
			})
		}
		if !failed {
			items = parsed
		}
	}
	if len(items) > 0 {
		return items
	}
	q2 := url.Values{}
	q2.Set("name", cleaned)
	q2.Set("count", "8")
	q2.Set("language", "en")
	q2.Set("format", "json")
	var payload struct {
		Results []map[string]any `json:"results"`
	}
	fallback := []map[string]any{}
	if err := a.httpGetJSON(context.Background(), openMeteoSearch, q2, a.reqTimeout(), &payload); err == nil {
		for _, row := range payload.Results {
			parts := []string{}
			for _, p := range []string{strOf(row, "name"), strOf(row, "admin1"), strOf(row, "country")} {
				if p != "" {
					parts = append(parts, p)
				}
			}
			displayName := strings.Join(parts, ", ")
			name := strOf(row, "name")
			if name == "" {
				name = "Unknown place"
			}
			latF, okLat := row["latitude"].(float64)
			lonF, okLon := row["longitude"].(float64)
			if !okLat || !okLon {
				continue
			}
			fallback = append(fallback, map[string]any{
				"name":         name,
				"display_name": firstString(displayName, name),
				"lat":          latF,
				"lon":          lonF,
				"country":      strOf(row, "country"),
				"country_code": strings.ToUpper(strOf(row, "country_code")),
			})
		}
	}
	return fallback
}
