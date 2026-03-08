const state = {
    satellites: [],
    currentIndex: 0,
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
    overlayVisibleNow: [],
    overlayFrame: null,
    overlayHitTargets: [],
    perspectiveMode: "location",
    perspectiveTarget: null,
};

const elements = {
    satelliteCount: document.getElementById("satelliteCount"),
    timelineStatus: document.getElementById("timelineStatus"),
    overlayToggle: document.getElementById("overlayToggle"),
    locationSearch: document.getElementById("locationSearch"),
    searchButton: document.getElementById("searchButton"),
    searchResults: document.getElementById("searchResults"),
    satelliteSelect: document.getElementById("satelliteSelect"),
    timeSlider: document.getElementById("timeSlider"),
    timeLabel: document.getElementById("timeLabel"),
    countryName: document.getElementById("countryName"),
    countryCode: document.getElementById("countryCode"),
    positionLabel: document.getElementById("positionLabel"),
    altitudeLabel: document.getElementById("altitudeLabel"),
    velocityLabel: document.getElementById("velocityLabel"),
    satelliteNameLabel: document.getElementById("satelliteNameLabel"),
    satelliteMetaLabel: document.getElementById("satelliteMetaLabel"),
    satellitePurposeLabel: document.getElementById("satellitePurposeLabel"),
    satellitePurposeMeta: document.getElementById("satellitePurposeMeta"),
    satelliteFactGrid: document.getElementById("satelliteFactGrid"),
    playPauseButton: document.getElementById("playPauseButton"),
    orbitTraceToggle: document.getElementById("orbitTraceToggle"),
    satelliteList: document.getElementById("satelliteList"),
    selectedLocationName: document.getElementById("selectedLocationName"),
    selectedLocationMeta: document.getElementById("selectedLocationMeta"),
    searchSummary: document.getElementById("searchSummary"),
    overheadCount: document.getElementById("overheadCount"),
    overheadList: document.getElementById("overheadList"),
    orbitCount: document.getElementById("orbitCount"),
    orbitSummary: document.getElementById("orbitSummary"),
    orbitalOverlay: document.getElementById("orbitalOverlay"),
    skyPlotOverlay: document.getElementById("skyPlotOverlay"),
    overlayMeta: document.getElementById("overlayMeta"),
};

const EARTH_RADIUS_KM = 6371;
const DEG_TO_RAD = Math.PI / 180;
const earthOverlayImage = new Image();
earthOverlayImage.crossOrigin = "anonymous";
earthOverlayImage.src = "https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-night.jpg";
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
    node.innerHTML = `
        <span class="sat-billboard__icon" style="background-image:url(&quot;data:image/svg+xml;charset=utf-8,${satelliteIconSvg}&quot;);"></span>
        <span class="sat-billboard__label">${item.name}</span>
    `;
    node.title = item.name;
    node.addEventListener("click", (event) => {
        event.stopPropagation();
        focusSatellite(item.index, { zoom: true, perspective: "focus" });
    });
    return node;
}

