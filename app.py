#!/usr/bin/env python3
import os
import time
from functools import lru_cache

import requests
from flask import Flask, jsonify, render_template, request


app = Flask(__name__)

USER_AGENT = "SatelliteChum/0.1 (+https://localhost)"
CELESTRAK_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle"
CELESTRAK_SATCAT_URL = "https://celestrak.org/satcat/records.php"
COUNTRIES_GEOJSON_URL = "https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json"
REQUEST_TIMEOUT = 15
TLE_CACHE_TTL = 60 * 30
SEARCH_MAX = 80
MAX_SATELLITES = int(os.environ.get("SATELLITECHUM_MAX_SATELLITES", "200"))

FALLBACK_TLES = """ISS (ZARYA)
1 25544U 98067A   26066.51879540  .00015903  00000+0  29038-3 0  9994
2 25544  51.6321  68.2848 0003503 147.9617 330.2048 15.49934412500783
HST
1 20580U 90037B   26066.19438100  .00000798  00000+0  34834-4 0  9993
2 20580  28.4694 322.0325 0001882  58.0536 302.0638 15.26235543863418
NOAA 15
1 25338U 98030A   26066.49663331  .00000085  00000+0  78692-4 0  9990
2 25338  98.7056 132.5837 0011970 109.3887 250.8539 14.27108081452527
"""


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _clean_search_query(value: str | None) -> str:
    if not value:
        return ""
    return " ".join(value.strip().split())[:SEARCH_MAX]


def _parse_tle_payload(payload: str) -> list[dict]:
    lines = [line.strip() for line in payload.splitlines() if line.strip()]
    satellites = []
    for idx in range(0, len(lines) - 2, 3):
        name, line1, line2 = lines[idx : idx + 3]
        if not line1.startswith("1 ") or not line2.startswith("2 "):
            continue
        satellites.append({"name": name, "line1": line1, "line2": line2})
    return satellites


