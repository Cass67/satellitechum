const state = {
    allSatellites: [],
    satellites: [],
    currentIndex: 0,
    serviceFilter: "all",
    satelliteLimit: 100,
    perspectiveLabelLimit: 5,
    theme: "night",
    sliderMinutes: 720,
    isPlaying: false,
    showOrbitTrace: false,
    showOverlay: false,
    playTimer: null,
    globe: null,
    countryAbort: null,
    searchTimer: null,
    selectedLocation: null,
    countryLabels: [],
    countryMarkers: [],
    detailsCache: new Map(),
    detailsInFlight: new Map(),
    detailsRequestedAt: new Map(),
    locationIntelCache: new Map(),
    countryCache: new Map(),
    countryKey: "",
    countryUpdatedAt: 0,
    satelliteRefreshLoop: null,
    satelliteWarmRetryTimer: null,
    overlayVisibleNow: [],
    overlayFrame: null,
    overlayHitTargets: [],
    overlayZoom: 1,
    overlayAzimuthOffsetDeg: 0,
    overlayPitchDeg: 0,
    overlayDragging: false,
    overlayPointerId: null,
    overlayLastPointer: null,
    overlayDidDrag: false,
    perspectiveMode: "location",
    perspectiveTarget: null,
    perspectiveLabelAbort: null,
    perspectiveLabelKey: "",
};

const elements = {
    satelliteCount: document.getElementById("satelliteCount"),
    satelliteSourceLabel: document.getElementById("satelliteSourceLabel"),
    heroFocusedSatellite: document.getElementById("heroFocusedSatellite"),
    heroFocusedMeta: document.getElementById("heroFocusedMeta"),
    heroSelectedPlace: document.getElementById("heroSelectedPlace"),
    heroSelectedMeta: document.getElementById("heroSelectedMeta"),
    heroSourceGroups: document.getElementById("heroSourceGroups"),
    timelineStatus: document.getElementById("timelineStatus"),
    timelineLoadingDot: document.getElementById("timelineLoadingDot"),
    globeLoading: document.getElementById("globeLoading"),
    globeLoadingText: document.getElementById("globeLoadingText"),
    globeLoadingMeta: document.getElementById("globeLoadingMeta"),
    themeNightButton: document.getElementById("themeNightButton"),
    themeDayButton: document.getElementById("themeDayButton"),
    perspectiveLabelLimit: document.getElementById("perspectiveLabelLimit"),
    overlayToggle: document.getElementById("overlayToggle"),
    locationSearch: document.getElementById("locationSearch"),
    searchButton: document.getElementById("searchButton"),
    searchButtonLabel: document.getElementById("searchButtonLabel"),
    searchLoadingDot: document.getElementById("searchLoadingDot"),
    noradSearch: document.getElementById("noradSearch"),
    noradSearchButton: document.getElementById("noradSearchButton"),
    noradSearchButtonLabel: document.getElementById("noradSearchButtonLabel"),
    noradSearchLoadingDot: document.getElementById("noradSearchLoadingDot"),
    searchResults: document.getElementById("searchResults"),
    serviceFilter: document.getElementById("serviceFilter"),
    satelliteLimit: document.getElementById("satelliteLimit"),
    satelliteSelect: document.getElementById("satelliteSelect"),
    timeSlider: document.getElementById("timeSlider"),
    timeLabel: document.getElementById("timeLabel"),
    countryName: document.getElementById("countryName"),
    countryLoadingDot: document.getElementById("countryLoadingDot"),
    countryCode: document.getElementById("countryCode"),
    positionLabel: document.getElementById("positionLabel"),
    altitudeLabel: document.getElementById("altitudeLabel"),
    velocityLabel: document.getElementById("velocityLabel"),
    satelliteNameLabel: document.getElementById("satelliteNameLabel"),
    satelliteMetaLabel: document.getElementById("satelliteMetaLabel"),
    satellitePurposeLabel: document.getElementById("satellitePurposeLabel"),
    satellitePurposeMeta: document.getElementById("satellitePurposeMeta"),
    satelliteLoadingDot: document.getElementById("satelliteLoadingDot"),
    satelliteSummary: document.getElementById("satelliteSummary"),
    satelliteLink: document.getElementById("satelliteLink"),
    satelliteFactGrid: document.getElementById("satelliteFactGrid"),
    playPauseButton: document.getElementById("playPauseButton"),
    orbitTraceToggle: document.getElementById("orbitTraceToggle"),
    selectedLocationName: document.getElementById("selectedLocationName"),
    selectedLocationMeta: document.getElementById("selectedLocationMeta"),
    searchSummary: document.getElementById("searchSummary"),
    intelStatus: document.getElementById("intelStatus"),
    intelLoadingDot: document.getElementById("intelLoadingDot"),
    intelImage: document.getElementById("intelImage"),
    intelTitle: document.getElementById("intelTitle"),
    intelSubtitle: document.getElementById("intelSubtitle"),
    intelSummary: document.getElementById("intelSummary"),
    intelLink: document.getElementById("intelLink"),
    intelFacts: document.getElementById("intelFacts"),
    intelLandmarks: document.getElementById("intelLandmarks"),
    overheadCount: document.getElementById("overheadCount"),
    overheadList: document.getElementById("overheadList"),
    orbitCount: document.getElementById("orbitCount"),
    orbitSummary: document.getElementById("orbitSummary"),
    orbitFocusTitle: document.getElementById("orbitFocusTitle"),
    orbitFocusMeta: document.getElementById("orbitFocusMeta"),
    orbitFocusWindow: document.getElementById("orbitFocusWindow"),
    orbitFocusWindowMeta: document.getElementById("orbitFocusWindowMeta"),
    orbitFocusRelationship: document.getElementById("orbitFocusRelationship"),
    orbitFocusRelationshipMeta: document.getElementById("orbitFocusRelationshipMeta"),
    orbitFocusAltitude: document.getElementById("orbitFocusAltitude"),
    orbitFocusVelocity: document.getElementById("orbitFocusVelocity"),
    orbitalOverlay: document.getElementById("orbitalOverlay"),
    skyPlotOverlay: document.getElementById("skyPlotOverlay"),
    overlayMeta: document.getElementById("overlayMeta"),
    overlayModeBadge: document.getElementById("overlayModeBadge"),
    overlayModeSummary: document.getElementById("overlayModeSummary"),
};

const EARTH_RADIUS_KM = 6371;
const DEG_TO_RAD = Math.PI / 180;
const SATELLITE_DETAILS_RETRY_MS = 5 * 60 * 1000;
const SATELLITE_DETAILS_CACHE_TTL_MS = 1000 * 60 * 60 * 24;
const LOCATION_INTEL_CACHE_TTL_MS = 1000 * 60 * 60 * 12;
const SATELLITE_POLL_VISIBLE_MS = 30 * 1000;
const SATELLITE_POLL_HIDDEN_MS = 3 * 60 * 1000;
const SATELLITE_WARM_RETRY_MS = 1800;
const TIMELINE_PLAY_INTERVAL_MS = 180;
const TIMELINE_PLAY_STEP_MINUTES = 1;
const COUNTRY_REFRESH_WHILE_PLAYING_MS = 900;
const OVERLAY_MIN_ZOOM = 1;
const OVERLAY_MAX_ZOOM = 2.8;
const OVERLAY_MAX_PITCH_DEG = 32;
const OVERLAY_AZIMUTH_DRAG_DEG = 0.18;
const OVERLAY_PITCH_DRAG_DEG = 0.12;
const PERSISTENT_CACHE_PREFIX = "satellite-chum-cache:";
const PERSISTENT_CACHE_DB_NAME = "satellite_chum_cache";
const PERSISTENT_CACHE_DB_VERSION = 1;
const PERSISTENT_CACHE_STORE = "entries";
let persistentCacheDbPromise = null;
const ASSET_ROOT = "/static/assets";
const earthOverlayImage = new Image();
earthOverlayImage.addEventListener("load", () => {
    if (elements.skyPlotOverlay && state.satellites.length) {
        renderPerspectivePanel(timeFromSlider(state.sliderMinutes));
    }
});
earthOverlayImage.src = `${ASSET_ROOT}/earth-night.jpg`;
const EARTH_TEXTURES = {
    night: `${ASSET_ROOT}/earth-night.jpg`,
    day: `${ASSET_ROOT}/earth-blue-marble.jpg`,
};
const satelliteIconSvg = encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <g fill="none" stroke="#dff6ff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <rect x="24" y="24" width="16" height="16" rx="2" fill="#0ea5e9" stroke="#dff6ff"/>
    <rect x="6" y="25" width="14" height="14" rx="2" fill="#07131f"/>
    <rect x="44" y="25" width="14" height="14" rx="2" fill="#07131f"/>
    <path d="M20 32H24M40 32H44M32 40v10"/>
    <circle cx="32" cy="53" r="3" fill="#fbbf24" stroke="#fbbf24"/>
  </g>