function buildGlobe() {
    const globe = Globe()(document.getElementById("globeViz"))
        .globeImageUrl("https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-night.jpg")
        .bumpImageUrl("https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-topology.png")
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
                focusSatellite(item.index, { zoom: true, perspective: "focus" });
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
                focusSatellite(item.index, { zoom: true, perspective: "focus" });
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
        .labelsData([])
        .width(document.getElementById("globeViz").clientWidth)
        .height(document.getElementById("globeViz").clientHeight);

    globe.controls().autoRotate = false;
    globe.controls().autoRotateSpeed = 0;
    globe.pointOfView({ altitude: 2.2 }, 0);
    state.globe = globe;

    window.addEventListener("resize", () => {
        globe.width(document.getElementById("globeViz").clientWidth);
        globe.height(document.getElementById("globeViz").clientHeight);
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

function renderSatelliteFacts(facts) {
    elements.satelliteFactGrid.innerHTML = "";
    for (const fact of facts.filter((item) => item.value)) {
        const node = document.createElement("div");
        node.className = "satellite-fact";
        node.innerHTML = `<span>${fact.label}</span><strong>${fact.value}</strong>`;
        elements.satelliteFactGrid.appendChild(node);
    }
}

function setSelectedLocation(location) {
    if (!location) {
        state.selectedLocation = null;
        elements.selectedLocationName.textContent = "None selected";
        elements.selectedLocationMeta.textContent = "Use the search box above";
        return;
    }

    const normalized = {
        name: location.name,
        display_name: location.display_name || location.name,
        country: location.country || location.name,
        country_code: location.country_code || "",
        lat: Number(location.lat),
        lon: Number(location.lon),
    };
    state.selectedLocation = normalized;
    state.perspectiveMode = "location";
    state.perspectiveTarget = {
        ...normalized,
        source: "location",
    };
    elements.locationSearch.value = normalized.display_name;
    elements.selectedLocationName.textContent = normalized.name;
    elements.selectedLocationMeta.textContent = `${normalized.country || "Unknown region"} · ${formatLatLng(normalized.lat, normalized.lon)}`;
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

function zoomToLocation(location, duration = 900) {
    if (!location || !state.globe) {
        return;
    }
    state.globe.pointOfView(
        {
            lat: Number(location.lat),
            lng: Number(location.lon),
            altitude: 1.45,
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
            altitude: 1.18,
        },
        duration,
    );
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
    return {
        ...item,
        satrec,
        satnum: satrec.satnum,
        inclinationDeg: Number((satrec.inclo * 180 / Math.PI).toFixed(2)),
        eccentricity: Number(satrec.ecco.toFixed(5)),
        meanMotion: Number(satrec.no.toFixed(6)),
    };
}

function getSatellitePosition(satItem, when) {
    const pv = satellite.propagate(satItem.satrec, when);
    if (!pv.position || !pv.velocity) {
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
    const points = [];
    for (let minute = -720; minute <= 720; minute += 20) {
        const sampleTime = new Date(centerTime.getTime() + minute * 60 * 1000);
        const position = getSatellitePosition(satItem, sampleTime);
        if (!position) {
            continue;
        }
        points.push({
            lat: position.lat,
            lng: position.lng,
            altitude: Math.max(0.008, position.altitude * 0.4),
        });
    }
    return points;
}

function renderSatelliteList(when) {
    const focused = state.satellites[state.currentIndex];
    elements.satelliteList.innerHTML = "";
    elements.orbitCount.textContent = `${state.satellites.length} tracked objects`;
    const location = state.selectedLocation;
    const rankedItems = state.satellites
        .map((sat, index) => {
            const position = getSatellitePosition(sat, when);
            if (!position) {
                return null;
            }
            const overheadVisible = location
                ? angularDistanceDeg(location.lat, location.lon, position.lat, position.lng) <= visibleCentralAngleDeg(position.altitudeKm)
                : false;
            const distanceKm = location
                ? haversineKm(location.lat, location.lon, position.lat, position.lng)
                : Math.abs(index - state.currentIndex) * 1000;
            return { sat, index, position, overheadVisible, distanceKm };
        })
        .filter(Boolean)
        .sort((a, b) => {
            if (a.index === state.currentIndex) {
                return -1;
            }
            if (b.index === state.currentIndex) {
                return 1;
            }
            if (a.overheadVisible !== b.overheadVisible) {
                return a.overheadVisible ? -1 : 1;
            }
            return a.distanceKm - b.distanceKm;
        });
    const displayItems = rankedItems.slice(0, 12);
    elements.orbitSummary.textContent = focused
        ? `${focused.name} is the current focus. Showing ${displayItems.length} priority objects from the ${state.satellites.length}-satellite tracked set.`
        : `Showing ${displayItems.length} priority objects from the ${state.satellites.length}-satellite tracked set.`;

    displayItems.forEach(({ sat, index, position, overheadVisible }) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `satellite-chip${index === state.currentIndex ? " active" : ""}`;
        button.innerHTML = `
            <strong>${sat.name}</strong>
            <span>${Math.round(position.altitudeKm)} km altitude</span>
            <small>${index === state.currentIndex ? "Focused orbit" : overheadVisible ? "Overhead priority" : "Click to inspect"}</small>
        `;
        button.addEventListener("click", () => {
            focusSatellite(index, { zoom: true });
        });
        elements.satelliteList.appendChild(button);
    });

    if (focused) {
        elements.timelineStatus.textContent = `Tracking ${focused.name}`;
    }
}

function setOverlayMode(nextState) {
    state.showOverlay = nextState;
    elements.overlayToggle.classList.toggle("active", nextState);
    elements.orbitalOverlay.classList.toggle("hidden", !nextState);
    syncOverlayAnimation();
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

function animateOverlay() {
    if (!state.showOverlay) {
        state.overlayFrame = null;
        return;
    }
    drawOrbitalPerspective(
        elements.skyPlotOverlay,
        state.overlayVisibleNow,
        elements.overlayMeta,
        getPerspectiveTarget(timeFromSlider(state.sliderMinutes)),
    );
    state.overlayFrame = window.requestAnimationFrame(animateOverlay);
}

function syncOverlayAnimation() {
    if (state.showOverlay) {
        if (!state.overlayFrame) {
            state.overlayFrame = window.requestAnimationFrame(animateOverlay);
        }
        return;
    }
    if (state.overlayFrame) {
        window.cancelAnimationFrame(state.overlayFrame);
        state.overlayFrame = null;
    }
}

function computeOverheadEntries(when, target = state.selectedLocation) {
    const location = target;
    if (!location) {
        return { ranked: [], visibleNow: [], displayItems: [] };
    }

    const ranked = state.satellites
        .map((sat, index) => {
            const position = getSatellitePosition(sat, when);
            if (!position) {
                return null;
            }
            const distanceKm = haversineKm(location.lat, location.lon, position.lat, position.lng);
            const visible = angularDistanceDeg(location.lat, location.lon, position.lat, position.lng)
                <= visibleCentralAngleDeg(position.altitudeKm);
            const look = getObserverLookAngles(sat, when, location.lat, location.lon);
            return { sat, index, position, distanceKm, visible, look };
        })
        .filter(Boolean)
        .sort((a, b) => a.distanceKm - b.distanceKm);

    const visibleNow = ranked.filter((item) => item.visible);
    const displayItems = (visibleNow.length ? visibleNow : ranked.slice(0, 5)).slice(0, 8);
    return { ranked, visibleNow, displayItems };
}

function drawOrbitalPerspective(canvas, visibleNow, metaNode, target) {
    const ctx = canvas.getContext("2d");
    const { width, height } = canvas;
    const targetX = width * 0.5;
    const horizonY = height * 0.72;
    const sweepDeg = (performance.now() * 0.0025) % 360;
    state.overlayHitTargets = [];

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#01040a";
    ctx.fillRect(0, 0, width, height);
    const skyGradient = ctx.createLinearGradient(0, 0, 0, height);
    skyGradient.addColorStop(0, "#02060d");
    skyGradient.addColorStop(0.55, "#04101a");
    skyGradient.addColorStop(1, "#0b1322");
    ctx.fillStyle = skyGradient;
    ctx.fillRect(0, 0, width, height);

    for (let i = 0; i < 160; i += 1) {
        const x = (Math.sin(i * 91.31) * 0.5 + 0.5) * width;
        const y = (Math.cos(i * 53.17) * 0.5 + 0.5) * height * 0.6;
        ctx.fillStyle = `rgba(255,255,255,${i % 7 === 0 ? 0.65 : 0.14})`;
        ctx.fillRect(x, y, i % 11 === 0 ? 2.4 : 1.4, i % 11 === 0 ? 2.4 : 1.4);
    }

    for (let y = 0; y < height; y += 4) {
        ctx.fillStyle = "rgba(90, 220, 255, 0.022)";
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
    if (earthOverlayImage.complete && earthOverlayImage.naturalWidth) {
        ctx.drawImage(earthOverlayImage, 0, horizonY - height * 0.18, width, height * 0.64);
    } else {
        const earthGradient = ctx.createLinearGradient(0, horizonY - 120, 0, height);
        earthGradient.addColorStop(0, "#92d8ff");
        earthGradient.addColorStop(0.05, "#ecf6ff");
        earthGradient.addColorStop(0.1, "#6d8aa6");
        earthGradient.addColorStop(0.4, "#1a2535");
        earthGradient.addColorStop(1, "#0c111b");
        ctx.fillStyle = earthGradient;
        ctx.fillRect(0, horizonY - 120, width, height);
    }
    ctx.restore();

    ctx.strokeStyle = "rgba(125, 211, 252, 0.75)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, horizonY);
    ctx.quadraticCurveTo(width * 0.5, horizonY - 70, width, horizonY);
    ctx.stroke();

    const placeName = target?.name || "Target";
    const countLabel = `${visibleNow.length} TRACKED OBJECT${visibleNow.length === 1 ? "" : "S"}`;
    ctx.fillStyle = "rgba(90, 220, 255, 0.88)";
    ctx.font = '14px "IBM Plex Mono", monospace';
    ctx.fillText("OVERHEAD INTEL", 28, 38);
    ctx.font = '700 24px "IBM Plex Mono", monospace';
    ctx.fillStyle = "#eff6ff";
    ctx.fillText(visibleNow.length ? "ACTIVE" : "CLEAR", 28, 70);
    ctx.font = '14px "IBM Plex Mono", monospace';
    ctx.fillStyle = "rgba(90, 220, 255, 0.82)";
    ctx.fillText(countLabel, 28, 96);
    ctx.fillText(`TARGET ${placeName.toUpperCase()}`, 28, 118);

    const infoLines = [
        target ? `${Math.abs(target.lat).toFixed(2)} ${target.lat >= 0 ? "N" : "S"}` : "",
        target ? `${Math.abs(target.lon).toFixed(2)} ${target.lon >= 0 ? "E" : "W"}` : "",
        `UTC ${timeFromSlider(state.sliderMinutes).toISOString().slice(11, 19)}`,
    ].filter(Boolean);
    ctx.fillStyle = "rgba(239, 246, 255, 0.88)";
    infoLines.forEach((line, idx) => ctx.fillText(line, 28, 146 + idx * 22));

    ctx.fillStyle = "#fbbf24";
    ctx.fillRect(targetX - 2, horizonY - 20, 4, 20);
    ctx.fillStyle = "#eff6ff";
    ctx.font = '18px "IBM Plex Mono", monospace';
    ctx.fillText(placeName, targetX + 12, horizonY - 8);

    const sceneItems = visibleNow.slice(0, 8).map((item) => {
        const elev = Math.max(0, Math.min(90, item.look?.elevationDeg || 0));
        const rotatedAz = (((item.look?.azimuthDeg || 0) + sweepDeg) % 360) * DEG_TO_RAD;
        const x = targetX + Math.sin(rotatedAz) * width * 0.31;
        const y = horizonY - 90 - (elev / 90) * (height * 0.42) - Math.cos(rotatedAz) * 26;
        const isFocused = item.index === state.currentIndex;
        return {
            item,
            elev,
            x,
            y,
            isFocused,
            labelWidth: Math.min(220, Math.max(112, item.sat.name.length * 8.6)),
            side: x >= targetX ? "right" : "left",
            labelY: y,
        };
    });

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

    layoutColumn(sceneItems.filter((entry) => entry.side === "left"));
    layoutColumn(sceneItems.filter((entry) => entry.side === "right"));

    sceneItems.forEach((entry) => {
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

        drawSatelliteGlyph(ctx, x, y, isFocused ? "#fbbf24" : "#7dd3fc", isFocused);

        ctx.fillStyle = "rgba(2, 7, 14, 0.8)";
        ctx.fillRect(labelX, labelTop, labelWidth, 42);
        ctx.strokeStyle = isFocused ? "rgba(251, 191, 36, 0.55)" : "rgba(125, 211, 252, 0.35)";
        ctx.strokeRect(labelX, labelTop, labelWidth, 42);
        ctx.fillStyle = "#eff6ff";
        ctx.font = '15px "IBM Plex Mono", monospace';
        ctx.fillText(item.sat.name, labelX + 8, labelTop + 19);
        ctx.fillStyle = "rgba(148, 167, 188, 0.95)";
        ctx.font = '12px "IBM Plex Mono", monospace';
        ctx.fillText(`${Math.round(elev)} DEG`, labelX + 8, labelTop + 34);

        state.overlayHitTargets.push({
            index: item.index,
            glyphX: x,
            glyphY: y,
            glyphRadius: isFocused ? 16 : 13,
            labelX,
            labelY: labelTop,
            labelWidth,
            labelHeight: 42,
        });
    });

    if (!sceneItems.length) {
        ctx.fillStyle = "rgba(239, 246, 255, 0.78)";
        ctx.font = '20px "IBM Plex Mono", monospace';
        ctx.fillText("No tracked satellites above the horizon", width * 0.28, height * 0.28);
    }
    if (metaNode) {
        metaNode.textContent = visibleNow.length
            ? `${visibleNow.length} above the horizon now`
            : "No tracked satellites above the horizon now";
    }
}

function drawSkyPlot(visibleNow, target) {
    state.overlayVisibleNow = visibleNow;
    drawOrbitalPerspective(elements.skyPlotOverlay, visibleNow, elements.overlayMeta, target);
}

function renderPerspectivePanel(when) {
    const target = getPerspectiveTarget(when);
    if (!target) {
        elements.overlayMeta.textContent = "Select a place or click a satellite to drive perspective";
        drawSkyPlot([], null);
        return;
    }
    const { visibleNow } = computeOverheadEntries(when, target);
    elements.overlayMeta.textContent = target.source === "focus"
        ? `${visibleNow.length} satellites near ${target.name}'s ground track`
        : `${visibleNow.length} above the horizon now`;
    drawSkyPlot(visibleNow, target);
}

function renderOverheadList(when) {
    elements.overheadList.innerHTML = "";
    const { ranked, visibleNow, displayItems } = computeOverheadEntries(when);
    const location = state.selectedLocation;
    if (!location) {
        elements.overheadCount.textContent = "0 visible now";
        return;
    }

    if (!displayItems.length) {
        elements.overheadCount.textContent = "0 visible now";
        return;
    }

    elements.overheadCount.textContent = `${visibleNow.length} visible now`;
    if (visibleNow.length) {
        elements.searchSummary.textContent =
            `${visibleNow.length} tracked satellite${visibleNow.length === 1 ? "" : "s"} are above the horizon for ${location.name} at the selected time.`;
    } else {
        const closest = ranked[0];
        elements.searchSummary.textContent =
            `No tracked satellites are above the horizon for ${location.name} right now. Closest is ${closest.sat.name} at ${Math.round(closest.distanceKm)} km from the subsatellite point.`;
    }
    for (const item of displayItems) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `satellite-chip${item.index === state.currentIndex ? " active" : ""}`;
        button.innerHTML = `
            <strong>${item.sat.name}</strong>
            <span>${item.visible ? `Visible overhead · ${Math.round(item.look?.elevationDeg || 0)}° elevation` : `${Math.round(item.distanceKm)} km away`}</span>
            <small>${formatLatLng(item.position.lat, item.position.lng)} · ${Math.round(item.position.altitudeKm)} km altitude</small>
        `;
        button.addEventListener("click", () => focusSatellite(item.index, { zoom: true }));
        elements.overheadList.appendChild(button);
    }
}

async function updateCountry(lat, lng) {
    if (state.countryAbort) {
        state.countryAbort.abort();
    }

    const controller = new AbortController();
    state.countryAbort = controller;
    elements.countryName.textContent = "Resolving…";
    elements.countryCode.textContent = "--";

    try {
        const response = await fetch(`/api/country?lat=${lat}&lon=${lng}`, {
            signal: controller.signal,
        });
        const payload = await response.json();
        if (controller.signal.aborted) {
            return;
        }
        elements.countryName.textContent = payload.country || "Unknown";
        elements.countryCode.textContent = payload.country_code || "--";
        if (state.perspectiveMode === "focus" && state.perspectiveTarget?.source === "focus") {
            state.perspectiveTarget = {
                ...state.perspectiveTarget,
                name: payload.country || "Ground track",
                country: payload.country || "Ground track",
                country_code: payload.country_code || "",
            };
            renderPerspectivePanel(timeFromSlider(Number(elements.timeSlider.value)));
        }
    } catch (error) {
        if (controller.signal.aborted) {
            return;
        }
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
            const countryName = elements.countryName.textContent && elements.countryName.textContent !== "Resolving…"
                ? elements.countryName.textContent
                : "Ground track";
            state.perspectiveTarget = {
                source: "focus",
                name: countryName,
                country: countryName,
                country_code: elements.countryCode.textContent || "",
                lat: position.lat,
                lon: position.lng,
            };
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

async function loadSatelliteDetails(catnr, fallbackName) {
    if (state.detailsCache.has(catnr)) {
        return state.detailsCache.get(catnr);
    }
    try {
        const response = await fetch(`/api/satellite/${catnr}`);
        const payload = await response.json();
        const details = {
            ...payload,
            purpose: payload.purpose || "Cataloged space object",
            object_name: payload.object_name || fallbackName,
        };
        state.detailsCache.set(catnr, details);
        return details;
    } catch (error) {
        const fallback = { purpose: "Cataloged space object", object_name: fallbackName };
        state.detailsCache.set(catnr, fallback);
        return fallback;
    }
}

function renderSatelliteDetails(focused, details) {
    elements.satellitePurposeLabel.textContent = details.purpose || "Cataloged space object";
    const ownerLabel = humanizeOwner(details);
    const objectTypeLabel = humanizeObjectType(details.object_type);
    const statusLabel = humanizeStatus(details.ops_status_code);
    const summaryParts = [
        ownerLabel ? `Owner ${ownerLabel}` : "",
        objectTypeLabel ? objectTypeLabel : "",
        details.ops_status_code ? statusLabel : "",
    ].filter(Boolean);
    elements.satellitePurposeMeta.textContent = summaryParts.join(" · ") || "No extra catalog metadata";

    const facts = [
        { label: "NORAD", value: focused.satnum },
        { label: "Intl Designator", value: details.object_id || "Unknown" },
        { label: "Launch", value: details.launch_date || "Unknown" },
        { label: "Launch Site", value: details.launch_site || "Unknown" },
        { label: "Orbit", value: details.orbit_type || "Unspecified" },
        { label: "Owner", value: ownerLabel || "Unknown" },
        { label: "Object Type", value: objectTypeLabel || "Unknown" },
        { label: "Status", value: details.ops_status_code ? statusLabel : "Unknown" },
        { label: "Period", value: details.period_minutes ? `${details.period_minutes} min` : "Unknown" },
        { label: "Inclination", value: details.inclination_deg ? `${details.inclination_deg}°` : `${focused.inclinationDeg}°` },
        { label: "Apogee", value: details.apogee_km ? `${details.apogee_km} km` : "Unknown" },
        { label: "Perigee", value: details.perigee_km ? `${details.perigee_km} km` : "Unknown" },
        { label: "Radar Cross Section", value: details.rcs || "Unknown" },
        { label: "Eccentricity", value: focused.eccentricity },
    ];

    const extraFactMap = {
        OWNER_DESC: "Owner Detail",
        DECAY_DATE: "Decay Date",
        DATA_STATUS_CODE: "Data Status",
        ORBIT_CENTER: "Orbit Center",
        ORBIT_MEANING: "Orbit Meaning",
    };

    for (const [key, label] of Object.entries(extraFactMap)) {
        const value = details.raw?.[key];
        if (value) {
            facts.push({ label, value });
        }
    }

    renderSatelliteFacts(facts);
}

function renderSearchResults(items) {
    elements.searchResults.innerHTML = "";
    if (!items.length) {
        elements.searchResults.classList.remove("hidden");
        elements.searchResults.innerHTML = `<div class="search-result-empty">No matching places</div>`;
        return;
    }

    for (const item of items) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "search-result";
        button.innerHTML = `
            <strong>${item.name}</strong>
            <span>${item.display_name}</span>
        `;
        button.addEventListener("click", () => {
            setSelectedLocation(item);
            elements.searchResults.classList.add("hidden");
            setOverlayMode(true);
            updateScene();
        });
        elements.searchResults.appendChild(button);
    }
    elements.searchResults.classList.remove("hidden");
}

async function runLocationSearch() {
    const query = elements.locationSearch.value.trim();
    if (query.length < 2) {
        elements.searchResults.classList.add("hidden");
        return;
    }
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const payload = await response.json();
    renderSearchResults(payload.items || []);
}

function updateScene() {
    const when = timeFromSlider(Number(elements.timeSlider.value));
    state.sliderMinutes = Number(elements.timeSlider.value);
    const focused = state.satellites[state.currentIndex];
    if (!focused) {
        return;
    }

    const satelliteBillboards = [];
    const satelliteHitPoints = [];
    const location = state.selectedLocation;
    const visibleAboveLocation = [];
    for (const [index, sat] of state.satellites.entries()) {
        const position = getSatellitePosition(sat, when);
        if (!position) {
            continue;
        }
        const isFocused = sat === focused;
        const overheadVisible = location
            ? angularDistanceDeg(location.lat, location.lon, position.lat, position.lng) <= visibleCentralAngleDeg(position.altitudeKm)
            : false;
        if (overheadVisible) {
            visibleAboveLocation.push({ index, sat, position });
        }
        satelliteBillboards.push({
            kind: "satellite",
            index,
            name: sat.name,
            focused: isFocused,
            overhead: overheadVisible,
            lat: position.lat,
            lng: position.lng,
            altitude: Math.max(0.012, position.altitude * 0.22),
        });
        satelliteHitPoints.push({
            kind: "satellite",
            index,
            lat: position.lat,
            lng: position.lng,
            altitude: Math.max(0.012, position.altitude * 0.22),
            color: "rgba(0, 0, 0, 0)",
            size: isFocused ? 0.18 : overheadVisible ? 0.16 : 0.14,
        });
    }

    const focusedPosition = getSatellitePosition(focused, when);
    const orbitPath = buildOrbitPath(focused, when);
    state.globe
        .pointsData([
            ...state.countryMarkers,
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
            ...state.countryLabels.map((item) => ({
                kind: "country",
                name: item.name,
                display_name: item.name,
                country: item.name,
                lat: item.lat,
                lng: item.lon,
                altitude: 0.012,
                color: "rgba(239, 246, 255, 0.92)",
                text: item.name,
                size: 0.52,
                dot: 0.08,
            })),
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
        .pathsData(state.showOrbitTrace ? [
            {
                points: orbitPath,
                color: "#fbbf24",
                stroke: 0.45,
            },
        ] : []);

    if (location) {
        state.globe.controls().autoRotate = false;
        state.globe.pointOfView(
            {
                lat: location.lat,
                lng: location.lon,
                altitude: visibleAboveLocation.length > 2 ? 1.9 : 1.6,
            },
            900,
        );
    } else {
        state.globe.controls().autoRotate = false;
        state.globe.pointOfView(
            {
                lat: focusedPosition.lat,
                lng: focusedPosition.lng,
                altitude: 1.6,
            },
            900,
        );
    }

    elements.timeLabel.textContent = when.toUTCString().replace(" GMT", " UTC");
    elements.positionLabel.textContent = formatLatLng(focusedPosition.lat, focusedPosition.lng);
    elements.altitudeLabel.textContent = `${Math.round(focusedPosition.altitudeKm).toLocaleString()} km altitude`;
    elements.velocityLabel.textContent = `${focusedPosition.speedKmS.toFixed(2)} km/s`;
    elements.satelliteNameLabel.textContent = focused.name;
    elements.satelliteMetaLabel.textContent = `NORAD ${focused.satnum} · inc ${focused.inclinationDeg}° · ecc ${focused.eccentricity}`;
    elements.satellitePurposeLabel.textContent = "Loading mission profile…";
    elements.satellitePurposeMeta.textContent = "Fetching catalog metadata";
    renderSatelliteFacts([]);

    updateCountry(focusedPosition.lat, focusedPosition.lng);
    renderSatelliteList(when);
    renderPerspectivePanel(when);
    renderOverheadList(when);
    loadSatelliteDetails(focused.satnum, focused.name).then((details) => {
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
        const nextValue = (Number(elements.timeSlider.value) + 5) % 1445;
        elements.timeSlider.value = String(nextValue > 1440 ? 0 : nextValue);
        updateScene();
    }, 280);
}

function setupInteractions() {
    elements.satelliteSelect.addEventListener("change", (event) => {
        state.currentIndex = Number(event.target.value);
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
            focusSatellite(hit.index);
        }
    });

    elements.locationSearch.addEventListener("input", () => {
        if (state.searchTimer) {
            window.clearTimeout(state.searchTimer);
        }
        state.searchTimer = window.setTimeout(() => {
            runLocationSearch().catch(console.error);
        }, 250);
    });

    elements.searchButton.addEventListener("click", () => {
        runLocationSearch().catch(console.error);
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

    const [satellitesResponse, countriesResponse] = await Promise.all([
        fetch("/api/satellites"),
        fetch("/api/countries"),
    ]);
    const payload = await satellitesResponse.json();
    const countriesPayload = await countriesResponse.json();
    state.satellites = payload.items.map(buildSatelliteRecord);
    state.countryLabels = countriesPayload.items || [];
    state.countryMarkers = state.countryLabels.map((item) => ({
        kind: "country",
        name: item.name,
        display_name: item.name,
        country: item.name,
        lat: item.lat,
        lng: item.lon,
        altitude: 0.01,
        color: "rgba(125, 211, 252, 0.95)",
        size: 0.1,
    }));
    elements.satelliteCount.textContent = String(state.satellites.length);

    for (const [index, sat] of state.satellites.entries()) {
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent = sat.name;
        elements.satelliteSelect.appendChild(option);
    }

    updateScene();
    setOverlayMode(false);
}

bootstrap().catch((error) => {
    console.error(error);
    elements.timelineStatus.textContent = "Failed to load satellites";
});