@lru_cache(maxsize=512)
def reverse_geocode_country(lat_round: float, lon_round: float) -> dict:
    try:
        response = requests.get(
            "https://nominatim.openstreetmap.org/reverse",
            params={
                "lat": lat_round,
                "lon": lon_round,
                "format": "jsonv2",
                "zoom": 3,
                "accept-language": "en",
            },
            headers={"User-Agent": USER_AGENT},
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        address = response.json().get("address", {})
        return {
            "country": address.get("country", "Open ocean"),
            "country_code": (address.get("country_code") or "").upper(),
        }
    except requests.RequestException:
        return {"country": "Unknown", "country_code": ""}


_tle_cache = {"fetched_at": 0.0, "items": []}
_satcat_cache: dict[int, dict] = {}
_countries_cache = {"fetched_at": 0.0, "items": []}


def load_satellites() -> list[dict]:
    now = time.time()
    if _tle_cache["items"] and now - _tle_cache["fetched_at"] < TLE_CACHE_TTL:
        return _tle_cache["items"]

    payload = FALLBACK_TLES
    try:
        response = requests.get(
            CELESTRAK_URL,
            headers={"User-Agent": USER_AGENT},
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        payload = response.text
    except requests.RequestException:
        pass

    satellites = _parse_tle_payload(payload)
    _tle_cache["items"] = satellites[:MAX_SATELLITES]
    _tle_cache["fetched_at"] = now
    return _tle_cache["items"]


def _geometry_bbox_center(geometry: dict) -> tuple[float, float] | None:
    coords = geometry.get("coordinates", [])
    gtype = geometry.get("type", "")
    points = []
    if gtype == "Polygon":
        points = [pt for ring in coords for pt in ring]
    elif gtype == "MultiPolygon":
        points = [pt for poly in coords for ring in poly for pt in ring]
    if not points:
        return None
    lons = [pt[0] for pt in points if len(pt) >= 2]
    lats = [pt[1] for pt in points if len(pt) >= 2]
    if not lons or not lats:
        return None
    return ((min(lats) + max(lats)) / 2, (min(lons) + max(lons)) / 2)


def load_country_labels() -> list[dict]:
    now = time.time()
    if _countries_cache["items"] and now - _countries_cache["fetched_at"] < 3600 * 24:
        return _countries_cache["items"]
    try:
        response = requests.get(
            COUNTRIES_GEOJSON_URL,
            headers={"User-Agent": USER_AGENT},
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        geojson = response.json()
        items = []
        for feature in geojson.get("features", []):
            geometry = feature.get("geometry") or {}
            center = _geometry_bbox_center(geometry)
            if not center:
                continue
            name = feature.get("properties", {}).get("name")
            if not name:
                continue
            lat, lon = center
            items.append({"name": name, "lat": round(lat, 2), "lon": round(lon, 2)})
        _countries_cache["items"] = items
        _countries_cache["fetched_at"] = now
        return items
    except (requests.RequestException, ValueError, TypeError):
        return _countries_cache["items"]


def load_satcat_details(catnr: int) -> dict:
    cached = _satcat_cache.get(catnr)
    if cached:
        return cached
    try:
        response = requests.get(
            CELESTRAK_SATCAT_URL,
            params={"CATNR": catnr, "FORMAT": "json"},
            headers={"User-Agent": USER_AGENT},
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        payload = response.json()
        details = payload[0] if payload else {}
    except (requests.RequestException, ValueError, TypeError):
        details = {}
    _satcat_cache[catnr] = details
    return details


def infer_purpose(details: dict, fallback_name: str) -> str:
    object_type = (details.get("OBJECT_TYPE") or "").upper()
    name = (details.get("OBJECT_NAME") or fallback_name or "").upper()
    if object_type == "R/B":
        return "Rocket body"
    if object_type == "DEB":
        return "Debris"
    if "ISS" in name:
        return "Crewed space station"
    if "NOAA" in name or "METEOR" in name:
        return "Weather observation"
    if "HST" in name or "HUBBLE" in name or "OAO" in name:
        return "Space telescope / science mission"
    if "STARLINK" in name:
        return "Communications constellation"
    if object_type == "PAY":
        return "Payload satellite"
    return "Cataloged space object"


def search_places(query: str) -> list[dict]:
    cleaned = _clean_search_query(query)
    if len(cleaned) < 2:
        return []

    items = []
    try:
        response = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={
                "q": cleaned,
                "format": "jsonv2",
                "limit": 8,
                "addressdetails": 1,
                "accept-language": "en",
            },
            headers={"User-Agent": USER_AGENT},
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        for row in response.json():
            address = row.get("address", {})
            items.append(
                {
                    "name": row.get("name") or row.get("display_name", "Unknown place").split(",")[0],
                    "display_name": row.get("display_name", "Unknown place"),
                    "lat": float(row["lat"]),
                    "lon": float(row["lon"]),
                    "country": address.get("country", ""),
                    "country_code": (address.get("country_code") or "").upper(),
                }
            )
    except (requests.RequestException, ValueError, KeyError, TypeError):
        items = []

    if items:
        return items

    try:
        response = requests.get(
            "https://geocoding-api.open-meteo.com/v1/search",
            params={"name": cleaned, "count": 8, "language": "en", "format": "json"},
            headers={"User-Agent": USER_AGENT},
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        payload = response.json()
        fallback_items = []
        for row in payload.get("results", []):
            parts = [row.get("name"), row.get("admin1"), row.get("country")]
            display_name = ", ".join(part for part in parts if part)
            fallback_items.append(
                {
                    "name": row.get("name", "Unknown place"),
                    "display_name": display_name or row.get("name", "Unknown place"),
                    "lat": float(row["latitude"]),
                    "lon": float(row["longitude"]),
                    "country": row.get("country", ""),
                    "country_code": (row.get("country_code") or "").upper(),
                }
            )
        return fallback_items
    except (requests.RequestException, ValueError, KeyError, TypeError):
        return []


@app.after_request
def add_headers(response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "img-src 'self' data: https:; "
        "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com; "
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
        "connect-src 'self' https://celestrak.org https://nominatim.openstreetmap.org; "
        "object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    )
    return response


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/satellites")
def satellites():
    return jsonify({"items": load_satellites(), "fetched_at": int(_tle_cache["fetched_at"])})


@app.route("/api/country")
def country():
    lat = request.args.get("lat", type=float)
    lon = request.args.get("lon", type=float)
    if lat is None or lon is None:
        return jsonify({"error": "lat and lon are required"}), 400

    lat_round = round(_clamp(lat, -90, 90), 1)
    lon_norm = ((lon + 180) % 360) - 180
    lon_round = round(lon_norm, 1)
    return jsonify(reverse_geocode_country(lat_round, lon_round))


@app.route("/api/search")
def search():
    query = request.args.get("q", "", type=str)
    return jsonify({"items": search_places(query)})


@app.route("/api/countries")
def countries():
    return jsonify({"items": load_country_labels()})


@app.route("/api/satellite/<int:catnr>")
def satellite_details(catnr: int):
    details = load_satcat_details(catnr)
    purpose = infer_purpose(details, "")
    return jsonify(
        {
            "purpose": purpose,
            "object_name": details.get("OBJECT_NAME", ""),
            "object_id": details.get("OBJECT_ID", ""),
            "object_type": details.get("OBJECT_TYPE", ""),
            "ops_status_code": details.get("OPS_STATUS_CODE", ""),
            "owner": details.get("OWNER", ""),
            "launch_date": details.get("LAUNCH_DATE", ""),
            "launch_site": details.get("LAUNCH_SITE", ""),
            "orbit_type": details.get("ORBIT_TYPE", ""),
            "period_minutes": details.get("PERIOD"),
            "inclination_deg": details.get("INCLINATION"),
            "apogee_km": details.get("APOGEE"),
            "perigee_km": details.get("PERIGEE"),
            "rcs": details.get("RCS"),
            "raw": details,
        }
    )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    app.run(host="0.0.0.0", port=port, debug=True)
