package main

import "sync"

// lruCache mirrors functools.lru_cache: unbounded-TTL, capacity-bounded,
// most-recently-used last. Values are cached as-is (including empty maps,
// matching Python's behavior of caching falsy results).
type lruCache[K comparable, V any] struct {
	mu    sync.Mutex
	cap   int
	order []K
	m     map[K]V
}

func newLRUCache[K comparable, V any](cap int) *lruCache[K, V] {
	return &lruCache[K, V]{cap: cap, m: map[K]V{}}
}

func (c *lruCache[K, V]) Get(k K) (V, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	v, ok := c.m[k]
	if !ok {
		var zero V
		return zero, false
	}
	for i, key := range c.order {
		if key == k {
			c.order = append(c.order[:i], c.order[i+1:]...)
			break
		}
	}
	c.order = append(c.order, k)
	return v, true
}

func (c *lruCache[K, V]) Set(k K, v V) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.m[k]; !ok {
		if len(c.m) >= c.cap {
			delete(c.m, c.order[0])
			c.order = c.order[1:]
		}
		c.order = append(c.order, k)
	}
	c.m[k] = v
}

// ttlCacheEntry is a fetched value with its fetch time (satcat-style caches).
type ttlCacheEntry struct {
	details   map[string]any
	fetchedAt float64
}

type ttlCache struct {
	mu    sync.Mutex
	items map[int]ttlCacheEntry
}

func newTTLCache() *ttlCache { return &ttlCache{items: map[int]ttlCacheEntry{}} }

func (c *ttlCache) get(catnr int, now float64, successTTL, failureTTL float64) (map[string]any, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.items[catnr]
	if !ok {
		return nil, false
	}
	ttl := successTTL
	if len(e.details) == 0 {
		ttl = failureTTL
	}
	if now-e.fetchedAt >= ttl {
		return nil, false
	}
	return e.details, true
}

func (c *ttlCache) set(catnr int, details map[string]any, now float64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.items[catnr] = ttlCacheEntry{details: details, fetchedAt: now}
}
