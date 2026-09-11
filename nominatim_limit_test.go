package main

import (
	"context"
	"testing"
	"time"

	"golang.org/x/time/rate"
)

func TestNominatimLimiterSheds(t *testing.T) {
	orig := nominatimLimiter
	t.Cleanup(func() { nominatimLimiter = orig })

	// Burst of 1 and a refill far slower than the wait timeout: the first call
	// takes the token, the second must give up rather than queue forever.
	nominatimLimiter = rate.NewLimiter(rate.Every(time.Hour), 1)

	if err := awaitNominatim(context.Background()); err != nil {
		t.Fatalf("first call should pass the budget, got %v", err)
	}
	start := time.Now()
	if err := awaitNominatim(context.Background()); err == nil {
		t.Fatal("second call should be shed, got nil")
	}
	if waited := time.Since(start); waited > nominatimWaitTimeout+time.Second {
		t.Fatalf("shed took %v, should bail near %v", waited, nominatimWaitTimeout)
	}
}

func TestIsNominatimURL(t *testing.T) {
	// Literals, not the package vars: other tests repoint those at stub servers.
	for _, u := range []string{
		"https://nominatim.openstreetmap.org/reverse",
		"https://nominatim.openstreetmap.org/search",
	} {
		if !isNominatimURL(u) {
			t.Fatalf("%s must be gated", u)
		}
	}
	for _, u := range []string{
		"https://api.bigdatacloud.net/data/reverse-geocode-client",
		"http://127.0.0.1:8080/nominatim/reverse",
	} {
		if isNominatimURL(u) {
			t.Fatalf("%s must not be gated", u)
		}
	}
}
