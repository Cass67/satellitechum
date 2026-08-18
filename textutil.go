package main

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

var (
	nonAlnumRE = regexp.MustCompile(`[^a-z0-9]+`)
)

func clamp(v, lo, hi float64) float64 { return max(lo, min(hi, v)) }

// pyMod mirrors Python's % operator (result takes divisor's sign).
func pyMod(a, b float64) float64 {
	r := math.Mod(a, b)
	if r < 0 && b > 0 {
		r += b
	}
	return r
}

// cleanSearchQuery mirrors app.py _clean_search_query.
func cleanSearchQuery(value string) string {
	if value == "" {
		return ""
	}
	collapsed := strings.Join(strings.Fields(value), " ")
	if utf8.RuneCountInString(collapsed) > searchMax {
		collapsed = string([]rune(collapsed)[:searchMax])
	}
	return collapsed
}

// normalizeMatchText mirrors app.py _normalize_match_text (casefold +
// non-alphanumeric to spaces).
func normalizeMatchText(value string) string {
	return strings.TrimSpace(nonAlnumRE.ReplaceAllString(strings.ToLower(value), " "))
}

// matchTokens mirrors app.py _match_tokens, returned as a set.
func matchTokens(value string) map[string]bool {
	set := map[string]bool{}
	for _, token := range strings.Split(normalizeMatchText(value), " ") {
		if token != "" {
			set[token] = true
		}
	}
	return set
}

func subsetOf(sub, sup map[string]bool) bool {
	for k := range sub {
		if !sup[k] {
			return false
		}
	}
	return true
}

// dedupeText mirrors app.py _dedupe_text.
func dedupeText(values []string) []string {
	seen := map[string]bool{}
	output := []string{}
	for _, value := range values {
		cleaned := strings.TrimSpace(value)
		if cleaned == "" {
			continue
		}
		key := strings.ToLower(cleaned)
		if seen[key] {
			continue
		}
		seen[key] = true
		output = append(output, cleaned)
	}
	return output
}

// formatPopulation mirrors app.py _format_population.
func formatPopulation(value any) string {
	if !truthy(value) {
		return ""
	}
	number, ok := value.(float64)
	if !ok {
		return ""
	}
	switch {
	case number >= 1_000_000_000:
		return fmt.Sprintf("%.2fB", number/1_000_000_000)
	case number >= 1_000_000:
		return fmt.Sprintf("%.1fM", number/1_000_000)
	case number >= 1_000:
		return fmt.Sprintf("%.1fK", number/1_000)
	}
	return strconv.Itoa(int(number))
}

// distanceKm is the haversine distance (app.py _distance_km).
func distanceKm(latA, lonA, latB, lonB float64) float64 {
	lat1, lon1 := latA*math.Pi/180, lonA*math.Pi/180
	lat2, lon2 := latB*math.Pi/180, lonB*math.Pi/180
	dlat := lat2 - lat1
	dlon := lon2 - lon1
	a := math.Sin(dlat/2)*math.Sin(dlat/2) +
		math.Cos(lat1)*math.Cos(lat2)*math.Sin(dlon/2)*math.Sin(dlon/2)
	return 2 * earthRadiusKm * math.Asin(min(1.0, math.Sqrt(a)))
}

func isFinite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }

// mergeMaps returns a new map with all entries of base plus overrides.
func mergeMaps(base map[string]any, overrides map[string]any) map[string]any {
	out := make(map[string]any, len(base)+len(overrides))
	for k, v := range base {
		out[k] = v
	}
	for k, v := range overrides {
		out[k] = v
	}
	return out
}

// firstString returns the first non-empty of the given values.
func firstString(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