</svg>
`);

function createSatelliteBillboard(item) {
    const node = document.createElement("button");
    node.type = "button";
    node.className = `sat-billboard${item.focused ? " focused" : ""}${item.overhead ? " overhead" : ""}`;
    const icon = document.createElement("img");
    icon.className = "sat-billboard__icon";
    icon.alt = "";
    icon.src = `data:image/svg+xml;charset=utf-8,${satelliteIconSvg}`;
    const label = document.createElement("span");
    label.className = "sat-billboard__label";
    label.textContent = item.name;
    node.append(icon, label);
    node.title = item.name;
    node.addEventListener("click", (event) => {
        event.stopPropagation();
        focusSatellite(item.index, satelliteInspectOptions({ zoomWhenGlobal: true }));
    });
    return node;
}

function buildGlobe() {
    const globe = Globe()(document.getElementById("globeViz"))
        .globeImageUrl(EARTH_TEXTURES.night)
        .bumpImageUrl(`${ASSET_ROOT}/earth-topology.png`)
        .backgroundColor("rgba(0,0,0,0)")
        .showAtmosphere(true)
        .atmosphereColor("#87d7ff")
        .atmosphereAltitude(0.18)
        .pointsData([])
        .pointLat("lat")
        .pointLng("lng")
        .pointAltitude("altitude")
        .pointColor("color")
        .pointRadius("size")
        .pointsMerge(true)
        .labelsData([])
        .labelLat("lat")
        .labelLng("lng")
        .labelAltitude("altitude")
        .labelText("text")
        .labelColor("color")
        .labelSize("size")
        .labelDotRadius("dot")
        .labelResolution(2)
        .htmlElementsData([])
        .htmlLat("lat")
        .htmlLng("lng")
        .htmlAltitude("altitude")
        .htmlElement((item) => item.kind === "satellite" ? createSatelliteBillboard(item) : document.createElement("div"))
        .onLabelClick((item) => {
            if (item.kind === "satellite" && typeof item.index === "number") {
                focusSatellite(item.index, satelliteInspectOptions({ zoomWhenGlobal: true }));
                return;
            }
            if (item.kind === "country" || item.kind === "location") {
                setSelectedLocation(item);
                zoomToLocation(item);
                setOverlayMode(true);
                updateScene();
            }
        })
        .onPointClick((item) => {
            if (item.kind === "satellite" && typeof item.index === "number") {
                focusSatellite(item.index, satelliteInspectOptions({ zoomWhenGlobal: true }));
                return;
            }
            if (item.kind === "country" || item.kind === "location") {
                setSelectedLocation(item);
                zoomToLocation(item);
                setOverlayMode(true);
                updateScene();
            }
        })
        .pathPoints("points")
        .pathPointLat("lat")
        .pathPointLng("lng")
        .pathPointAlt("altitude")
        .pathColor("color")
        .pathStroke("stroke")
        .pathDashLength(1)
        .pathDashGap(0)
        .pathDashAnimateTime(0)
        .pathTransitionDuration(0)
        .labelsData([])
        .width(document.getElementById("globeViz").clientWidth)
        .height(document.getElementById("globeViz").clientHeight);

    globe.controls().autoRotate = false;
    globe.controls().autoRotateSpeed = 0;
    globe.pointOfView({ altitude: 2.2 }, 0);
    state.globe = globe;
    applyGlobeTheme();

    window.addEventListener("resize", () => {
        globe.width(document.getElementById("globeViz").clientWidth);
        globe.height(document.getElementById("globeViz").clientHeight);
    });
}

function applyGlobeTheme() {
    if (!state.globe) {
        return;
    }
    const theme = state.theme === "day" ? "day" : "night";
    state.globe.globeImageUrl(EARTH_TEXTURES[theme]);
    state.globe.atmosphereColor(theme === "day" ? "#a9d6ff" : "#87d7ff");
    state.globe.atmosphereAltitude(theme === "day" ? 0.14 : 0.18);
    earthOverlayImage.src = EARTH_TEXTURES[theme];
}

function refreshGlobeRender() {
    if (!state.globe) {
        return;
    }
    const pointOfView = state.globe.pointOfView?.() || {};
    const refresh = () => {
        state.globe.pointOfView(
            {
                lat: pointOfView.lat,
                lng: pointOfView.lng,
                altitude: pointOfView.altitude,
            },
            0,
        );
        if (state.satellites.length) {
            updateScene();
        }
    };
    window.requestAnimationFrame(() => {
        refresh();
        window.requestAnimationFrame(refresh);
    });
}

function timeFromSlider(minutes) {
    const base = new Date();
    base.setSeconds(0, 0);
    return new Date(base.getTime() + (minutes - 720) * 60 * 1000);
}

function formatLatLng(lat, lng) {
    const ns = lat >= 0 ? "N" : "S";
    const ew = lng >= 0 ? "E" : "W";
    return `${Math.abs(lat).toFixed(2)}° ${ns}, ${Math.abs(lng).toFixed(2)}° ${ew}`;
}

function humanizeStatus(code) {
    const statusMap = {
        "+": "Operational",
        "-": "Nonoperational",
        P: "Partially operational",
        B: "Backup or standby",
        S: "Spare",
        X: "Extended mission",
        D: "Decayed",
        "?": "Unknown status",
    };
    return code ? (statusMap[code] || code) : "Unspecified";
}

function humanizeObjectType(code) {
    const typeMap = {
        PAY: "Payload satellite",
        R_B: "Rocket body",
        "R/B": "Rocket body",
        DEB: "Debris",
        TBA: "To be announced",
        UNK: "Unknown object",
    };
    return code ? (typeMap[code] || code) : "";
}

function humanizeOwner(details) {
    if (details.owner_label) {
        return details.owner_label;
    }
    if (details.raw?.OWNER_DESC) {
        return details.raw.OWNER_DESC;
    }
    const ownerMap = {
        CIS: "Commonwealth of Independent States",
        US: "United States",
        UK: "United Kingdom",
        PRC: "China",
        ESA: "European Space Agency",
        JPN: "Japan",
        INDO: "Indonesia",
        GER: "Germany",
        FR: "France",
    };
    return details.owner ? (ownerMap[details.owner] || details.owner) : "";
}

function humanizeConfidenceLevel(level) {
    if (level === "high") {
        return "High confidence";
    }
    if (level === "medium") {
        return "Medium confidence";
    }
    if (level === "low") {
        return "Low confidence";
    }
    return "Unverified";
}

function renderSatelliteFacts(facts) {
    elements.satelliteFactGrid.innerHTML = "";
    for (const fact of facts.filter((item) => item.value)) {
        const node = document.createElement("div");
        node.className = "satellite-fact";
        const label = document.createElement("span");
        label.textContent = fact.label;
        const value = document.createElement("strong");
        value.textContent = fact.value;
        node.append(label, value);
        elements.satelliteFactGrid.appendChild(node);
    }
}

function renderInfoFacts(container, facts) {
    container.innerHTML = "";
    for (const fact of facts.filter((item) => item.value)) {
        const node = document.createElement("div");
        node.className = "intel-fact";
        const label = document.createElement("span");
        label.textContent = fact.label;
        const value = document.createElement("strong");
        value.textContent = fact.value;
        node.append(label, value);
        container.appendChild(node);
    }
}

function humanizeSatelliteSource(payload) {
    const groups = payload.source_groups || [];
    if (groups.includes("satnogs-tle")) {
        return "SatNOGS live TLE";
    }
    if (payload.source === "fallback") {
        return "Fallback sample set";
    }
    if (groups.length) {
        return `CelesTrak ${groups.join(" + ")}`;
    }
    return "Live satellite source";
}

function renderHeroSourceGroups(groups = []) {
    if (!elements.heroSourceGroups) {
        return;
    }
    elements.heroSourceGroups.innerHTML = "";
    const values = groups.length ? groups : ["pending"];
    for (const value of values) {
        const chip = document.createElement("span");
        chip.className = "hero-source-chip";
        chip.textContent = value;
        elements.heroSourceGroups.appendChild(chip);
    }
}

function updateHeroQuickStatus() {
    if (elements.heroSelectedPlace) {
        if (state.selectedLocation) {
            elements.heroSelectedPlace.textContent = state.selectedLocation.name;
            elements.heroSelectedMeta.textContent = state.selectedLocation.country || "Selected on globe";
        } else {
            elements.heroSelectedPlace.textContent = "No place selected";
            elements.heroSelectedMeta.textContent = "Search a place or click the globe.";
        }
    }

    if (elements.heroFocusedSatellite) {
        const focused = state.satellites[state.currentIndex];
        if (focused) {
            elements.heroFocusedSatellite.textContent = focused.name;
            elements.heroFocusedMeta.textContent = `NORAD ${focused.satnum || "Unknown"} · inc ${focused.inclinationDeg}°`;
        } else {
            elements.heroFocusedSatellite.textContent = "Waiting for satellites";
            elements.heroFocusedMeta.textContent = "The highlighted object on the globe appears here.";
        }
    }
}

async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    let payload = null;
    try {
        payload = await response.json();
    } catch (error) {
        payload = null;
    }
    if (!response.ok) {
        throw new Error(payload?.error || `Request failed: ${response.status}`);
    }
    return payload || {};
}

function setLoadingIndicator(node, active) {
    if (!node) {
        return;
    }
    node.classList.toggle("hidden", !active);
}

function setSearchLoading(active) {
    setLoadingIndicator(elements.searchLoadingDot, active);
    if (elements.searchButton) {
        elements.searchButton.disabled = active;
    }
    if (elements.searchButtonLabel) {
        elements.searchButtonLabel.textContent = active ? "Searching" : "Search";
    }
}

function setNoradSearchLoading(active) {
    setLoadingIndicator(elements.noradSearchLoadingDot, active);
    if (elements.noradSearchButton) {
        elements.noradSearchButton.disabled = active;
    }
    if (elements.noradSearchButtonLabel) {
        elements.noradSearchButtonLabel.textContent = active ? "Finding" : "NORAD";
    }
}

function setGlobeLoading(
    active,
    text = "Loading satellites onto the globe…",
    meta = "Waiting for the live catalog…"
) {
    if (elements.globeLoadingText) {
        elements.globeLoadingText.textContent = text;
    }
    if (elements.globeLoadingMeta) {
        elements.globeLoadingMeta.textContent = meta;
    }
    setLoadingIndicator(elements.globeLoading, active);
}

function clearSatelliteWarmRetry() {
    if (state.satelliteWarmRetryTimer) {
        window.clearTimeout(state.satelliteWarmRetryTimer);
        state.satelliteWarmRetryTimer = null;
    }
}

function scheduleSatelliteWarmRetry() {
    if (state.satelliteWarmRetryTimer || document.hidden) {
        return;
    }
    state.satelliteWarmRetryTimer = window.setTimeout(async () => {
        state.satelliteWarmRetryTimer = null;
        try {
            await refreshSatelliteData();
        } catch (error) {
            console.error(error);
        }
    }, SATELLITE_WARM_RETRY_MS);
}

function isIndexedDbAvailable() {
    return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

function getPersistentCacheDb() {
    if (!isIndexedDbAvailable()) {
        return Promise.reject(new Error("IndexedDB unavailable"));
    }
    if (persistentCacheDbPromise) {
        return persistentCacheDbPromise;
    }
    persistentCacheDbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(PERSISTENT_CACHE_DB_NAME, PERSISTENT_CACHE_DB_VERSION);
        request.onerror = () => reject(request.error || new Error("Failed to open persistent cache"));
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(PERSISTENT_CACHE_STORE)) {
                db.createObjectStore(PERSISTENT_CACHE_STORE, { keyPath: "key" });
            }
        };
        request.onsuccess = () => {
            const db = request.result;
            db.onclose = () => {
                persistentCacheDbPromise = null;
            };
            resolve(db);
        };
    });
    return persistentCacheDbPromise;
}

async function getPersistentCache(key) {
    if (isIndexedDbAvailable()) {
        try {
            const db = await getPersistentCacheDb();
            return await new Promise((resolve, reject) => {
                const tx = db.transaction(PERSISTENT_CACHE_STORE, "readonly");
                const request = tx.objectStore(PERSISTENT_CACHE_STORE).get(key);
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.warn("Persistent cache read failed; falling back to localStorage", error);
            persistentCacheDbPromise = null;
        }
    }
    try {
        const raw = localStorage.getItem(`${PERSISTENT_CACHE_PREFIX}${key}`);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

async function setPersistentCache(key, data) {
    const payload = { key, updatedAt: Date.now(), data };
    if (isIndexedDbAvailable()) {
        try {
            const db = await getPersistentCacheDb();
            await new Promise((resolve, reject) => {
                const tx = db.transaction(PERSISTENT_CACHE_STORE, "readwrite");
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
                tx.objectStore(PERSISTENT_CACHE_STORE).put(payload);
            });
            return;
        } catch (error) {
            console.warn("Persistent cache write failed; falling back to localStorage", error);
            persistentCacheDbPromise = null;
        }
    }
    try {
        localStorage.setItem(`${PERSISTENT_CACHE_PREFIX}${key}`, JSON.stringify(payload));
    } catch {
        // Ignore storage failures.
    }
}

function cacheAgeMs(updatedAt) {
    return Math.max(0, Date.now() - Number(updatedAt || 0));
}

function describeFreshness(updatedAt) {
    const ageMs = cacheAgeMs(updatedAt);
    const mins = Math.floor(ageMs / 60000);
    if (mins < 1) {
        return "just now";
    }
    if (mins < 60) {
        return `${mins}m ago`;
    }
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) {
        return `${hrs}h ago`;
    }
    return `${Math.floor(hrs / 24)}d ago`;
}

function isAbortError(error) {
    return error && typeof error === "object" && error.name === "AbortError";
}

function startSmartPollLoop(poll, options) {
    const opts = {
        intervalMs: 30000,
        hiddenIntervalMs: null,
        pauseWhenHidden: false,
        refreshOnVisible: true,
        runImmediately: false,
        maxBackoffMultiplier: 4,
        onError: null,
        ...options,
    };
    let timeoutId = null;
    let stopped = false;
    let inFlight = false;
    let backoffMultiplier = 1;
    let controller = null;

    const clearScheduled = () => {
        if (timeoutId) {
            window.clearTimeout(timeoutId);
            timeoutId = null;
        }
    };

    const scheduleNext = () => {
        if (stopped || timeoutId) {
            return;
        }
        const hidden = document.visibilityState === "hidden";
        if (hidden && opts.pauseWhenHidden) {
            return;
        }
        const baseInterval = hidden
            ? (opts.hiddenIntervalMs || opts.intervalMs)
            : opts.intervalMs;
        const delay = Math.max(1000, Math.round(baseInterval * backoffMultiplier));
        timeoutId = window.setTimeout(() => {
            timeoutId = null;
            run("interval");
        }, delay);
    };

    const run = async (reason = "manual") => {
        if (stopped || inFlight) {
            return;
        }
        const hidden = document.visibilityState === "hidden";
        if (hidden && opts.pauseWhenHidden) {
            scheduleNext();
            return;
        }
        inFlight = true;
        controller = new AbortController();
        try {
            await poll({ signal: controller.signal, reason, isHidden: hidden });
            backoffMultiplier = 1;
        } catch (error) {
            if (!isAbortError(error)) {
                backoffMultiplier = Math.min(opts.maxBackoffMultiplier, backoffMultiplier * 2);
                if (typeof opts.onError === "function") {
                    opts.onError(error);
                }
            }
        } finally {
            inFlight = false;
            controller = null;
            scheduleNext();
        }
    };

    const visibilityHandler = () => {
        if (document.visibilityState === "visible") {
            clearScheduled();
            if (opts.refreshOnVisible) {
                run("resume");
                return;
            }
        }
        scheduleNext();
    };

    document.addEventListener("visibilitychange", visibilityHandler);
    if (opts.runImmediately) {
        run("startup");
    } else {
        scheduleNext();
    }

    return {
        stop() {
            stopped = true;
            clearScheduled();
            if (controller) {
                controller.abort();
            }
            document.removeEventListener("visibilitychange", visibilityHandler);
        },
        trigger() {
            clearScheduled();
            run("manual");
        },
        isActive() {
            return !stopped;
        },
    };
}

function renderLocationIntel(payload) {
    if (!payload) {
        setLoadingIndicator(elements.intelLoadingDot, false);
        elements.intelStatus.textContent = "Select a place";
        elements.intelTitle.textContent = "No place selected";
        elements.intelSubtitle.textContent = "Search or click a place on the globe to load context.";
        elements.intelSummary.textContent = "Population, country profile, and nearby landmarks will appear here.";
        elements.intelImage.classList.add("hidden");
        elements.intelLink.classList.add("hidden");
        elements.intelFacts.innerHTML = "";
        elements.intelLandmarks.innerHTML = "";
        return;
    }

    const freshnessLabel = payload.__cacheUpdatedAt
        ? ` · cached ${describeFreshness(payload.__cacheUpdatedAt)}`
        : "";
    setLoadingIndicator(elements.intelLoadingDot, false);
    elements.intelStatus.textContent = `${payload.country || "Place intel"}${freshnessLabel}`;
    elements.intelTitle.textContent = payload.name || "Selected place";
    elements.intelSubtitle.textContent = payload.description || payload.country || "Location intel";
    elements.intelSummary.textContent = payload.summary || "No encyclopedia summary found for this place yet.";

    if (payload.image) {
        elements.intelImage.src = payload.image;
        elements.intelImage.classList.remove("hidden");
    } else {
        elements.intelImage.classList.add("hidden");
    }

    if (payload.content_url) {
        elements.intelLink.href = payload.content_url;
        elements.intelLink.textContent = "Read source summary";
        elements.intelLink.classList.remove("hidden");
    } else {
        elements.intelLink.classList.add("hidden");
    }

    const placeIntel = payload.place_intel || {};
    const countryIntel = payload.country_intel || {};
    const placePopulationDetail = placeIntel.population_label
        ? `${placeIntel.population_label}${placeIntel.distance_km !== undefined ? ` · ${placeIntel.distance_km} km match` : ""}`
        : "";
    const countryPopulationDetail = countryIntel.population_label
        ? `${countryIntel.population_label}${countryIntel.population_year ? ` (${countryIntel.population_year})` : ""}`
        : "";
    renderInfoFacts(elements.intelFacts, [
        { label: "Place Population", value: placePopulationDetail },
        { label: "Country Population", value: countryPopulationDetail },
        { label: "Country", value: payload.country || "" },
        { label: "Capital", value: countryIntel.capital || "" },
        { label: "Region", value: [countryIntel.region, countryIntel.subregion].filter(Boolean).join(" · ") },
        { label: "Government", value: countryIntel.government_type || "" },
        { label: "Official Name", value: countryIntel.official_name || "" },
        { label: "Languages", value: (countryIntel.languages || []).slice(0, 4).join(", ") },
        { label: "Currencies", value: (countryIntel.currencies || []).slice(0, 3).join(", ") },
        { label: "Timezones", value: (countryIntel.timezones || []).slice(0, 3).join(", ") },
        { label: "Political Status", value: [
            countryIntel.independent ? "Independent state" : "",
            countryIntel.un_member ? "UN member" : "",
        ].filter(Boolean).join(" · ") },
        { label: "Sources", value: (payload.sources || []).join(" · ") },
    ]);

    elements.intelLandmarks.innerHTML = "";
    const landmarks = (payload.landmarks || []).slice(0, 6);
    if (!landmarks.length) {
        const node = document.createElement("div");
        node.className = "landmark-chip";
        node.textContent = "No nearby landmark matches from source";
        elements.intelLandmarks.appendChild(node);
    } else {
        for (const item of landmarks) {
            const node = document.createElement("div");
            node.className = "landmark-chip";
            node.textContent = item.distance_m
                ? `${item.title} · ${Math.round(item.distance_m)} m`
                : item.title;
            elements.intelLandmarks.appendChild(node);
        }
    }
}

async function loadLocationIntel(location) {
    if (!location) {
        renderLocationIntel(null);
        return;
    }
    const cacheKey = `${location.name}|${location.country}|${location.lat.toFixed(3)}|${location.lon.toFixed(3)}`;
    const memoryCached = state.locationIntelCache.get(cacheKey);
    if (memoryCached) {
        renderLocationIntel(memoryCached);
        if (!memoryCached.__cacheUpdatedAt || cacheAgeMs(memoryCached.__cacheUpdatedAt) < LOCATION_INTEL_CACHE_TTL_MS) {
            return;
        }
    } else {
        const persisted = await getPersistentCache(`location-intel:${cacheKey}`);
        if (persisted?.data) {
            const hydrated = { ...persisted.data, __cacheUpdatedAt: persisted.updatedAt };
            state.locationIntelCache.set(cacheKey, hydrated);
            renderLocationIntel(hydrated);
            if (cacheAgeMs(persisted.updatedAt) < LOCATION_INTEL_CACHE_TTL_MS) {
                return;
            }
        }
    }
    setLoadingIndicator(elements.intelLoadingDot, true);
    elements.intelStatus.textContent = "Loading intel";
    elements.intelTitle.textContent = location.name;
    elements.intelSubtitle.textContent = location.country || "Location intel";
    elements.intelSummary.textContent = "Fetching summary, country facts, and nearby landmarks…";
    try {
        const payload = await fetchJson(
            `/api/location-intel?name=${encodeURIComponent(location.name)}&country=${encodeURIComponent(location.country || "")}&lat=${encodeURIComponent(location.lat)}&lon=${encodeURIComponent(location.lon)}`
        );
        const cachedPayload = { ...payload, __cacheUpdatedAt: Date.now() };
        state.locationIntelCache.set(cacheKey, cachedPayload);
        void setPersistentCache(`location-intel:${cacheKey}`, payload);
        renderLocationIntel(cachedPayload);
    } catch (error) {
        setLoadingIndicator(elements.intelLoadingDot, false);
        elements.intelStatus.textContent = "Intel unavailable";
        elements.intelTitle.textContent = location.name;
        elements.intelSubtitle.textContent = location.country || "Location intel";
        elements.intelSummary.textContent = "Place intel could not be loaded right now.";
        elements.intelImage.classList.add("hidden");
        elements.intelLink.classList.add("hidden");
        elements.intelFacts.innerHTML = "";
        elements.intelLandmarks.innerHTML = "";
    }
}

function setSelectedLocation(location) {
    if (!location) {
        state.selectedLocation = null;
        state.perspectiveMode = "location";
        state.perspectiveTarget = null;
        elements.selectedLocationName.textContent = "None selected";
        elements.selectedLocationMeta.textContent = "Use the search box above";
        updateHeroQuickStatus();
        loadLocationIntel(null).catch(console.error);
        return;
    }

    const lat = Number(location.lat);
    const lon = Number(location.lon ?? location.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        console.error("Invalid location coordinates", location);
        return;
    }

    const normalized = {
        name: location.name,
        display_name: location.display_name || location.name,
        country: location.country || location.name,
        country_code: location.country_code || "",
        region: location.region || "",
        lat,
        lon,
    };
    resetOverlayView();
    state.selectedLocation = normalized;
    state.perspectiveMode = "location";
    state.perspectiveTarget = {
        ...normalized,
        source: "location",
    };
    elements.locationSearch.value = normalized.display_name;
    elements.selectedLocationName.textContent = normalized.name;
    elements.selectedLocationMeta.textContent = `${normalized.country || "Unknown region"} · ${formatLatLng(normalized.lat, normalized.lon)}`;
    updateHeroQuickStatus();
    loadLocationIntel(normalized).catch(console.error);
}

function getPerspectiveTarget(when) {
    if (state.perspectiveTarget) {
        return state.perspectiveTarget;
    }
    if (state.selectedLocation) {
        return { ...state.selectedLocation, source: "location" };
    }
    return null;
}

function targetTitle(target) {
    return target?.name || "Ground track";
}

function targetSubtitle(target) {
    if (!target) {
        return "";
    }
    if (target.source === "location" && target.display_name) {
        const parts = target.display_name.split(",").map((item) => item.trim()).filter(Boolean);
        if (parts.length > 1) {
            return parts.slice(1).join(", ");
        }
    }
    const parts = [];
    if (target.region && target.region !== target.name) {
        parts.push(target.region);
    }
    if (target.country && target.country !== target.name && target.country !== target.region) {
        parts.push(target.country);
    }
    return parts.join(", ");
}

function truncateLabel(text, maxLength = 36) {
    if (!text) {
        return "";
    }
    return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function clampNumber(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function normalizeLongitude(lng) {
    return ((lng + 180) % 360 + 360) % 360 - 180;
}

function destinationPoint(lat, lon, bearingDeg, distanceKm) {
    const angularDistance = Math.max(0, distanceKm) / EARTH_RADIUS_KM;
    const bearing = bearingDeg * DEG_TO_RAD;
    const startLat = lat * DEG_TO_RAD;
    const startLon = lon * DEG_TO_RAD;
    const sinLat = Math.sin(startLat);
    const cosLat = Math.cos(startLat);
    const sinDistance = Math.sin(angularDistance);
    const cosDistance = Math.cos(angularDistance);
    const nextLat = Math.asin(
        sinLat * cosDistance + cosLat * sinDistance * Math.cos(bearing),
    );
    const nextLon = startLon + Math.atan2(
        Math.sin(bearing) * sinDistance * cosLat,
        cosDistance - sinLat * Math.sin(nextLat),
    );
    return {
        lat: clampNumber(nextLat / DEG_TO_RAD, -85, 85),
        lon: normalizeLongitude(nextLon / DEG_TO_RAD),
    };
}

function getFocusedSatellite() {
    return state.satellites[state.currentIndex] || null;
}

function getPerspectiveLabeledItems(visibleNow = []) {
    return visibleNow
        .slice()
        .sort((a, b) => {
            if (a.focused !== b.focused) {
                return a.focused ? -1 : 1;
            }
            return (b.look?.elevationDeg || 0) - (a.look?.elevationDeg || 0);
        })
        .slice(0, state.perspectiveLabelLimit === "all" ? visibleNow.length : state.perspectiveLabelLimit);
}

function setTheme(theme) {
    state.theme = theme === "day" ? "day" : "night";
    document.body.dataset.theme = state.theme;
    elements.themeNightButton?.classList.toggle("active", state.theme === "night");
    elements.themeDayButton?.classList.toggle("active", state.theme === "day");
    applyGlobeTheme();
    refreshGlobeRender();
    if (elements.skyPlotOverlay && state.satellites.length) {
        renderPerspectivePanel(timeFromSlider(state.sliderMinutes));
    }
    try {
        localStorage.setItem(`${PERSISTENT_CACHE_PREFIX}theme`, state.theme);
    } catch (error) {
        console.warn("Theme persistence unavailable", error);
    }
}

function renderPerspectiveChrome(target, visibleNow = [], labeledCount = 0) {
    const countLabel = visibleNow.length
        ? `${visibleNow.length} above the horizon now`
        : "No tracked satellites above the horizon now";
    const labeledLabel = visibleNow.length ? ` · ${labeledCount} listed` : "";
    elements.orbitalOverlay.classList.remove("mode-location", "mode-focus");
    elements.overlayModeBadge.classList.remove("mode-location", "mode-focus");

    if (!target) {
        elements.overlayModeBadge.textContent = "Awaiting Target";
        elements.overlayMeta.textContent = "Select a place to see satellites above Earth";
        elements.overlayModeSummary.textContent = "Perspective locks to a selected place or a focused satellite ground track.";
        return;
    }

    if (target.source === "focus") {
        const focusedSatellite = getFocusedSatellite();
        elements.orbitalOverlay.classList.add("mode-focus");
        elements.overlayModeBadge.classList.add("mode-focus");
        elements.overlayModeBadge.textContent = "Ground Track";
        elements.overlayMeta.textContent = `${countLabel}${labeledLabel} over ${targetTitle(target)}`;
        elements.overlayModeSummary.textContent = focusedSatellite
            ? `Perspective is following the ground track beneath ${focusedSatellite.name}.`
            : "Perspective is following the ground track beneath the focused satellite.";
        return;
    }

    elements.orbitalOverlay.classList.add("mode-location");
    elements.overlayModeBadge.classList.add("mode-location");
    elements.overlayModeBadge.textContent = "Selected Place";
    elements.overlayMeta.textContent = `${countLabel}${labeledLabel}`;
    elements.overlayModeSummary.textContent = `Perspective is pinned to ${targetTitle(target)} so the canvas answers what is above this place right now.`;
}

function zoomToLocation(location, duration = 900) {
    if (!location || !state.globe) {
        return;
    }
    const lat = Number(location.lat);
    const lng = Number(location.lon ?? location.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        console.error("Invalid zoom target coordinates", location);
        return;
    }
    state.globe.pointOfView(
        {
            lat,
            lng,
            altitude: 1.65,
        },
        duration,
    );
}

function zoomToSatellite(index, duration = 900) {
    if (!state.globe || typeof index !== "number") {
        return;
    }
    const sat = state.satellites[index];
    if (!sat) {
        return;
    }
    const when = timeFromSlider(Number(elements.timeSlider.value));
    const position = getSatellitePosition(sat, when);
    if (!position) {
        return;
    }
    state.globe.pointOfView(
        {
            lat: position.lat,
            lng: position.lng,
            altitude: 1.34,
        },
        duration,
    );
}

async function updatePerspectiveFocusLabel(lat, lon) {
    const key = `${lat.toFixed(2)}|${lon.toFixed(2)}`;
    if (state.perspectiveLabelKey === key) {
        return;
    }
    state.perspectiveLabelKey = key;
    if (state.perspectiveLabelAbort) {
        state.perspectiveLabelAbort.abort();
    }
    const controller = new AbortController();
    state.perspectiveLabelAbort = controller;
    try {
        const payload = await fetchJson(`/api/location-label?lat=${lat}&lon=${lon}`, {
            signal: controller.signal,
        });
        if (controller.signal.aborted || state.perspectiveMode !== "focus" || !state.perspectiveTarget) {
            return;
        }
        state.perspectiveTarget = {
            ...state.perspectiveTarget,
            name: payload.name || payload.country || "Ground track",
            country: payload.country || "Unknown",
            country_code: payload.country_code || "",
            region: payload.region || "",
            display_name: payload.display_name || "",
        };
        renderPerspectivePanel(timeFromSlider(Number(elements.timeSlider.value)));
    } catch (error) {
        if (controller.signal.aborted) {
            return;
        }
    }
}

function haversineKm(lat1, lon1, lat2, lon2) {
    const dLat = (lat2 - lat1) * DEG_TO_RAD;
    const dLon = (lon2 - lon1) * DEG_TO_RAD;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function visibleCentralAngleDeg(altitudeKm) {
    return Math.acos(EARTH_RADIUS_KM / (EARTH_RADIUS_KM + altitudeKm)) / DEG_TO_RAD;
}

function angularDistanceDeg(lat1, lon1, lat2, lon2) {
    const lat1r = lat1 * DEG_TO_RAD;
    const lat2r = lat2 * DEG_TO_RAD;
    const lonDelta = (lon2 - lon1) * DEG_TO_RAD;
    const value = Math.sin(lat1r) * Math.sin(lat2r) + Math.cos(lat1r) * Math.cos(lat2r) * Math.cos(lonDelta);
    return Math.acos(Math.min(1, Math.max(-1, value))) / DEG_TO_RAD;
}

function getObserverLookAngles(position, when, observerLat, observerLon) {
    const gmst = satellite.gstime(when);
    const observerGd = {
        latitude: observerLat * DEG_TO_RAD,
        longitude: observerLon * DEG_TO_RAD,
        height: 0,
    };
    const eci = satellite.propagate(position.satrec, when).position;
    if (!eci) {
        return null;
    }
    const ecf = satellite.eciToEcf(eci, gmst);
    const look = satellite.ecfToLookAngles(observerGd, ecf);
    return {
        azimuthDeg: satellite.radiansToDegrees(look.azimuth),
        elevationDeg: satellite.radiansToDegrees(look.elevation),
        rangeKm: look.rangeSat,
    };
}

function buildSatelliteRecord(item) {
    const satrec = satellite.twoline2satrec(item.line1, item.line2);
    const satnum = Number(String(satrec.satnum || item.catnr || "").trim()) || item.catnr || null;
    return {
        ...item,
        satrec,
        satnum,
        inclinationDeg: Number((satrec.inclo * 180 / Math.PI).toFixed(2)),
        eccentricity: Number(satrec.ecco.toFixed(5)),
        meanMotion: Number(satrec.no.toFixed(6)),
    };
}

function satelliteIdentityKey(item) {
    if (!item) {
        return "";
    }
    if (item.satnum) {
        return `satnum:${item.satnum}`;
    }
    if (item.catnr) {
        return `catnr:${item.catnr}`;
    }
    return `name:${String(item.name || item.object_name || "").toLowerCase()}|${item.line1 || ""}|${item.line2 || ""}`;
}

function satelliteServiceCategory(sat) {
    const purpose = String(sat?.purpose || "").toLowerCase();
    const operatorType = String(sat?.operator_type || "").toLowerCase();
    const objectType = String(sat?.object_type || "").toLowerCase();
    const name = String(sat?.object_name || sat?.name || "").toUpperCase();
    const owner = String(sat?.owner_label || "").toUpperCase();

    const matchesAny = (tokens) => tokens.some((token) => name.includes(token) || owner.includes(token));

    if (purpose.includes("rocket body") || purpose.includes("debris") || objectType === "r/b" || objectType === "deb") {
        return "debris";
    }
    if (purpose.includes("crewed space station") || purpose.includes("human")) {
        return "human-spaceflight";
    }
    if (
        purpose.includes("reconnaissance") ||
        purpose.includes("surveillance") ||
        operatorType.includes("military") ||
        matchesAny(["NROL", "SBIRS", "DSP ", "NOSS", "HELIOS", "YAOGAN", "USA ", "SKYNET", "COSMOS"])
    ) {
        return "military";
    }
    if (
        purpose.includes("communications") ||
        purpose.includes("broadcast") ||
        purpose.includes("tv") ||
        matchesAny([
            "STARLINK",
            "ONEWEB",
            "IRIDIUM",
            "ORBCOMM",
            "INTELSAT",
            "EUTELSAT",
            "ASTRA",
            "GALAXY ",
            "TELSTAR",
            "DIRECTV",
            "ECHOSTAR",
            "SES",
            "O3B",
            "INMARSAT",
            "VIASAT",
            "TDRS",
            "TDRSS",
            "TURKSAT",
            "HISPASAT",
            "JCSAT",
            "ANIK",
            "BADR",
            "NILESAT",
            "YAMAL",
            "EXPRESS-",
            "THAICOM",
            "CHINASAT",
            "APSTAR",
            "ASIASAT",
        ])
    ) {
        return "comms";
    }
    if (
        purpose.includes("navigation") ||
        purpose.includes("position") ||
        matchesAny(["GPS", "NAVSTAR", "GALILEO", "GLONASS", "BEIDOU", "COMPASS", "QZS", "QZSS", "IRNSS", "NAVIC"])
    ) {
        return "navigation";
    }
    if (
        purpose.includes("weather") ||
        matchesAny(["GOES", "METEOSAT", "HIMAWARI", "FENGYUN", " FY-", "ELEKTRO-L", "INSAT", "GOMS", "NOAA", "METEOR"])
    ) {
        return "weather";
    }
    if (
        purpose.includes("earth observation") ||
        matchesAny([
            "SENTINEL",
            "WORLDVIEW",
            "GEOEYE",
            "QUICKBIRD",
            "RADARSAT",
            "PLEIADES",
            "SPOT ",
            "CARTOSAT",
            "KANOPUS",
            "SKYSAT",
            "BLACKSKY",
            "ICEYE",
            "KOMPSAT",
            "TERRA",
            "AQUA",
            "LANDSAT",
            "SEASAT",
            "ORBVIEW",
            "ENVISAT",
            "ERS-",
            "SAOCOM",
            "ALOS",
            "DAICHI",
            "RESURS",
            "OKEAN",
            "GAOFEN",
            "COSMO-SKYMED",
        ])
    ) {
        return "earth-observation";
    }
    if (
        purpose.includes("science") ||
        purpose.includes("observatory") ||
        purpose.includes("technology") ||
        matchesAny(["HST", "HUBBLE", "OAO", "ASTRO-H", "HXMT", "KORONAS", "INTERCOSMOS", "ACS3"])
    ) {
        return "science";
    }
    return "other";
}

function isNoradSearchQuery(query) {
    return /^\d{2,6}$/.test((query || "").trim());
}

function rebuildSatelliteSelect() {
    elements.satelliteSelect.innerHTML = "";
    state.satellites.forEach((sat, index) => {
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent = sat.name;
        elements.satelliteSelect.appendChild(option);
    });
    const totalAvailable = state.serviceFilter === "all"
        ? state.allSatellites.length
        : state.allSatellites.filter((sat) => satelliteServiceCategory(sat) === state.serviceFilter).length;
    elements.satelliteCount.textContent = `${state.satellites.length} of ${totalAvailable} loaded`;
    elements.satelliteSelect.value = String(state.currentIndex);
}

function getMatchingSatellites() {
    return state.serviceFilter === "all"
        ? [...state.allSatellites]
        : state.allSatellites.filter((sat) => satelliteServiceCategory(sat) === state.serviceFilter);
}

function applySatelliteFilter(options = {}) {
    const preserveSatnum = options.preserveSatnum || state.satellites[state.currentIndex]?.satnum || null;
    const matching = getMatchingSatellites();
    const limit = state.satelliteLimit === "all" ? matching.length : Math.max(1, Number(state.satelliteLimit) || 100);
    const filtered = matching.slice(0, limit);
    state.satellites = filtered;
    if (!matching.length) {
        state.currentIndex = 0;
        elements.satelliteSelect.innerHTML = "";
        elements.satelliteCount.textContent = "0 loaded";
        elements.satelliteNameLabel.textContent = "--";
        elements.satelliteMetaLabel.textContent = "No satellites match this service filter";
        updateHeroQuickStatus();
        return false;
    }
    const nextIndex = preserveSatnum
        ? Math.max(0, filtered.findIndex((sat) => sat.satnum === preserveSatnum))
        : 0;
    state.currentIndex = nextIndex >= 0 ? nextIndex : 0;
    rebuildSatelliteSelect();
    updateHeroQuickStatus();
    return true;
}

function focusSatelliteBySatnum(satnum, options = {}) {
    if (!satnum) {
        return;
    }
    let index = state.satellites.findIndex((sat) => sat.satnum === satnum);
    if (index < 0) {
        const matching = getMatchingSatellites();
        if (!matching.some((sat) => sat.satnum === satnum)) {
            return;
        }
        state.satelliteLimit = "all";
        if (elements.satelliteLimit) {
            elements.satelliteLimit.value = "all";
        }
        applySatelliteFilter({ preserveSatnum: satnum });
        index = state.satellites.findIndex((sat) => sat.satnum === satnum);
    }
    if (index >= 0) {
        focusSatellite(index, options);
    }
}

function focusSatelliteByIdentity(identityKey, options = {}) {
    if (!identityKey) {
        return;
    }
    let index = state.satellites.findIndex((sat) => satelliteIdentityKey(sat) === identityKey);
    if (index < 0) {
        const matching = getMatchingSatellites();
        if (!matching.some((sat) => satelliteIdentityKey(sat) === identityKey)) {
            return;
        }
        state.satelliteLimit = "all";
        if (elements.satelliteLimit) {
            elements.satelliteLimit.value = "all";
        }
        applySatelliteFilter({
            preserveSatnum: state.satellites[state.currentIndex]?.satnum || null,
        });
        index = state.satellites.findIndex((sat) => satelliteIdentityKey(sat) === identityKey);
    }
    if (index >= 0) {
        focusSatellite(index, options);
    }
}

function upsertSatelliteRecord(item) {
    const record = buildSatelliteRecord(item);
    const existingIndex = state.allSatellites.findIndex((sat) => sat.satnum === record.satnum);
    if (existingIndex >= 0) {
        state.allSatellites[existingIndex] = record;
        applySatelliteFilter({ preserveSatnum: record.satnum });
        return state.satellites.findIndex((sat) => sat.satnum === record.satnum);
    }
    state.allSatellites.unshift(record);
    applySatelliteFilter({ preserveSatnum: record.satnum });
    return state.satellites.findIndex((sat) => sat.satnum === record.satnum);
}

async function focusSatelliteByCatnr(catnr) {
    let existingIndex = state.satellites.findIndex((sat) => sat.satnum === catnr);
    if (existingIndex >= 0) {
        focusSatellite(existingIndex, satelliteInspectOptions({ zoomWhenGlobal: true }));
        return true;
    }
    const existingAny = state.allSatellites.find((sat) => sat.satnum === catnr);
    if (existingAny) {
        state.serviceFilter = "all";
        if (elements.serviceFilter) {
            elements.serviceFilter.value = "all";
        }
        applySatelliteFilter({ preserveSatnum: catnr });
        existingIndex = state.satellites.findIndex((sat) => sat.satnum === catnr);
        if (existingIndex >= 0) {
            focusSatellite(existingIndex, satelliteInspectOptions({ zoomWhenGlobal: true }));
            return true;
        }
    }
    const payload = await fetchJson(`/api/satellite-lookup/${catnr}`);
    upsertSatelliteRecord(payload);
    elements.satelliteSourceLabel.textContent = "Direct NORAD lookup";
    state.serviceFilter = "all";
    if (elements.serviceFilter) {
        elements.serviceFilter.value = "all";
    }
    applySatelliteFilter({ preserveSatnum: payload.catnr || catnr });
    const index = state.satellites.findIndex((sat) => sat.satnum === (payload.catnr || catnr));
    focusSatellite(index, satelliteInspectOptions({ zoomWhenGlobal: true }));
    return true;
}

async function runNoradLookup(options = {}) {
    const commit = Boolean(options.commit);
    const query = (elements.noradSearch?.value || "").trim();
    if (!isNoradSearchQuery(query)) {
        setNoradSearchLoading(false);
        if (commit) {
            renderSearchResults([], { emptyMessage: "Enter a numeric NORAD CAT ID, for example 25544." });
        }
        return;
    }
    try {
        setNoradSearchLoading(true);
        const payload = await fetchJson(`/api/satellite-lookup/${encodeURIComponent(query)}`);
        const item = {
            name: payload.name || `NORAD ${query}`,
            display_name: `NORAD ${query} · ${payload.name || "Tracked object"}`,
            catnr: payload.catnr,
            kind: "norad-satellite",
        };
        if (commit) {
            await focusSatelliteByCatnr(Number(query));
            elements.locationSearch.value = payload.name || String(query);
            elements.searchResults.classList.add("hidden");
        } else {
            renderSearchResults([item]);
        }
    } catch (error) {
        console.error(error);
        renderSearchResults([], {
            emptyMessage: `No live TLE found for NORAD ${query}. The ID may be invalid, untracked here, or unavailable from the current source.`,
        });
    } finally {
        setNoradSearchLoading(false);
    }
}

function normalizeSatelliteDetails(details = {}, fallbackName = "") {
    return {
        ...details,
        purpose: details.purpose || "Cataloged space object",
        object_name: details.object_name || fallbackName,
        field_sources: details.field_sources && typeof details.field_sources === "object" ? details.field_sources : {},
        source_confidence: details.source_confidence && typeof details.source_confidence === "object"
            ? details.source_confidence
            : { overall: "", fields: {} },
        raw: details.raw && typeof details.raw === "object" ? details.raw : {},
    };
}

function isHeuristicSatelliteDetails(details) {
    return !details || details.classification_source === "Name heuristic (satcat unavailable)" || !details.classification_source;
}

function buildSeedSatelliteDetails(satItem) {
    return normalizeSatelliteDetails({
        purpose: satItem.purpose,
        object_name: satItem.object_name || satItem.name,
        object_type: satItem.object_type,
        owner_label: satItem.owner_label,
        operator_type: satItem.operator_type,
        classification_source: satItem.classification_source,
    }, satItem.name);
}

function classifyPlaceRelationship(sat, entry) {
    const purpose = String(sat.purpose || "").toLowerCase();
    const objectType = String(sat.object_type || "").toLowerCase();
    const elevationLabel = entry.visible ? `${Math.round(entry.look?.elevationDeg || 0)}° elevation` : `${Math.round(entry.distanceKm)} km from subpoint`;
    const subpointLabel = entry.distanceKm <= 120
        ? "Subpoint is near the selected place."
        : `Subpoint is ${Math.round(entry.distanceKm)} km away.`;

    if (purpose.includes("communications")) {
        return {
            headline: entry.visible ? `Above horizon · ${elevationLabel}` : elevationLabel,
            detail: `Likely communications coverage candidate. ${subpointLabel} Live beam coverage and service availability are unknown.`,
        };
    }

    if (purpose.includes("earth observation") || purpose.includes("reconnaissance") || purpose.includes("weather observation")) {
        return {
            headline: entry.visible ? `Above horizon · ${elevationLabel}` : elevationLabel,
            detail: `Can pass over this region, but live imaging target and off-nadir pointing are unknown. ${subpointLabel}`,
        };
    }

    if (purpose.includes("crewed space station")) {
        return {
            headline: entry.visible ? `Above horizon · ${elevationLabel}` : elevationLabel,
            detail: `Visible from the place in the sky, but not a service satellite for the location. ${subpointLabel}`,
        };
    }

    if (objectType === "r/b" || objectType === "deb" || purpose.includes("rocket body") || purpose.includes("debris")) {
        return {
            headline: entry.visible ? `Above horizon · ${elevationLabel}` : elevationLabel,
            detail: `Geometry only. This object is overhead, but it is not servicing or imaging the place. ${subpointLabel}`,
        };
    }

    return {
        headline: entry.visible ? `Above horizon · ${elevationLabel}` : elevationLabel,
        detail: `Above-horizon geometry only. The app does not know whether this satellite is actively targeting or servicing the place. ${subpointLabel}`,
    };
}

function satelliteInspectOptions(options = {}) {
    const keepPlaceContext = Boolean(state.selectedLocation);
    return {
        zoom: keepPlaceContext ? false : Boolean(options.zoomWhenGlobal),
        perspective: keepPlaceContext ? "location" : "focus",
    };
}

function getSatellitePosition(satItem, when) {
    if (!satItem?.satrec) {
        return null;
    }

    let pv = null;
    try {
        pv = satellite.propagate(satItem.satrec, when);
    } catch (error) {
        return null;
    }

    if (!pv || !pv.position || !pv.velocity) {
        return null;
    }

    const gmst = satellite.gstime(when);
    const geodetic = satellite.eciToGeodetic(pv.position, gmst);
    const altitudeKm = geodetic.height;
    const lat = satellite.radiansToDegrees(geodetic.latitude);
    const lng = satellite.radiansToDegrees(geodetic.longitude);
    const speedKmS = Math.sqrt(
        pv.velocity.x ** 2 + pv.velocity.y ** 2 + pv.velocity.z ** 2
    );

    return {
        lat,
        lng,
        altitudeKm,
        altitude: Math.max(0.01, altitudeKm / EARTH_RADIUS_KM),
        speedKmS,
    };
}

function buildOrbitPath(satItem, centerTime) {
    const segments = [];
    let activePoints = [];
    let previousPoint = null;

    const flushSegment = () => {
        if (activePoints.length >= 2) {
            segments.push({
                points: activePoints,
                color: "#fbbf24",
                stroke: 0.45,
            });
        }
        activePoints = [];
    };

    for (let minute = -720; minute <= 720; minute += 20) {
        const sampleTime = new Date(centerTime.getTime() + minute * 60 * 1000);
        const position = getSatellitePosition(satItem, sampleTime);
        if (!position) {
            flushSegment();
            previousPoint = null;
            continue;
        }

        const nextPoint = {
            lat: position.lat,
            lng: position.lng,
            altitude: Math.max(0.008, position.altitude * 0.4),
        };

        if (previousPoint && Math.abs(nextPoint.lng - previousPoint.lng) > 180) {
            flushSegment();
        }

        activePoints.push(nextPoint);
        previousPoint = nextPoint;
    }
    flushSegment();
    return segments;
}

function renderSatelliteList(when) {
    const hasOrbitSummaryElements = elements.orbitCount
        && elements.orbitSummary
        && elements.orbitFocusTitle
        && elements.orbitFocusMeta
        && elements.orbitFocusWindow
        && elements.orbitFocusWindowMeta
        && elements.orbitFocusRelationship
        && elements.orbitFocusRelationshipMeta
        && elements.orbitFocusAltitude
        && elements.orbitFocusVelocity;
    if (!hasOrbitSummaryElements) {
        return;
    }
    const focused = state.satellites[state.currentIndex];
    if (!focused) {
        elements.orbitCount.textContent = "No satellite selected";
        elements.orbitSummary.textContent = "Select a satellite to inspect its current orbit context. The place-based overhead list drives the orbital perspective.";
        elements.orbitFocusTitle.textContent = "Awaiting selection";
        elements.orbitFocusMeta.textContent = "Choose or click a satellite to inspect its orbit.";
        elements.orbitFocusWindow.textContent = "24 hour scrub";
        elements.orbitFocusWindowMeta.textContent = "The globe and trace are synced to the selected time window.";
        elements.orbitFocusRelationship.textContent = state.selectedLocation ? "Below the place horizon" : "No place selected";
        elements.orbitFocusRelationshipMeta.textContent = state.selectedLocation
            ? `Use ${state.selectedLocation.name} to compare this satellite to the overhead list.`
            : "Search a place to compare this satellite to the overhead view.";
        elements.orbitFocusAltitude.textContent = "--";
        elements.orbitFocusVelocity.textContent = "--";
        return;
    }

    const position = getSatellitePosition(focused, when);
    const totalTracked = state.satellites.length;
    elements.orbitCount.textContent = focused.name;
    elements.orbitFocusTitle.textContent = focused.name;
    elements.orbitFocusMeta.textContent = focused.satnum ? `NORAD ${focused.satnum}` : "Live tracked object";
    elements.orbitFocusWindow.textContent = state.showOrbitTrace ? "24 hour trace enabled" : "24 hour trace available";
    elements.orbitFocusWindowMeta.textContent = state.showOrbitTrace
        ? "Orbit trace is visible on the globe for the selected time window."
        : "Enable orbit trace to draw the selected satellite across the scrub window.";
    const location = state.selectedLocation;
    if (location && position) {
        const centralDistanceDeg = angularDistanceDeg(location.lat, location.lon, position.lat, position.lng);
        const visibleLimitDeg = visibleCentralAngleDeg(position.altitudeKm);
        const overheadVisible = centralDistanceDeg <= visibleLimitDeg;
        const groundDistanceKm = haversineKm(location.lat, location.lon, position.lat, position.lng);
        elements.orbitFocusRelationship.textContent = overheadVisible ? "Above the selected place horizon" : "Below the selected place horizon";
        elements.orbitFocusRelationshipMeta.textContent = `${Math.round(groundDistanceKm)} km from ${location.name}. The overhead list and perspective show the same place-based subset.`;
        elements.orbitSummary.textContent = overheadVisible
            ? `${focused.name} is currently part of the place-based overhead set for ${location.name}.`
            : `${focused.name} is selected, but the overhead list remains owned by ${location.name} and only shows satellites above that place.`;
    } else if (location) {
        elements.orbitFocusRelationship.textContent = `Comparing against ${location.name}`;
        elements.orbitFocusRelationshipMeta.textContent = "Current satellite position is unavailable for this moment.";
        elements.orbitSummary.textContent = `${focused.name} is selected. The overhead list still reflects satellites above ${location.name}.`;
    } else {
        elements.orbitFocusRelationship.textContent = "No place selected";
        elements.orbitFocusRelationshipMeta.textContent = "Search a place to compare this satellite to the overhead list and orbital perspective.";
        elements.orbitSummary.textContent = `${focused.name} is selected from the ${totalTracked}-satellite tracked set. Pick a place to align the right-hand context with the orbital perspective.`;
    }

    if (position) {
        elements.orbitFocusAltitude.textContent = `${Math.round(position.altitudeKm)} km altitude`;
        elements.orbitFocusVelocity.textContent = Number.isFinite(position.speedKmS)
            ? `${position.speedKmS.toFixed(2)} km/s orbital speed`
            : "Speed unavailable";
    } else {
        elements.orbitFocusAltitude.textContent = "Position unavailable";
        elements.orbitFocusVelocity.textContent = "Try another time on the scrub window";
    }

    if (focused && !state.showOrbitTrace) {
        elements.timelineStatus.textContent = `Tracking ${focused.name}`;
    }
}

function setOverlayMode(nextState) {
    state.showOverlay = nextState;
    elements.overlayToggle.classList.toggle("active", nextState);
    elements.orbitalOverlay.classList.toggle("hidden", !nextState);
    if (nextState) {
        renderPerspectivePanel(timeFromSlider(state.sliderMinutes));
    }
    syncOverlayAnimation();
}

function resetOverlayView() {
    state.overlayZoom = 1;
    state.overlayAzimuthOffsetDeg = 0;
    state.overlayPitchDeg = 0;
    state.overlayDragging = false;
    state.overlayPointerId = null;
    state.overlayLastPointer = null;
    state.overlayDidDrag = false;
    elements.skyPlotOverlay.classList.remove("dragging");
}

function projectOverlayPoint(x, y, anchorX, anchorY) {
    return {
        x: anchorX + (x - anchorX) * state.overlayZoom,
        y: anchorY + (y - anchorY) * state.overlayZoom,
    };
}

function drawPerspectiveEarthSurface(ctx, target, width, height, horizonY) {
    const isDayTheme = state.theme === "day";
    if (!(earthOverlayImage.complete && earthOverlayImage.naturalWidth)) {
        const earthGradient = ctx.createLinearGradient(0, horizonY - 120, 0, height);
        if (isDayTheme) {
            earthGradient.addColorStop(0, "#d8ebf6");
            earthGradient.addColorStop(0.08, "#f6fbfe");
            earthGradient.addColorStop(0.18, "#bfd7e6");
            earthGradient.addColorStop(0.52, "#9db8cb");
            earthGradient.addColorStop(1, "#dce8ef");
        } else {
            earthGradient.addColorStop(0, "#92d8ff");
            earthGradient.addColorStop(0.05, "#ecf6ff");
            earthGradient.addColorStop(0.1, "#6d8aa6");
            earthGradient.addColorStop(0.4, "#1a2535");
            earthGradient.addColorStop(1, "#0c111b");
        }
        ctx.fillStyle = earthGradient;
        ctx.fillRect(0, horizonY - 120, width, height);
        return;
    }

    const imageWidth = earthOverlayImage.naturalWidth;
    const imageHeight = earthOverlayImage.naturalHeight;
    const targetLon = normalizeLongitude(Number(target?.lon || 0));
    const targetLat = clampNumber(Number(target?.lat || 0), -75, 75);
    const viewDistanceKm = clampNumber(1000 + state.overlayPitchDeg * 22, 260, 2100);
    const viewTarget = destinationPoint(
        targetLat,
        targetLon,
        state.overlayAzimuthOffsetDeg,
        viewDistanceKm,
    );
    const sourceZoom = clampNumber(1 - state.overlayPitchDeg / 180, 0.82, 1.18);
    const destinationY = horizonY - height * 0.18;
    const destinationHeight = height * 0.64;
    const sourceWidth = imageWidth * 0.34 * sourceZoom;
    const sourceHeight = imageHeight * 0.34 * sourceZoom;
    const centerX = ((viewTarget.lon + 180) / 360) * imageWidth;
    const centerY = ((90 - viewTarget.lat) / 180) * imageHeight;
    const sourceY = clampNumber(centerY - sourceHeight * 0.58, 0, imageHeight - sourceHeight);
    let sourceX = centerX - sourceWidth * 0.5;

    if (sourceX < 0) {
        const leftWidth = -sourceX;
        const rightWidth = sourceWidth - leftWidth;
        ctx.drawImage(
            earthOverlayImage,
            imageWidth - leftWidth,
            sourceY,
            leftWidth,
            sourceHeight,
            0,
            destinationY,
            width * (leftWidth / sourceWidth),
            destinationHeight,
        );
        ctx.drawImage(
            earthOverlayImage,
            0,
            sourceY,
            rightWidth,
            sourceHeight,
            width * (leftWidth / sourceWidth),
            destinationY,
            width * (rightWidth / sourceWidth),
            destinationHeight,
        );
    } else if (sourceX + sourceWidth > imageWidth) {
        const rightWidth = imageWidth - sourceX;
        const leftWidth = sourceWidth - rightWidth;
        ctx.drawImage(
            earthOverlayImage,
            sourceX,
            sourceY,
            rightWidth,
            sourceHeight,
            0,
            destinationY,
            width * (rightWidth / sourceWidth),
            destinationHeight,
        );
        ctx.drawImage(
            earthOverlayImage,
            0,
            sourceY,
            leftWidth,
            sourceHeight,
            width * (rightWidth / sourceWidth),
            destinationY,
            width * (leftWidth / sourceWidth),
            destinationHeight,
        );
    } else {
        ctx.drawImage(earthOverlayImage, sourceX, sourceY, sourceWidth, sourceHeight, 0, destinationY, width, destinationHeight);
    }

    const edgeShade = ctx.createLinearGradient(0, destinationY, width, destinationY);
    edgeShade.addColorStop(0, "rgba(3, 8, 20, 0.48)");
    edgeShade.addColorStop(0.2, "rgba(3, 8, 20, 0.12)");
    edgeShade.addColorStop(0.5, "rgba(3, 8, 20, 0)");
    edgeShade.addColorStop(0.8, "rgba(3, 8, 20, 0.12)");
    edgeShade.addColorStop(1, "rgba(3, 8, 20, 0.48)");
    ctx.fillStyle = edgeShade;
    ctx.fillRect(0, destinationY, width, destinationHeight);
}

function drawSatelliteGlyph(ctx, x, y, color, focused) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(focused ? 1.15 : 1, focused ? 1.15 : 1);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.3;

    ctx.fillRect(-4, -4, 8, 8);
    ctx.fillRect(-16, -2, 8, 4);
    ctx.fillRect(8, -2, 8, 4);
    ctx.strokeRect(-16, -2, 8, 4);
    ctx.strokeRect(8, -2, 8, 4);
    ctx.beginPath();
    ctx.moveTo(0, 4);
    ctx.lineTo(0, 11);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 14, 2.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
}

function syncOverlayAnimation() {
    if (state.overlayFrame) {
        window.cancelAnimationFrame(state.overlayFrame);
        state.overlayFrame = null;
    }
}

function computeOverheadEntries(when, target = state.selectedLocation) {
    const location = target;
    if (!location) {
        return { ranked: [], visibleNow: [], labeledItems: [], displayItems: [] };
    }

    const focusedSatnum = state.satellites[state.currentIndex]?.satnum || null;

    const ranked = getMatchingSatellites()
        .map((sat) => {
            const position = getSatellitePosition(sat, when);
            if (!position) {
                return null;
            }
            const distanceKm = haversineKm(location.lat, location.lon, position.lat, position.lng);
            const visible = angularDistanceDeg(location.lat, location.lon, position.lat, position.lng)
                <= visibleCentralAngleDeg(position.altitudeKm);
            const look = getObserverLookAngles(sat, when, location.lat, location.lon);
            return {
                sat,
                satnum: sat.satnum,
                identityKey: satelliteIdentityKey(sat),
                focused: sat.satnum === focusedSatnum,
                position,
                distanceKm,
                visible,
                look,
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.distanceKm - b.distanceKm);

    const visibleNow = ranked.filter((item) => item.visible);
    const labeledItems = getPerspectiveLabeledItems(visibleNow);
    const displayItems = visibleNow.length ? labeledItems : ranked.slice(0, 5);
    return { ranked, visibleNow, labeledItems, displayItems };
}

function drawOrbitalPerspective(canvas, visibleNow, target) {
    const ctx = canvas.getContext("2d");
    const { width, height } = canvas;
    const targetX = width * 0.5;
    const horizonY = clampNumber(
        height * 0.72 + (state.overlayPitchDeg / OVERLAY_MAX_PITCH_DEG) * height * 0.14,
        height * 0.58,
        height * 0.84,
    );
    const isFocusTarget = target?.source === "focus";
    const accent = isFocusTarget ? "#7dd3fc" : "#fbbf24";
    const accentSoft = isFocusTarget ? "rgba(125, 211, 252, 0.22)" : "rgba(251, 191, 36, 0.18)";
    const accentStrong = isFocusTarget ? "rgba(125, 211, 252, 0.82)" : "rgba(251, 191, 36, 0.82)";
    const accentStroke = isFocusTarget ? "rgba(125, 211, 252, 0.72)" : "rgba(251, 191, 36, 0.52)";
    const isDayTheme = state.theme === "day";
    const focusedSatellite = getFocusedSatellite();
    const sceneAnchorX = targetX;
    const sceneAnchorY = horizonY - 40;
    const azimuthOffsetRad = state.overlayAzimuthOffsetDeg * DEG_TO_RAD;
    state.overlayHitTargets = [];

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = isDayTheme ? "#eef4f7" : "#01040a";
    ctx.fillRect(0, 0, width, height);
    const skyGradient = ctx.createLinearGradient(0, 0, 0, height);
    if (isDayTheme) {
        skyGradient.addColorStop(0, isFocusTarget ? "#edf6fb" : "#faf6ef");
        skyGradient.addColorStop(0.55, "#dfeaf1");
        skyGradient.addColorStop(1, "#c9d9e5");
    } else {
        skyGradient.addColorStop(0, isFocusTarget ? "#03101a" : "#120b05");
        skyGradient.addColorStop(0.55, "#04101a");
        skyGradient.addColorStop(1, "#0b1322");
    }
    ctx.fillStyle = skyGradient;
    ctx.fillRect(0, 0, width, height);

    if (!isDayTheme) {
        for (let i = 0; i < 160; i += 1) {
            const x = (Math.sin(i * 91.31) * 0.5 + 0.5) * width;
            const y = (Math.cos(i * 53.17) * 0.5 + 0.5) * height * 0.6;
            ctx.fillStyle = `rgba(255,255,255,${i % 7 === 0 ? 0.65 : 0.14})`;
            ctx.fillRect(x, y, i % 11 === 0 ? 2.4 : 1.4, i % 11 === 0 ? 2.4 : 1.4);
        }
    }

    for (let y = 0; y < height; y += 4) {
        ctx.fillStyle = isDayTheme
            ? (isFocusTarget ? "rgba(66, 120, 185, 0.018)" : "rgba(198, 147, 53, 0.014)")
            : (isFocusTarget ? "rgba(90, 220, 255, 0.024)" : "rgba(251, 191, 36, 0.018)");
        ctx.fillRect(0, y, width, 1);
    }

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, height);
    ctx.lineTo(0, horizonY);
    ctx.quadraticCurveTo(width * 0.5, horizonY - 70, width, horizonY);
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.clip();
    drawPerspectiveEarthSurface(ctx, target, width, height, horizonY);
    ctx.restore();

    ctx.strokeStyle = isFocusTarget ? "rgba(125, 211, 252, 0.78)" : "rgba(251, 191, 36, 0.58)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, horizonY);
    ctx.quadraticCurveTo(width * 0.5, horizonY - 70, width, horizonY);
    ctx.stroke();

    const placeName = truncateLabel(targetTitle(target), 34);
    const placeSubtitle = truncateLabel(targetSubtitle(target), 40);
    const countLabel = `${visibleNow.length} TRACKED OBJECT${visibleNow.length === 1 ? "" : "S"}`;
    const viewAzimuth = Math.round(((state.overlayAzimuthOffsetDeg % 360) + 360) % 360).toString().padStart(3, "0");
    const tiltDegrees = Math.round(state.overlayPitchDeg);
    const tiltLabel = `${tiltDegrees >= 0 ? "+" : ""}${tiltDegrees}`;
    ctx.fillStyle = accentStrong;
    ctx.font = "14px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    ctx.fillText("OVERHEAD INTEL", 28, 38);
    ctx.font = "700 24px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    ctx.fillStyle = isDayTheme ? "#303e5d" : "#eff6ff";
    ctx.fillText(isFocusTarget ? "GROUND TRACK" : (visibleNow.length ? "PLACE LOCK" : "PLACE LOCK"), 28, 70);
    ctx.font = "14px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    ctx.fillStyle = accentStrong;
    ctx.fillText(countLabel, 28, 96);
    ctx.fillText(`${isFocusTarget ? "TARGET" : "PLACE"} ${placeName.toUpperCase()}`, 28, 118);
    const driverLine = isFocusTarget
        ? `SAT ${truncateLabel((focusedSatellite && focusedSatellite.name) || "SELECTED SATELLITE", 26).toUpperCase()}`
        : placeSubtitle;
    if (driverLine) {
        ctx.fillStyle = isDayTheme ? "rgba(105, 143, 163, 0.96)" : "rgba(148, 167, 188, 0.95)";
        ctx.font = "13px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
        ctx.fillText(driverLine.toUpperCase(), 28, 138);
    }

    const infoLines = [
        target ? `${Math.abs(target.lat).toFixed(2)} ${target.lat >= 0 ? "N" : "S"}` : "",
        target ? `${Math.abs(target.lon).toFixed(2)} ${target.lon >= 0 ? "E" : "W"}` : "",
        `UTC ${timeFromSlider(state.sliderMinutes).toISOString().slice(11, 19)}`,
        `VIEW AZ ${viewAzimuth} | TILT ${tiltLabel} DEG`,
    ].filter(Boolean);
    ctx.fillStyle = isDayTheme ? "rgba(48, 62, 93, 0.82)" : "rgba(239, 246, 255, 0.88)";
    infoLines.forEach((line, idx) => ctx.fillText(line, 28, 166 + idx * 22));

    const pinY = horizonY - 12;
    ctx.save();
    ctx.translate(targetX, pinY);
    ctx.fillStyle = accentSoft;
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.fill();
    if (isFocusTarget) {
        ctx.strokeStyle = "rgba(125, 211, 252, 0.42)";
        ctx.lineWidth = 2;
        [28, 40].forEach((radius) => {
            ctx.beginPath();
            ctx.arc(0, -5, radius, 0, Math.PI * 2);
            ctx.stroke();
        });
    }
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(0, 18);
    ctx.bezierCurveTo(10, 10, 12, 1, 12, -5);
    ctx.arc(0, -5, 12, 0, Math.PI, true);
    ctx.bezierCurveTo(-12, 1, -10, 10, 0, 18);
    ctx.fill();
    ctx.fillStyle = isDayTheme ? "#f9fafa" : "#07131f";
    ctx.beginPath();
    ctx.arc(0, -5, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const subtitleText = placeSubtitle || (target ? formatLatLng(target.lat, target.lon) : "Select a place or satellite");
    ctx.font = "700 18px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    const titleWidth = ctx.measureText(placeName).width;
    ctx.font = "13px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    const subtitleWidth = ctx.measureText(subtitleText).width;
    const badgeWidth = Math.max(160, titleWidth + 26, subtitleWidth + 26);
    const badgeHeight = 46;
    const badgeX = targetX + 24;
    const badgeY = horizonY - 48;
    ctx.fillStyle = isDayTheme ? "rgba(255, 255, 255, 0.84)" : "rgba(2, 7, 14, 0.86)";
    ctx.fillRect(badgeX, badgeY, badgeWidth, badgeHeight);
    ctx.strokeStyle = accentStroke;
    ctx.strokeRect(badgeX, badgeY, badgeWidth, badgeHeight);
    ctx.fillStyle = isDayTheme ? "#303e5d" : "#eff6ff";
    ctx.font = "700 18px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    ctx.fillText(placeName, badgeX + 12, badgeY + 18);
    ctx.fillStyle = isDayTheme ? "rgba(105, 143, 163, 0.96)" : "rgba(148, 167, 188, 0.95)";
    ctx.font = "13px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    ctx.fillText(subtitleText, badgeX + 12, badgeY + 36);

    const sceneItems = visibleNow.map((item) => {
        const elev = Math.max(0, Math.min(90, item.look?.elevationDeg || 0));
        const rotatedAz = ((item.look?.azimuthDeg || 0) * DEG_TO_RAD) + azimuthOffsetRad;
        const baseX = targetX + Math.sin(rotatedAz) * width * 0.31;
        const baseY = horizonY - 90 - (elev / 90) * (height * 0.42) - Math.cos(rotatedAz) * 26;
        const projected = projectOverlayPoint(baseX, baseY, sceneAnchorX, sceneAnchorY);
        const isFocused = item.focused;
        return {
            item,
            elev,
            x: projected.x,
            y: projected.y,
            isFocused,
            labelWidth: Math.min(220, Math.max(112, item.sat.name.length * 8.6)),
            side: projected.x >= targetX ? "right" : "left",
            labelY: projected.y,
        };
    });

    sceneItems.forEach((entry) => {
        const { item, x, y, isFocused } = entry;
        const glyphColor = isFocused ? "#fbbf24" : item.look?.elevationDeg >= 45 ? "#dff6ff" : "#7dd3fc";
        drawSatelliteGlyph(ctx, x, y, glyphColor, isFocused);
        state.overlayHitTargets.push({
            identityKey: item.identityKey,
            glyphX: x,
            glyphY: y,
            glyphRadius: isFocused ? 16 : 11,
            labelX: x - 10,
            labelY: y - 10,
            labelWidth: 20,
            labelHeight: 20,
        });
    });

    const labeledSceneItems = sceneItems
        .slice()
        .sort((a, b) => {
            if (a.isFocused !== b.isFocused) {
                return a.isFocused ? -1 : 1;
            }
            return b.elev - a.elev;
        })
        .slice(0, state.perspectiveLabelLimit === "all" ? sceneItems.length : state.perspectiveLabelLimit);

    const layoutColumn = (entries) => {
        const minGap = 34;
        const topBound = 34;
        const bottomBound = horizonY - 36;
        let lastY = topBound - minGap;
        for (const entry of entries.sort((a, b) => a.y - b.y)) {
            entry.labelY = Math.min(bottomBound, Math.max(entry.y, lastY + minGap));
            lastY = entry.labelY;
        }
        for (let idx = entries.length - 1; idx >= 0; idx -= 1) {
            const next = entries[idx + 1];
            if (next && entries[idx].labelY > next.labelY - minGap) {
                entries[idx].labelY = next.labelY - minGap;
            }
            entries[idx].labelY = Math.max(topBound, entries[idx].labelY);
        }
    };

    layoutColumn(labeledSceneItems.filter((entry) => entry.side === "left"));
    layoutColumn(labeledSceneItems.filter((entry) => entry.side === "right"));

    labeledSceneItems.forEach((entry) => {
        const { item, elev, x, y, isFocused, labelWidth, side, labelY } = entry;
        const labelX = side === "right" ? x + 18 : x - labelWidth - 18;
        const labelTop = labelY - 18;
        const labelAnchorX = side === "right" ? labelX : labelX + labelWidth;

        ctx.strokeStyle = isFocused ? "rgba(251, 191, 36, 0.8)" : "rgba(125, 211, 252, 0.42)";
        ctx.lineWidth = isFocused ? 2.4 : 1.1;
        ctx.beginPath();
        ctx.moveTo(x, y + 8);
        ctx.bezierCurveTo(
            x,
            y + 48,
            targetX + (x - targetX) * 0.4,
            horizonY - 42,
            targetX,
            horizonY - 6,
        );
        ctx.stroke();

        ctx.strokeStyle = "rgba(125, 211, 252, 0.24)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(labelAnchorX, labelY - 3);
        ctx.stroke();

        ctx.fillStyle = isDayTheme ? "rgba(255, 255, 255, 0.82)" : "rgba(2, 7, 14, 0.8)";
        ctx.fillRect(labelX, labelTop, labelWidth, 42);
        ctx.strokeStyle = isFocused ? "rgba(251, 191, 36, 0.55)" : "rgba(125, 211, 252, 0.35)";
        ctx.strokeRect(labelX, labelTop, labelWidth, 42);
        ctx.fillStyle = isDayTheme ? "#303e5d" : "#eff6ff";
        ctx.font = "15px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
        ctx.fillText(item.sat.name, labelX + 8, labelTop + 19);
        ctx.fillStyle = isDayTheme ? "rgba(105, 143, 163, 0.96)" : "rgba(148, 167, 188, 0.95)";
        ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
        ctx.fillText(`${Math.round(elev)} DEG`, labelX + 8, labelTop + 34);

        const hitTarget = state.overlayHitTargets.find((targetEntry) => targetEntry.identityKey === item.identityKey);
        if (hitTarget) {
            hitTarget.labelX = labelX;
            hitTarget.labelY = labelTop;
            hitTarget.labelWidth = labelWidth;
            hitTarget.labelHeight = 42;
        }
    });

    if (!sceneItems.length) {
        ctx.fillStyle = isDayTheme ? "rgba(48, 62, 93, 0.78)" : "rgba(239, 246, 255, 0.78)";
        ctx.font = "20px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
        ctx.fillText("No tracked satellites above the horizon", width * 0.28, height * 0.28);
    }
}

function drawSkyPlot(visibleNow, target) {
    state.overlayVisibleNow = visibleNow;
    drawOrbitalPerspective(elements.skyPlotOverlay, visibleNow, target);
}

function renderPerspectivePanel(when) {
    const target = getPerspectiveTarget(when);
    if (!target) {
        renderPerspectiveChrome(null, [], 0);
        drawSkyPlot([], null);
        return;
    }
    const { visibleNow, labeledItems } = computeOverheadEntries(when, target);
    renderPerspectiveChrome(target, visibleNow, labeledItems.length);
    drawSkyPlot(labeledItems, target);
}

function renderOverheadList(when) {
    elements.overheadList.innerHTML = "";
    const { ranked, visibleNow, labeledItems, displayItems } = computeOverheadEntries(when);
    const location = state.selectedLocation;
    const focusedSatnum = state.satellites[state.currentIndex]?.satnum || null;
    if (!location) {
        elements.overheadCount.textContent = "0 above horizon now";
        return;
    }

    if (!displayItems.length) {
        elements.overheadCount.textContent = "0 above horizon now";
        return;
    }

    elements.overheadCount.textContent = visibleNow.length
        ? `${visibleNow.length} above horizon now · ${labeledItems.length} shown in perspective`
        : "0 above horizon now";
    if (visibleNow.length) {
        elements.searchSummary.textContent =
            `${visibleNow.length} tracked satellite${visibleNow.length === 1 ? "" : "s"} are above the horizon for ${location.name} at the selected time. The list below mirrors the ${labeledItems.length} satellites currently labeled in the perspective view.`;
    } else {
        const closest = ranked[0];
        elements.searchSummary.textContent =
            `No tracked satellites are above the horizon for ${location.name} right now. Closest is ${closest.sat.name}, with its subpoint ${Math.round(closest.distanceKm)} km away.`;
    }
    for (const item of displayItems) {
        const relationship = classifyPlaceRelationship(item.sat, item);
        const button = document.createElement("button");
        button.type = "button";
        button.className = `satellite-chip${item.satnum === focusedSatnum ? " active" : ""}`;
        const title = document.createElement("strong");
        title.textContent = item.sat.name;
        const headline = document.createElement("span");
        headline.textContent = relationship.headline;
        const detail = document.createElement("small");
        detail.textContent = relationship.detail;
        button.append(title, headline, detail);
        button.addEventListener("click", () => focusSatelliteBySatnum(item.satnum, satelliteInspectOptions({ zoomWhenGlobal: true })));
        elements.overheadList.appendChild(button);
    }
}

async function updateCountry(lat, lng) {
    const countryPrecision = state.isPlaying ? 0 : 1;
    const cacheKey = `${lat.toFixed(countryPrecision)}|${lng.toFixed(countryPrecision)}`;
    if (state.countryKey === cacheKey && state.countryCache.has(cacheKey)) {
        const cached = state.countryCache.get(cacheKey);
        setLoadingIndicator(elements.countryLoadingDot, false);
        elements.countryName.textContent = cached.country || "Unknown";
        elements.countryCode.textContent = cached.country_code || "--";
        return;
    }
    if (state.isPlaying && Date.now() - state.countryUpdatedAt < COUNTRY_REFRESH_WHILE_PLAYING_MS) {
        return;
    }

    if (state.countryAbort) {
        state.countryAbort.abort();
    }

    const controller = new AbortController();
    state.countryAbort = controller;
    setLoadingIndicator(elements.countryLoadingDot, true);
    elements.countryName.textContent = "Resolving…";
    elements.countryCode.textContent = "--";

    try {
        const payload = await fetchJson(`/api/country?lat=${lat}&lon=${lng}`, {
            signal: controller.signal,
        });
        if (controller.signal.aborted) {
            return;
        }
        state.countryKey = cacheKey;
        state.countryUpdatedAt = Date.now();
        state.countryCache.set(cacheKey, payload);
        setLoadingIndicator(elements.countryLoadingDot, false);
        elements.countryName.textContent = payload.country || "Unknown";
        elements.countryCode.textContent = payload.country_code || "--";
    } catch (error) {
        if (controller.signal.aborted) {
            return;
        }
        setLoadingIndicator(elements.countryLoadingDot, false);
        elements.countryName.textContent = "Unknown";
        elements.countryCode.textContent = "--";
    }
}

function focusSatellite(index, options = {}) {
    elements.satelliteSelect.value = String(index);
    state.currentIndex = index;
    if (options.perspective === "focus") {
        state.perspectiveMode = "focus";
        const when = timeFromSlider(Number(elements.timeSlider.value));
        const sat = state.satellites[index];
        const position = sat ? getSatellitePosition(sat, when) : null;
        if (position) {
            state.perspectiveTarget = {
                source: "focus",
                name: "Resolving ground location…",
                country: "Resolving location…",
                country_code: "",
                region: "",
                display_name: "",
                lat: position.lat,
                lon: position.lng,
            };
            updatePerspectiveFocusLabel(position.lat, position.lng).catch(console.error);
        }
        setOverlayMode(true);
    } else if (state.selectedLocation) {
        setOverlayMode(true);
    }
    updateScene();
    if (options.zoom) {
        zoomToSatellite(index, 1100);
    }
}

async function loadSatelliteDetails(catnr, fallbackName, seedDetails = null) {
    const seeded = normalizeSatelliteDetails(seedDetails || {}, fallbackName);
    let cached = state.detailsCache.get(catnr);
    if (!cached) {
        state.detailsCache.set(catnr, seeded);
        const persisted = await getPersistentCache(`satellite-details:${catnr}`);
        if (persisted?.data) {
            cached = normalizeSatelliteDetails({
                ...persisted.data,
                __cacheUpdatedAt: persisted.updatedAt,
            }, fallbackName);
            state.detailsCache.set(catnr, cached);
        }
    }

    const current = normalizeSatelliteDetails(state.detailsCache.get(catnr) || seeded, fallbackName);
    if (!isHeuristicSatelliteDetails(current) && (!current.__cacheUpdatedAt || cacheAgeMs(current.__cacheUpdatedAt) < SATELLITE_DETAILS_CACHE_TTL_MS)) {
        return current;
    }

    const inFlight = state.detailsInFlight.get(catnr);
    if (inFlight) {
        return inFlight;
    }

    const lastRequestedAt = state.detailsRequestedAt.get(catnr) || 0;
    if (Date.now() - lastRequestedAt < SATELLITE_DETAILS_RETRY_MS) {
        return current;
    }

    state.detailsRequestedAt.set(catnr, Date.now());
    const request = fetchJson(`/api/satellite/${catnr}?name=${encodeURIComponent(fallbackName || "")}`)
        .then((payload) => {
            const details = normalizeSatelliteDetails({
                ...payload,
                __cacheUpdatedAt: Date.now(),
            }, fallbackName);
            state.detailsCache.set(catnr, details);
            void setPersistentCache(`satellite-details:${catnr}`, payload);
            return details;
        })
        .catch(() => {
            const fallback = normalizeSatelliteDetails(state.detailsCache.get(catnr) || seeded, fallbackName);
            state.detailsCache.set(catnr, fallback);
            return fallback;
        })
        .finally(() => {
            state.detailsInFlight.delete(catnr);
        });

    state.detailsInFlight.set(catnr, request);
    return request;
}

function renderSatelliteDetails(focused, details, options = {}) {
    const normalized = normalizeSatelliteDetails(details, focused.name);
    setLoadingIndicator(elements.satelliteLoadingDot, Boolean(options.loading));
    elements.satellitePurposeLabel.textContent = normalized.purpose || "Cataloged space object";
    const ownerLabel = humanizeOwner(normalized);
    const operatorTypeLabel = normalized.operator_type || "";
    const objectTypeLabel = humanizeObjectType(normalized.object_type);
    const statusLabel = humanizeStatus(normalized.ops_status_code);
    const confidenceLabel = humanizeConfidenceLevel(normalized.source_confidence?.overall);
    const inferred = (normalized.source_confidence?.overall || "") === "low"
        || normalized.classification_source === "Name heuristic (satcat unavailable)";
    const summaryParts = [
        confidenceLabel,
        inferred ? "Inferred" : "",
        ownerLabel ? `Owner ${ownerLabel}` : "",
        operatorTypeLabel ? operatorTypeLabel : "",
        objectTypeLabel ? objectTypeLabel : "",
        normalized.ops_status_code ? statusLabel : "",
    ].filter(Boolean);
    const summaryText = summaryParts.join(" · ") || "No extra catalog metadata";
    const freshnessLabel = normalized.__cacheUpdatedAt
        ? ` · cached ${describeFreshness(normalized.__cacheUpdatedAt)}`
        : "";
    elements.satellitePurposeMeta.textContent = options.loading
        ? `${summaryText} · refining catalog facts`
        : `${summaryText}${freshnessLabel}`;
    elements.satelliteSummary.textContent = normalized.summary
        || `Mission context is limited for ${normalized.object_name || focused.name}. Metadata is coming from orbit catalogs, SatNOGS DB, and name-based classification where needed.`;
    if (normalized.summary_url) {
        elements.satelliteLink.href = normalized.summary_url;
        elements.satelliteLink.textContent = normalized.summary_source ? `Open ${normalized.summary_source} reference` : "Open reference";
        elements.satelliteLink.classList.remove("hidden");
    } else {
        elements.satelliteLink.classList.add("hidden");
    }

    const facts = [
        { label: "NORAD", value: focused.satnum },
        { label: "Intl Designator", value: normalized.object_id || "Unknown" },
        { label: "Launch", value: normalized.launch_date || "Unknown" },
        { label: "Deployed", value: normalized.deployed_date || "" },
        { label: "Launch Site", value: normalized.launch_site || "Unknown" },
        { label: "Orbit", value: normalized.orbit_type || "Unspecified" },
        { label: "Owner", value: ownerLabel || "Unknown" },
        { label: "Operator Sector", value: operatorTypeLabel || "Unknown" },
        { label: "Object Type", value: objectTypeLabel || "Unknown" },
        { label: "Status", value: normalized.ops_status_code ? statusLabel : "Unknown" },
        { label: "SatNOGS Status", value: normalized.satnogs_status || "" },
        { label: "Aliases", value: (normalized.aliases || []).slice(0, 5).join(", ") },
        { label: "Countries", value: (normalized.countries || []).join(", ") },
        { label: "Mission Site", value: normalized.website || "" },
        { label: "Period", value: normalized.period_minutes ? `${normalized.period_minutes} min` : "Unknown" },
        { label: "Inclination", value: normalized.inclination_deg ? `${normalized.inclination_deg}°` : `${focused.inclinationDeg}°` },
        { label: "Apogee", value: normalized.apogee_km ? `${normalized.apogee_km} km` : "Unknown" },
        { label: "Perigee", value: normalized.perigee_km ? `${normalized.perigee_km} km` : "Unknown" },
        { label: "Radar Cross Section", value: normalized.rcs || "Unknown" },
        { label: "Eccentricity", value: focused.eccentricity },
        { label: "Classification", value: normalized.classification_source || "Catalog metadata" },
        { label: "Confidence", value: confidenceLabel },
        { label: "Identity Source", value: normalized.field_sources?.identity || "" },
        { label: "Classification Source", value: normalized.field_sources?.classification || "" },
        { label: "Owner Source", value: normalized.field_sources?.owner || "" },
        { label: "Orbit Source", value: normalized.field_sources?.orbit || "" },
        { label: "Summary Source", value: normalized.field_sources?.summary || normalized.summary_source || "" },
        { label: "Citation", value: normalized.citation || "" },
    ];

    if (state.selectedLocation) {
        const when = timeFromSlider(Number(elements.timeSlider.value));
        const position = getSatellitePosition(focused, when);
        if (position) {
            const distanceKm = haversineKm(state.selectedLocation.lat, state.selectedLocation.lon, position.lat, position.lng);
            const visible = angularDistanceDeg(state.selectedLocation.lat, state.selectedLocation.lon, position.lat, position.lng)
                <= visibleCentralAngleDeg(position.altitudeKm);
            const look = getObserverLookAngles(focused, when, state.selectedLocation.lat, state.selectedLocation.lon);
            const relationship = classifyPlaceRelationship(normalized, { distanceKm, visible, look });
            facts.splice(8, 0, { label: `Relation To ${state.selectedLocation.name}`, value: relationship.detail });
        }
    }

    const extraFactMap = {
        OWNER_DESC: "Owner Detail",
        DECAY_DATE: "Decay Date",
        DATA_STATUS_CODE: "Data Status",
        ORBIT_CENTER: "Orbit Center",
        ORBIT_MEANING: "Orbit Meaning",
    };

    for (const [key, label] of Object.entries(extraFactMap)) {
        const value = normalized.raw?.[key];
        if (value) {
            facts.push({ label, value });
        }
    }

    renderSatelliteFacts(facts);
}

function applyCountryPayload(payload) {
    state.countryLabels = payload.items || [];
    state.countryMarkers = [];
}

function buildCountryContext(cameraState, location) {
    const focusLat = Number.isFinite(Number(location?.lat))
        ? Number(location.lat)
        : Number(cameraState.lat);
    const focusLng = Number.isFinite(Number(location?.lon))
        ? Number(location.lon)
        : Number(cameraState.lng);

    return {
        markers: [],
        labels: state.countryLabels
            .map((item) => {
                const distanceDeg = Number.isFinite(focusLat) && Number.isFinite(focusLng)
                    ? angularDistanceDeg(focusLat, focusLng, item.lat, item.lon)
                    : null;
                const nearby = distanceDeg !== null && distanceDeg <= 32;
                const regional = distanceDeg !== null && distanceDeg <= 65;
                return {
                    kind: "country",
                    name: item.name,
                    display_name: item.name,
                    country: item.name,
                    lat: item.lat,
                    lng: item.lon,
                    altitude: nearby ? 0.006 : 0.004,
                    color: nearby
                        ? "rgba(239, 246, 255, 0.96)"
                        : regional
                            ? "rgba(239, 246, 255, 0.82)"
                            : "rgba(239, 246, 255, 0.64)",
                    text: item.name,
                    size: nearby ? 0.48 : regional ? 0.42 : 0.36,
                    dot: 0,
                    distanceDeg: distanceDeg ?? 999,
                };
            })
            .sort((a, b) => b.distanceDeg - a.distanceDeg)
            .map(({ distanceDeg, ...item }) => item),
    };
}

function applySatellitePayload(payload) {
    const nextSatellites = (payload.items || []).map(buildSatelliteRecord);
    if (!nextSatellites.length) {
        state.allSatellites = [];
        state.satellites = [];
        elements.satelliteSelect.innerHTML = "";
        elements.satelliteCount.textContent = "0";
        setGlobeLoading(true, "Loading satellites onto the globe…", "No live satellites available yet.");
        return false;
    }

    const previousSatnum = state.satellites[state.currentIndex]?.satnum;
    state.allSatellites = nextSatellites;
    applySatelliteFilter({ preserveSatnum: previousSatnum });
    elements.satelliteSourceLabel.textContent = humanizeSatelliteSource(payload);
    renderHeroSourceGroups(payload.source_groups || (payload.source ? [payload.source] : []));

    if (payload.source === "fallback" || payload.refreshing) {
        elements.timelineStatus.textContent = payload.last_error
            ? "Refreshing live satellites… fallback active"
            : "Refreshing live satellites…";
        setGlobeLoading(
            true,
            payload.source === "fallback"
                ? `Loaded ${nextSatellites.length} fallback satellites. Fetching live catalog…`
                : `Refreshing live catalog… ${nextSatellites.length} satellites on globe so far.`,
            payload.source === "fallback"
                ? "Showing cached or fallback tracks until the live feed catches up."
                : "The globe is usable now, but the full live set is still being populated."
        );
        scheduleSatelliteWarmRetry();
    } else {
        clearSatelliteWarmRetry();
        setGlobeLoading(false);
    }

    return true;
}

async function refreshSatelliteData({ signal } = {}) {
    setLoadingIndicator(elements.timelineLoadingDot, true);
    setGlobeLoading(true, "Refreshing live satellites…", "Updating visible tracks from the live feed.");
    const payload = await fetchJson("/api/satellites", { signal });
    const loaded = applySatellitePayload(payload);
    if (loaded) {
        updateScene();
        void setPersistentCache("satellites:bootstrap", payload);
    } else {
        elements.timelineStatus.textContent = "No satellites available";
    }
    setLoadingIndicator(elements.timelineLoadingDot, Boolean(payload.refreshing || payload.source === "fallback"));
    return payload;
}

function ensureSatelliteRefreshLoop() {
    if (state.satelliteRefreshLoop?.isActive()) {
        return;
    }
    state.satelliteRefreshLoop = startSmartPollLoop(
        ({ signal }) => refreshSatelliteData({ signal }),
        {
            intervalMs: SATELLITE_POLL_VISIBLE_MS,
            hiddenIntervalMs: SATELLITE_POLL_HIDDEN_MS,
            pauseWhenHidden: true,
            refreshOnVisible: true,
            runImmediately: false,
            maxBackoffMultiplier: 4,
            onError: (error) => {
                console.error(error);
                clearSatelliteWarmRetry();
                setLoadingIndicator(elements.timelineLoadingDot, false);
                elements.timelineStatus.textContent = "Live refresh unavailable";
            },
        }
    );
}

function renderSearchResults(items, options = {}) {
    const emptyMessage = options.emptyMessage || "No matching places";
    elements.searchResults.innerHTML = "";
    if (!items.length) {
        elements.searchResults.classList.remove("hidden");
        const emptyState = document.createElement("div");
        emptyState.className = "search-result-empty";
        emptyState.textContent = emptyMessage;
        elements.searchResults.appendChild(emptyState);
        return;
    }

    for (const item of items) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "search-result";
        const title = document.createElement("strong");
        title.textContent = item.name;
        const subtitle = document.createElement("span");
        subtitle.textContent = item.display_name;
        button.append(title, subtitle);
        button.addEventListener("click", async () => {
            if (item.kind === "norad-satellite" && item.catnr) {
                try {
                    await focusSatelliteByCatnr(Number(item.catnr));
                    elements.locationSearch.value = String(item.catnr);
                    elements.searchResults.classList.add("hidden");
                } catch (error) {
                    console.error(error);
                    renderSearchResults([], {
                        emptyMessage: `NORAD ${item.catnr} could not be focused right now. The catalog entry may exist, but a usable live TLE was not returned.`,
                    });
                }
                return;
            }
            setSelectedLocation(item);
            zoomToLocation(item);
            elements.searchResults.classList.add("hidden");
            setOverlayMode(true);
            updateScene();
        });
        elements.searchResults.appendChild(button);
    }
    elements.searchResults.classList.remove("hidden");
}

async function runLocationSearch(options = {}) {
    const commit = Boolean(options.commit);
    const query = elements.locationSearch.value.trim();
    if (query.length < 2) {
        setSearchLoading(false);
        elements.searchResults.classList.add("hidden");
        return;
    }
    try {
        setSearchLoading(true);
        const payload = await fetchJson(`/api/search?q=${encodeURIComponent(query)}`);
        renderSearchResults(payload.items || []);
    } catch (error) {
        console.error(error);
        renderSearchResults([]);
    } finally {
        setSearchLoading(false);
    }
}

function updateScene() {
    const when = timeFromSlider(Number(elements.timeSlider.value));
    state.sliderMinutes = Number(elements.timeSlider.value);
    if (!state.satellites.length) {
        return;
    }

    let focused = state.satellites[state.currentIndex];
    let focusedPosition = getSatellitePosition(focused, when);
    if (!focusedPosition) {
        const fallbackIndex = state.satellites.findIndex((sat) => getSatellitePosition(sat, when));
        if (fallbackIndex === -1) {
            elements.timelineStatus.textContent = "No propagating satellites available";
            return;
        }
        state.currentIndex = fallbackIndex;
        elements.satelliteSelect.value = String(fallbackIndex);
        focused = state.satellites[fallbackIndex];
        focusedPosition = getSatellitePosition(focused, when);
        if (!focusedPosition) {
            elements.timelineStatus.textContent = "No propagating satellites available";
            return;
        }
    }

    const satelliteBillboards = [];
    const satelliteHitPoints = [];
    const location = state.selectedLocation;
    const cameraState = state.globe?.pointOfView?.() || {};
    const cameraAltitude = Number(cameraState.altitude);
    const emphasizeSatellites = Boolean(location) || (Number.isFinite(cameraAltitude) && cameraAltitude <= 1.7);
    const isolateTraceView = Boolean(state.showOrbitTrace && focused);
    const countryContext = isolateTraceView
        ? { markers: [], labels: [] }
        : buildCountryContext(cameraState, location);
    for (const [index, sat] of state.satellites.entries()) {
        const position = getSatellitePosition(sat, when);
        if (!position) {
            continue;
        }
        const isFocused = sat === focused;
        if (isolateTraceView && !isFocused) {
            continue;
        }
        const overheadVisible = location
            ? angularDistanceDeg(location.lat, location.lon, position.lat, position.lng) <= visibleCentralAngleDeg(position.altitudeKm)
            : false;
        satelliteBillboards.push({
            kind: "satellite",
            index,
            name: sat.name,
            focused: isFocused,
            overhead: overheadVisible,
            lat: position.lat,
            lng: position.lng,
            altitude: Math.max(0.012, position.altitude * (overheadVisible ? 0.25 : 0.22)),
        });
        satelliteHitPoints.push({
            kind: "satellite",
            index,
            lat: position.lat,
            lng: position.lng,
            altitude: Math.max(0.012, position.altitude * 0.22),
            color: "rgba(0, 0, 0, 0)",
            size: isFocused ? 0.18 : overheadVisible ? 0.18 : emphasizeSatellites ? 0.15 : 0.14,
        });
    }

    const orbitPaths = state.showOrbitTrace ? buildOrbitPath(focused, when) : [];
    if (state.perspectiveMode === "focus" && state.perspectiveTarget?.source === "focus" && focusedPosition) {
        state.perspectiveTarget = {
            ...state.perspectiveTarget,
            lat: focusedPosition.lat,
            lon: focusedPosition.lng,
        };
        updatePerspectiveFocusLabel(focusedPosition.lat, focusedPosition.lng).catch(console.error);
    }
    state.globe
        .pointsData([
            ...countryContext.markers,
            ...(location ? [{
                kind: "location",
                name: location.name,
                display_name: location.display_name || location.name,
                country: location.country || location.name,
                country_code: location.country_code || "",
                lat: location.lat,
                lng: location.lon,
                altitude: 0.012,
                color: "#fbbf24",
                size: 0.2,
            }] : []),
            ...satelliteHitPoints,
        ])
        .labelsData([
            ...countryContext.labels,
            ...(location ? [{
                kind: "location",
                name: location.name,
                display_name: location.display_name || location.name,
                country: location.country || location.name,
                country_code: location.country_code || "",
                lat: location.lat,
                lng: location.lon,
                altitude: 0.018,
                color: "#fbbf24",
                text: location.name,
                size: 0.64,
                dot: 0.12,
            }] : []),
        ])
        .htmlElementsData(satelliteBillboards)
        .pathsData(orbitPaths);

    elements.timeLabel.textContent = when.toUTCString().replace(" GMT", " UTC");
    elements.positionLabel.textContent = formatLatLng(focusedPosition.lat, focusedPosition.lng);
    elements.altitudeLabel.textContent = `${Math.round(focusedPosition.altitudeKm).toLocaleString()} km altitude`;
    elements.velocityLabel.textContent = `${focusedPosition.speedKmS.toFixed(2)} km/s`;
    elements.satelliteNameLabel.textContent = focused.name;
    elements.satelliteMetaLabel.textContent = `NORAD ${focused.satnum} · inc ${focused.inclinationDeg}° · ecc ${focused.eccentricity}`;
    elements.timelineStatus.textContent = isolateTraceView
        ? `Tracing ${focused.name}`
        : `Tracking ${focused.name}`;
    updateHeroQuickStatus();
    const seededDetails = buildSeedSatelliteDetails(focused);
    const cachedDetails = state.detailsCache.get(focused.satnum);
    const visibleDetails = normalizeSatelliteDetails(cachedDetails || seededDetails, focused.name);
    const detailsPromise = loadSatelliteDetails(focused.satnum, focused.name, seededDetails);
    if (!cachedDetails?.summary) {
        elements.satelliteSummary.textContent = `Loading mission background for ${focused.name}…`;
        elements.satelliteLink.classList.add("hidden");
    }
    renderSatelliteDetails(
        focused,
        visibleDetails,
        { loading: state.detailsInFlight.has(focused.satnum) }
    );

    updateCountry(focusedPosition.lat, focusedPosition.lng);
    renderSatelliteList(when);
    renderPerspectivePanel(when);
    renderOverheadList(when);
    detailsPromise.then((details) => {
        if (state.satellites[state.currentIndex]?.satnum !== focused.satnum) {
            return;
        }
        renderSatelliteDetails(focused, details);
    });
}

function setPlayState(nextState) {
    state.isPlaying = nextState;
    elements.playPauseButton.textContent = nextState ? "Pause" : "Play";

    if (state.playTimer) {
        window.clearInterval(state.playTimer);
        state.playTimer = null;
    }

    if (!nextState) {
        return;
    }

    state.playTimer = window.setInterval(() => {
        const nextValue = (Number(elements.timeSlider.value) + TIMELINE_PLAY_STEP_MINUTES) % 1441;
        elements.timeSlider.value = String(nextValue > 1440 ? 0 : nextValue);
        updateScene();
    }, TIMELINE_PLAY_INTERVAL_MS);
}

function setupInteractions() {
    elements.satelliteSelect.addEventListener("change", (event) => {
        state.currentIndex = Number(event.target.value);
        updateScene();
    });

    elements.serviceFilter?.addEventListener("change", (event) => {
        state.serviceFilter = event.target.value || "all";
        const hasMatches = applySatelliteFilter();
        if (!hasMatches) {
            elements.timelineStatus.textContent = "No satellites in this service filter";
            return;
        }
        updateScene();
    });

    elements.themeNightButton?.addEventListener("click", () => setTheme("night"));
    elements.themeDayButton?.addEventListener("click", () => setTheme("day"));

    elements.perspectiveLabelLimit?.addEventListener("change", (event) => {
        state.perspectiveLabelLimit = event.target.value === "all"
            ? "all"
            : Math.max(1, Number(event.target.value) || 5);
        renderPerspectivePanel(timeFromSlider(state.sliderMinutes));
    });

    elements.satelliteLimit?.addEventListener("change", (event) => {
        state.satelliteLimit = event.target.value === "all" ? "all" : Math.max(1, Number(event.target.value) || 100);
        const hasMatches = applySatelliteFilter();
        if (!hasMatches) {
            elements.timelineStatus.textContent = "No satellites available for this view";
            return;
        }
        updateScene();
    });

    elements.timeSlider.addEventListener("input", updateScene);

    elements.playPauseButton.addEventListener("click", () => {
        setPlayState(!state.isPlaying);
    });

    elements.orbitTraceToggle.addEventListener("change", (event) => {
        state.showOrbitTrace = event.target.checked;
        updateScene();
    });

    elements.overlayToggle.addEventListener("click", () => {
        setOverlayMode(!state.showOverlay);
    });

    elements.skyPlotOverlay.addEventListener("click", (event) => {
        if (state.overlayDidDrag) {
            state.overlayDidDrag = false;
            return;
        }
        const rect = elements.skyPlotOverlay.getBoundingClientRect();
        const scaleX = elements.skyPlotOverlay.width / rect.width;
        const scaleY = elements.skyPlotOverlay.height / rect.height;
        const x = (event.clientX - rect.left) * scaleX;
        const y = (event.clientY - rect.top) * scaleY;
        const hit = [...state.overlayHitTargets].reverse().find((target) => {
            const inLabel =
                x >= target.labelX &&
                x <= target.labelX + target.labelWidth &&
                y >= target.labelY &&
                y <= target.labelY + target.labelHeight;
            const glyphDistance = Math.hypot(x - target.glyphX, y - target.glyphY);
            return inLabel || glyphDistance <= target.glyphRadius;
        });
        if (hit) {
            focusSatelliteByIdentity(hit.identityKey, satelliteInspectOptions({ zoomWhenGlobal: false }));
        }
    });

    elements.skyPlotOverlay.addEventListener("wheel", (event) => {
        event.preventDefault();
        const nextZoom = clampNumber(
            state.overlayZoom + (event.deltaY < 0 ? 0.18 : -0.18),
            OVERLAY_MIN_ZOOM,
            OVERLAY_MAX_ZOOM,
        );
        if (nextZoom === state.overlayZoom) {
            return;
        }
        state.overlayZoom = nextZoom;
        renderPerspectivePanel(timeFromSlider(state.sliderMinutes));
    }, { passive: false });

    elements.skyPlotOverlay.addEventListener("pointerdown", (event) => {
        state.overlayDragging = true;
        state.overlayPointerId = event.pointerId;
        state.overlayLastPointer = { x: event.clientX, y: event.clientY };
        state.overlayDidDrag = false;
        elements.skyPlotOverlay.classList.add("dragging");
        elements.skyPlotOverlay.setPointerCapture(event.pointerId);
    });

    elements.skyPlotOverlay.addEventListener("pointermove", (event) => {
        if (!state.overlayDragging || state.overlayPointerId !== event.pointerId || !state.overlayLastPointer) {
            return;
        }
        const rect = elements.skyPlotOverlay.getBoundingClientRect();
        const scaleX = elements.skyPlotOverlay.width / rect.width;
        const scaleY = elements.skyPlotOverlay.height / rect.height;
        const dx = (event.clientX - state.overlayLastPointer.x) * scaleX;
        const dy = (event.clientY - state.overlayLastPointer.y) * scaleY;
        state.overlayAzimuthOffsetDeg = ((state.overlayAzimuthOffsetDeg + dx * OVERLAY_AZIMUTH_DRAG_DEG) % 360 + 360) % 360;
        state.overlayPitchDeg = clampNumber(
            state.overlayPitchDeg - dy * OVERLAY_PITCH_DRAG_DEG,
            -OVERLAY_MAX_PITCH_DEG,
            OVERLAY_MAX_PITCH_DEG,
        );
        state.overlayLastPointer = { x: event.clientX, y: event.clientY };
        if (Math.hypot(dx, dy) > 2) {
            state.overlayDidDrag = true;
        }
        renderPerspectivePanel(timeFromSlider(state.sliderMinutes));
    });

    const stopOverlayDrag = (event) => {
        if (state.overlayPointerId !== null && event.pointerId === state.overlayPointerId) {
            try {
                elements.skyPlotOverlay.releasePointerCapture(event.pointerId);
            } catch (error) {
                // Ignore release errors if the pointer is already gone.
            }
        }
        state.overlayDragging = false;
        state.overlayPointerId = null;
        state.overlayLastPointer = null;
        elements.skyPlotOverlay.classList.remove("dragging");
    };

    elements.skyPlotOverlay.addEventListener("pointerup", stopOverlayDrag);
    elements.skyPlotOverlay.addEventListener("pointercancel", stopOverlayDrag);
    elements.skyPlotOverlay.addEventListener("pointerleave", (event) => {
        if (state.overlayDragging) {
            stopOverlayDrag(event);
        }
    });

    elements.skyPlotOverlay.addEventListener("dblclick", () => {
        resetOverlayView();
        renderPerspectivePanel(timeFromSlider(state.sliderMinutes));
    });

    elements.locationSearch.addEventListener("input", () => {
        if (state.searchTimer) {
            window.clearTimeout(state.searchTimer);
        }
        state.searchTimer = window.setTimeout(() => {
            runLocationSearch({ commit: false }).catch(console.error);
        }, 250);
    });

    elements.noradSearch?.addEventListener("input", () => {
        if (state.searchTimer) {
            window.clearTimeout(state.searchTimer);
        }
        state.searchTimer = window.setTimeout(() => {
            runNoradLookup({ commit: false }).catch(console.error);
        }, 250);
    });

    elements.locationSearch.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") {
            return;
        }
        event.preventDefault();
        if (state.searchTimer) {
            window.clearTimeout(state.searchTimer);
            state.searchTimer = null;
        }
        runLocationSearch({ commit: true }).catch(console.error);
    });

    elements.noradSearch?.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") {
            return;
        }
        event.preventDefault();
        if (state.searchTimer) {
            window.clearTimeout(state.searchTimer);
            state.searchTimer = null;
        }
        runNoradLookup({ commit: true }).catch(console.error);
    });

    elements.searchButton.addEventListener("click", () => {
        runLocationSearch({ commit: true }).catch(console.error);
    });

    elements.noradSearchButton?.addEventListener("click", () => {
        runNoradLookup({ commit: true }).catch(console.error);
    });

    document.addEventListener("click", (event) => {
        if (!event.target.closest(".search-wrap")) {
            elements.searchResults.classList.add("hidden");
        }
    });
}

async function bootstrap() {
    buildGlobe();
    setupInteractions();
    try {
        setTheme(localStorage.getItem(`${PERSISTENT_CACHE_PREFIX}theme`) || "night");
    } catch (error) {
        setTheme("night");
    }

    const cachedSatellites = await getPersistentCache("satellites:bootstrap");
    if (cachedSatellites?.data) {
        applySatellitePayload(cachedSatellites.data);
        updateScene();
        elements.timelineStatus.textContent = "Using cached satellites while live data loads…";
        setGlobeLoading(
            true,
            "Using cached satellites while the live catalog loads…",
            `Showing ${cachedSatellites.data.items?.length || 0} cached satellites until the refresh completes.`
        );
    } else {
        setGlobeLoading(true, "Loading satellites onto the globe…", "Waiting for the first live satellite set…");
    }

    const [satellitesResult, countriesResult] = await Promise.allSettled([
        refreshSatelliteData(),
        fetchJson("/api/countries"),
    ]);

    if (countriesResult.status === "fulfilled") {
        applyCountryPayload(countriesResult.value);
    } else {
        console.error(countriesResult.reason);
        applyCountryPayload({ items: [] });
    }

    if (satellitesResult.status !== "fulfilled") {
        throw satellitesResult.reason;
    }

    ensureSatelliteRefreshLoop();
    setOverlayMode(false);
}

bootstrap().catch((error) => {
    console.error(error);
    const message = error instanceof Error ? error.message : "";
    if (elements.timelineStatus) {
        elements.timelineStatus.textContent = message || "Failed to load satellites";
    }
    setGlobeLoading(
        true,
        "Globe startup hit an error",
        message || "The page loaded, but the globe could not finish bootstrapping."
    );
});
