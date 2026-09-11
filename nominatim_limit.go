package main

import (
	"context"
	"errors"
	"strings"
	"time"

	"golang.org/x/time/rate"
)

// The OSM Nominatim usage policy caps absolute traffic at 1 request/second per
// application, counted at our egress IP -- not per client. The per-IP HTTP
// limiter in ratelimit.go cannot enforce that: it is per caller, and the
// geocoding caches are keyed on rounded coordinates, so a client walking a
// coordinate grid misses the cache on every request and each miss becomes an
// outbound call (up to five, in the zoom ladder in reverseGeocodePlaceNominatim).
// Exceeding the policy gets the egress IP blocked, which takes geocoding down
// for everyone. So the whole process shares one bucket.
var nominatimLimiter = rate.NewLimiter(rate.Every(time.Second), 1)

// nominatimWaitTimeout bounds how long a request will queue for the bucket.
// Long enough to smooth out bursts from a normal page load, short enough that a
// flood sheds instead of pinning every handler goroutine on the limiter.
const nominatimWaitTimeout = 2 * time.Second

var errNominatimBudget = errors.New("nominatim rate budget exhausted")

func isNominatimURL(rawURL string) bool {
	return strings.HasPrefix(rawURL, "https://nominatim.openstreetmap.org/")
}

// awaitNominatim blocks until the shared budget allows another call, or gives
// up. Callers treat the error as "no result" and fall back, so shedding here
// degrades a label to Unknown rather than failing the request.
func awaitNominatim(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, nominatimWaitTimeout)
	defer cancel()
	if err := nominatimLimiter.Wait(ctx); err != nil {
		return errNominatimBudget
	}
	return nil
}
