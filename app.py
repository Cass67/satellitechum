#!/usr/bin/env python3
import math
import os
import re
import secrets
import threading
import time
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote

import requests
from flask import Flask, jsonify, render_template, request
from werkzeug.middleware.proxy_fix import ProxyFix

try:
    import redis as _redis_module  # type: ignore[import]

    _REDIS_AVAILABLE = True
except ImportError:
    _redis_module = None  # type: ignore[assignment]
    _REDIS_AVAILABLE = False


app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)

USER_AGENT = "SatelliteChum/0.1 (+https://localhost)"
CELESTRAK_GROUP_URLS = [
    ("visual", "https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle"),
    ("stations", "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle"),
    ("active", "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle"),
]
SATNOGS_TLE_URL = "https://db.satnogs.org/api/tle/"
SATNOGS_SATELLITES_URL = "https://db.satnogs.org/api/satellites/"
CELESTRAK_SATCAT_URL = "https://celestrak.org/satcat/records.php"
SPACE_TRACK_LOGIN_URL = "https://www.space-track.org/ajaxauth/login"
SPACE_TRACK_SATCAT_QUERY_URL = (
    "https://www.space-track.org/basicspacedata/query/class/satcat/norad_cat_id/{catnr}/format/json"
)
COUNTRIES_GEOJSON_URL = (
    "https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json"
)
BIGDATACLOUD_REVERSE_URL = "https://api.bigdatacloud.net/data/reverse-geocode-client"
WORLD_BANK_INDICATOR_URL = "https://api.worldbank.org/v2/country/{code}/indicator/SP.POP.TOTL"
OPEN_METEO_SEARCH_URL = "https://geocoding-api.open-meteo.com/v1/search"
WIKIDATA_API_URL = "https://www.wikidata.org/w/api.php"
REQUEST_TIMEOUT = 15
TLE_REQUEST_TIMEOUT = float(os.environ.get("SATELLITECHUM_TLE_TIMEOUT", "6"))
SATCAT_REQUEST_TIMEOUT = float(os.environ.get("SATELLITECHUM_SATCAT_TIMEOUT", "2.5"))
TLE_CACHE_TTL = 60 * 30
SATCAT_CACHE_TTL = 60 * 60 * 24
SATCAT_FAILURE_TTL = 60 * 5
SEARCH_MAX = 80
MAX_SATELLITES = int(os.environ.get("SATELLITECHUM_MAX_SATELLITES", "0"))
SATNOGS_PAGE_SIZE = int(
    os.environ.get(
        "SATELLITECHUM_SATNOGS_PAGE_SIZE",
        "20000" if MAX_SATELLITES <= 0 else str(max(MAX_SATELLITES, 1200)),
    )
)
EARTH_RADIUS_KM = 6371.0
RATE_LIMIT_WINDOW_SECONDS = int(os.environ.get("SATELLITECHUM_RATE_LIMIT_WINDOW_SECONDS", "60"))
RATE_LIMITS = {
    "satellites": int(os.environ.get("SATELLITECHUM_RATE_LIMIT_SATELLITES", "120")),
    "country": int(os.environ.get("SATELLITECHUM_RATE_LIMIT_COUNTRY", "120")),
    "location_label": int(os.environ.get("SATELLITECHUM_RATE_LIMIT_LOCATION_LABEL", "120")),
    "search": int(os.environ.get("SATELLITECHUM_RATE_LIMIT_SEARCH", "30")),
    "satellite_lookup": int(os.environ.get("SATELLITECHUM_RATE_LIMIT_SATELLITE_LOOKUP", "30")),
    "countries": int(os.environ.get("SATELLITECHUM_RATE_LIMIT_COUNTRIES", "30")),
    "location_intel": int(os.environ.get("SATELLITECHUM_RATE_LIMIT_LOCATION_INTEL", "20")),
    "satellite_details": int(os.environ.get("SATELLITECHUM_RATE_LIMIT_SATELLITE_DETAILS", "30")),
}

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

_dot_env_values: dict[str, str] = {}


def _load_dotenv_file() -> dict[str, str]:
    env_path = Path(__file__).with_name(".env")
    values: dict[str, str] = {}
    if not env_path.exists():
        return values
    try:
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip("'").strip('"')
            if key:
                values[key] = value
    except OSError:
        return {}
    return values


_dot_env_values = _load_dotenv_file()


def _env_value(name: str, default: str = "") -> str:
    value = os.environ.get(name)
    if value is not None:
        return value
    return _dot_env_values.get(name, default)


def _env_flag(name: str, default: bool = False) -> bool:
    value = _env_value(name, "")
    if not value:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _is_production() -> bool:
    return (
        _env_value("SATELLITECHUM_ENV", _env_value("FLASK_ENV", "")).strip().lower() == "production"
    )


_secret_key = _env_value("SECRET_KEY", "")
if _is_production() and not _secret_key:
    raise RuntimeError("SECRET_KEY must be set when SATELLITECHUM_ENV=production")
app.secret_key = _secret_key or secrets.token_hex(32)
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=_env_flag("SESSION_COOKIE_SECURE", default=_is_production()),
    TEMPLATES_AUTO_RELOAD=not _is_production(),
    PREFERRED_URL_SCHEME="https" if _is_production() else "http",
)
trusted_hosts = [
    item.strip() for item in _env_value("TRUSTED_HOSTS", "").split(",") if item.strip()
]
if _is_production() and not trusted_hosts:
    raise RuntimeError("TRUSTED_HOSTS must be set when SATELLITECHUM_ENV=production")
if trusted_hosts:
    app.config["TRUSTED_HOSTS"] = trusted_hosts


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _clean_search_query(value: str | None) -> str:
    if not value:
        return ""
    return " ".join(value.strip().split())[:SEARCH_MAX]


def _normalize_match_text(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (value or "").casefold()).strip()


def _match_tokens(value: str | None) -> list[str]:
    return [token for token in _normalize_match_text(value).split() if token]


def _dedupe_text(values: list[str]) -> list[str]:
    seen = set()
    output = []
    for value in values:
        cleaned = (value or "").strip()
        if not cleaned:
            continue
        key = cleaned.casefold()
        if key in seen:
            continue
        seen.add(key)
        output.append(cleaned)
    return output


def _parse_tle_payload(payload: str) -> list[dict]:
    lines = [line.strip() for line in payload.splitlines() if line.strip()]
    satellites = []
    for idx in range(0, len(lines) - 2, 3):
        name, line1, line2 = lines[idx : idx + 3]
        if not line1.startswith("1 ") or not line2.startswith("2 "):
            continue
        satellites.append(
            {
                "name": name,
                "line1": line1,
                "line2": line2,
                "catnr": _extract_catnr_from_tle_line1(line1),
            }
        )
    return satellites


def _extract_catnr_from_tle_line1(line1: str) -> int | None:
    if not line1.startswith("1 "):
        return None
    token = line1[2:7].strip()
    return int(token) if token.isdigit() else None


def _satellite_dedupe_key(item: dict) -> str:
    catnr = item.get("catnr")
    if catnr is not None:
        return f"catnr:{catnr}"
    name = (item.get("name") or "").strip().casefold()
    return f"name:{name}|{item.get('line1', '')}|{item.get('line2', '')}"


def _merge_satellite_sets(groups: list[list[dict]]) -> list[dict]:
    merged = []
    seen = set()
    for items in groups:
        for item in items:
            key = _satellite_dedupe_key(item)
            if key in seen:
                continue
            seen.add(key)
            merged.append(item)
    return merged


def _ensure_fallback_satellites() -> None:
    if _tle_cache["items"]:
        return
    _tle_cache["items"] = _decorate_satellite_items(
        _balanced_satellite_subset(_parse_tle_payload(FALLBACK_TLES), MAX_SATELLITES)
    )
    _tle_cache["source"] = "fallback"
    _tle_cache["source_groups"] = ["fallback"]


def _service_bucket_for_name(name: str) -> str:
    profile = infer_satellite_profile({}, name or "")
    purpose = (profile.get("purpose") or "").casefold()
    operator_type = (profile.get("operator_type") or "").casefold()
    object_type = (profile.get("object_type") or "").casefold()
    if "rocket body" in purpose or "debris" in purpose or object_type in {"r/b", "deb"}:
        return "debris"
    if "crewed space station" in purpose or "human" in purpose:
        return "human-spaceflight"
    if "reconnaissance" in purpose or "surveillance" in purpose or "military" in operator_type:
        return "military"
    if "communications" in purpose or "broadcast" in purpose or "tv" in purpose:
        return "comms"
    if "navigation" in purpose or "position" in purpose:
        return "navigation"
    if "weather" in purpose:
        return "weather"
    if "earth observation" in purpose:
        return "earth-observation"
    if "science" in purpose or "observatory" in purpose or "technology" in purpose:
        return "science"
    return "other"


def _balanced_satellite_subset(items: list[dict], limit: int) -> list[dict]:
    if limit <= 0 or len(items) <= limit:
        return items

    bucket_order = [
        "comms",
        "navigation",
        "weather",
        "earth-observation",
        "military",
        "human-spaceflight",
        "science",
        "debris",
        "other",
    ]
    buckets = {key: [] for key in bucket_order}
    for item in items:
        buckets[_service_bucket_for_name(item.get("name", ""))].append(item)

    selected = []
    while len(selected) < limit:
        progressed = False
        for key in bucket_order:
            bucket = buckets[key]
            if not bucket:
                continue
            selected.append(bucket.pop(0))
            progressed = True
            if len(selected) >= limit:
                break
        if not progressed:
            break
    return selected


def _fetch_live_satellites() -> tuple[list[dict], list[str]]:
    groups = []
    source_groups = []
    try:
        for group_name, url in CELESTRAK_GROUP_URLS:
            response = requests.get(
                url,
                headers={"User-Agent": USER_AGENT},
                timeout=TLE_REQUEST_TIMEOUT,
            )
            response.raise_for_status()
            items = _parse_tle_payload(response.text)
            if items:
                groups.append(items)
                source_groups.append(group_name)
        merged = _merge_satellite_sets(groups)
        if merged:
            return _balanced_satellite_subset(merged, MAX_SATELLITES), source_groups
    except requests.RequestException:
        pass

    response = requests.get(
        SATNOGS_TLE_URL,
        params={"page_size": SATNOGS_PAGE_SIZE},
        headers={"User-Agent": USER_AGENT},
        timeout=TLE_REQUEST_TIMEOUT,
    )
    response.raise_for_status()
    payload = response.json()
    items = []
    for row in payload:
        line1 = (row.get("tle1") or "").strip()
        line2 = (row.get("tle2") or "").strip()
        if not line1.startswith("1 ") or not line2.startswith("2 "):
            continue
        name = (row.get("tle0") or row.get("name") or "").strip()
        if name.startswith("0 "):
            name = name[2:].strip()
        items.append(
            {
                "name": name or f"NORAD {row.get('norad_cat_id', 'Unknown')}",
                "line1": line1,
                "line2": line2,
                "catnr": row.get("norad_cat_id") or _extract_catnr_from_tle_line1(line1),
            }
        )
    merged = _merge_satellite_sets([items])
    return _balanced_satellite_subset(merged, MAX_SATELLITES), ["satnogs-tle"]


def _refresh_satellites_worker() -> None:
    try:
        satellites, source_groups = _fetch_live_satellites()
        if satellites:
            _tle_cache["items"] = _decorate_satellite_items(satellites)
            _tle_cache["fetched_at"] = time.time()
            _tle_cache["source"] = "live"
            _tle_cache["source_groups"] = source_groups
            _tle_cache["last_error"] = ""
        else:
            _ensure_fallback_satellites()
            _tle_cache["last_error"] = "No live TLE groups returned usable satellites."
    except requests.RequestException as exc:
        _ensure_fallback_satellites()
        _tle_cache["last_error"] = str(exc)
    finally:
        _tle_cache["refreshing"] = False


def _start_satellite_refresh() -> None:
    with _tle_refresh_lock:
        if _tle_cache["refreshing"]:
            return
        _tle_cache["refreshing"] = True
        _tle_cache["last_attempt_at"] = time.time()
        worker = threading.Thread(target=_refresh_satellites_worker, daemon=True)
        worker.start()


def _parse_finite_lat_lon() -> tuple[float | None, float | None]:
    lat = request.args.get("lat", type=float)
    lon = request.args.get("lon", type=float)
    if lat is None or lon is None or not math.isfinite(lat) or not math.isfinite(lon):
        return None, None
    return lat, lon


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


@lru_cache(maxsize=2048)
def reverse_geocode_place(lat_round: float, lon_round: float) -> dict:
    bigdatacloud = reverse_geocode_place_bigdatacloud(lat_round, lon_round)
    if bigdatacloud:
        return bigdatacloud
    zoom_levels = [12, 10, 8, 6, 4]
    for zoom in zoom_levels:
        try:
            response = requests.get(
                "https://nominatim.openstreetmap.org/reverse",
                params={
                    "lat": lat_round,
                    "lon": lon_round,
                    "format": "jsonv2",
                    "zoom": zoom,
                    "addressdetails": 1,
                    "namedetails": 1,
                    "accept-language": "en",
                },
                headers={"User-Agent": USER_AGENT},
                timeout=REQUEST_TIMEOUT,
            )
            response.raise_for_status()
            payload = response.json()
            address = payload.get("address", {})
            name = (
                address.get("city")
                or address.get("town")
                or address.get("village")
                or address.get("municipality")
                or address.get("county")
                or address.get("state_district")
                or address.get("state")
                or address.get("country")
                or ""
            )
            country = address.get("country", "")
            region = (
                address.get("state")
                or address.get("territory")
                or address.get("province")
                or address.get("state_district")
                or address.get("county")
                or ""
            )
            if name or country:
                display_parts = _dedupe_text([name, region, country])
                return {
                    "name": name or country or "Ground track",
                    "country": country or name or "Unknown",
                    "country_code": (address.get("country_code") or "").upper(),
                    "region": region,
                    "display_name": ", ".join(display_parts),
                }
        except requests.RequestException:
            continue
    country_fallback = reverse_geocode_country(lat_round, lon_round)
    if country_fallback.get("country"):
        return {
            "name": country_fallback["country"],
            "country": country_fallback["country"],
            "country_code": country_fallback.get("country_code", ""),
            "region": "",
            "display_name": country_fallback["country"],
        }
    return {
        "name": "Ground track",
        "country": "Unknown",
        "country_code": "",
        "region": "",
        "display_name": "",
    }


_tle_cache = {
    "fetched_at": 0.0,
    "items": [],
    "source": "empty",
    "source_groups": [],
    "refreshing": False,
    "last_error": "",
    "last_attempt_at": 0.0,
}
_tle_refresh_lock = threading.Lock()
_satcat_cache: dict[int, dict] = {}
_space_track_cache: dict[int, dict] = {}
_satnogs_cache: dict[int, dict] = {}
_countries_cache = {"fetched_at": 0.0, "items": []}
_country_shapes_cache = {"fetched_at": 0.0, "items": []}
_rate_limit_state: dict[tuple[str, str], dict[str, float | int]] = {}
_rate_limit_lock = threading.Lock()
_redis_client = None


def _init_redis() -> None:
    global _redis_client
    if not _REDIS_AVAILABLE:
        return
    url = _env_value("REDIS_URL", "")
    if not url:
        return
    try:
        client = _redis_module.Redis.from_url(url, socket_connect_timeout=2)
        client.ping()
        _redis_client = client
    except Exception as exc:  # noqa: BLE001
        app.logger.warning("Redis unavailable, using in-memory rate limiting: %s", exc)


_init_redis()

OWNER_CODE_MAP = {
    "US": "United States",
    "USA": "United States",
    "PRC": "China",
    "CIS": "Commonwealth of Independent States",
    "ESA": "European Space Agency",
    "JPN": "Japan",
    "IND": "India",
    "ARGN": "Argentina",
    "FR": "France",
    "UK": "United Kingdom",
}

SATNOGS_COUNTRY_MAP = {
    "US": "United States",
    "RU": "Russia",
    "UK": "United Kingdom",
    "GB": "United Kingdom",
    "CN": "China",
    "PRC": "China",
    "JP": "Japan",
    "IN": "India",
    "ID": "Indonesia",
    "FR": "France",
    "DE": "Germany",
    "IT": "Italy",
    "CA": "Canada",
    "AU": "Australia",
    "ES": "Spain",
    "AR": "Argentina",
    "BR": "Brazil",
    "IL": "Israel",
    "KR": "South Korea",
    "UA": "Ukraine",
    "IR": "Iran",
}


def _format_population(value: int | float | None) -> str:
    if not value:
        return ""
    number = float(value)
    if number >= 1_000_000_000:
        return f"{number / 1_000_000_000:.2f}B"
    if number >= 1_000_000:
        return f"{number / 1_000_000:.1f}M"
    if number >= 1_000:
        return f"{number / 1_000:.1f}K"
    return str(int(number))


def _client_ip() -> str:
    if _is_production():
        forwarded_ip = request.headers.get("CF-Connecting-IP", "").strip()
        if forwarded_ip:
            return forwarded_ip
    return (request.remote_addr or "unknown").strip() or "unknown"


def _prune_rate_limit_state(now: float) -> None:
    stale_keys = [
        key
        for key, state in _rate_limit_state.items()
        if now - float(state["window_start"]) >= RATE_LIMIT_WINDOW_SECONDS
    ]
    for key in stale_keys:
        _rate_limit_state.pop(key, None)


_RATE_LIMIT_LUA = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then
    redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
    redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
    ttl = tonumber(ARGV[1])
end
return {count, ttl}
"""


def _rate_limit_status_memory(endpoint: str, limit: int) -> tuple[int, int, int] | None:
    now = time.time()
    client_key = (endpoint, _client_ip())
    with _rate_limit_lock:
        if len(_rate_limit_state) > 4096:
            _prune_rate_limit_state(now)
        state = _rate_limit_state.get(client_key)
        if not state or now - float(state["window_start"]) >= RATE_LIMIT_WINDOW_SECONDS:
            state = {"window_start": now, "count": 0}
            _rate_limit_state[client_key] = state
        if int(state["count"]) >= limit:
            retry_after = max(
                1, math.ceil(RATE_LIMIT_WINDOW_SECONDS - (now - float(state["window_start"])))
            )
            return retry_after, limit, RATE_LIMIT_WINDOW_SECONDS
        state["count"] = int(state["count"]) + 1
    return None


def _rate_limit_status_redis(endpoint: str, limit: int) -> tuple[int, int, int] | None:
    key = f"rl:{endpoint}:{_client_ip()}"
    try:
        result = _redis_client.eval(_RATE_LIMIT_LUA, 1, key, RATE_LIMIT_WINDOW_SECONDS)  # type: ignore[union-attr]
        count, ttl = int(result[0]), int(result[1])
        if count > limit:
            return max(1, ttl), limit, RATE_LIMIT_WINDOW_SECONDS
        return None
    except Exception as exc:  # noqa: BLE001
        app.logger.warning("Redis rate limit error, falling back to memory: %s", exc)
        return _rate_limit_status_memory(endpoint, limit)


def _rate_limit_status(endpoint: str) -> tuple[int, int, int] | None:
    limit = RATE_LIMITS.get(endpoint, 0)
    if limit <= 0:
        return None
    if _redis_client is not None:
        return _rate_limit_status_redis(endpoint, limit)
    return _rate_limit_status_memory(endpoint, limit)


def _distance_km(lat_a: float, lon_a: float, lat_b: float, lon_b: float) -> float:
    lat1 = math.radians(lat_a)
    lon1 = math.radians(lon_a)
    lat2 = math.radians(lat_b)
    lon2 = math.radians(lon_b)
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


@lru_cache(maxsize=512)
def load_world_bank_population(country_code2: str) -> dict:
    if not country_code2:
        return {}
    try:
        response = requests.get(
            WORLD_BANK_INDICATOR_URL.format(code=quote(country_code2.lower())),
            params={"format": "json", "per_page": 8},
            headers={"User-Agent": USER_AGENT},
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        payload = response.json()
        series = payload[1] if isinstance(payload, list) and len(payload) > 1 else []
        for row in series:
            if row.get("value"):
                return {
                    "population": row["value"],
                    "population_label": _format_population(row["value"]),
                    "population_year": row.get("date", ""),
                }
    except (requests.RequestException, ValueError, TypeError, KeyError, IndexError):
        return {}
    return {}


@lru_cache(maxsize=256)
def load_open_meteo_country_profile(country_name: str) -> dict:
    cleaned = _clean_search_query(country_name)
    if not cleaned:
        return {}
    try:
        response = requests.get(
            OPEN_METEO_SEARCH_URL,
            params={"name": cleaned, "count": 8, "language": "en", "format": "json"},
            headers={"User-Agent": USER_AGENT},
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        results = response.json().get("results", [])
        if not results:
            return {}
        exact = next(
            (
                row
                for row in results
                if (row.get("name") or "").casefold() == cleaned.casefold()
                and (row.get("feature_code") or "").startswith("PCL")
            ),
            None,
        )
        row = exact or results[0]
        return {
            "name": row.get("name", ""),
            "population": row.get("population"),
            "country_code2": row.get("country_code", ""),
            "source": "Open-Meteo",
        }
    except (requests.RequestException, ValueError, TypeError, KeyError):
        return {}


@lru_cache(maxsize=512)
def load_open_meteo_place_profile(
    name: str, country: str, lat_round: float, lon_round: float
) -> dict:
    cleaned = _clean_search_query(name)
    if not cleaned:
        return {}
    country_norm = _normalize_match_text(country)
    try:
        response = requests.get(
            OPEN_METEO_SEARCH_URL,
            params={"name": cleaned, "count": 10, "language": "en", "format": "json"},
            headers={"User-Agent": USER_AGENT},
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        results = response.json().get("results", [])
    except (requests.RequestException, ValueError, TypeError, KeyError):
        return {}

    best = None
    for row in results:
        row_name = row.get("name", "")
        row_country = row.get("country", "")
        name_tokens = set(_match_tokens(cleaned))
        row_name_tokens = set(_match_tokens(row_name))
        if name_tokens and not name_tokens.issubset(row_name_tokens):
            continue
        if country_norm and country_norm not in _normalize_match_text(row_country):
            continue
        row_lat = row.get("latitude")
        row_lon = row.get("longitude")
        if row_lat is None or row_lon is None:
            continue
        distance_km = _distance_km(lat_round, lon_round, float(row_lat), float(row_lon))
        if distance_km > 60:
            continue
        candidate = {
            "name": row_name,
            "country": row_country,
            "population": row.get("population"),
            "population_label": _format_population(row.get("population")),
            "feature_code": row.get("feature_code", ""),
            "distance_km": round(distance_km, 1),
            "source": "Open-Meteo",
        }
        if not best or candidate["distance_km"] < best["distance_km"]:
            best = candidate
    return best or {}


@lru_cache(maxsize=256)
def load_wikidata_country_facts(country_name: str) -> dict:
    cleaned = _clean_search_query(country_name)
    if not cleaned:
        return {}
    try:
        response = requests.get(
            WIKIDATA_API_URL,
            params={
                "action": "wbsearchentities",
                "search": cleaned,
                "language": "en",
                "format": "json",
                "type": "item",
                "limit": 5,
            },
            headers={"User-Agent": USER_AGENT},
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        hits = response.json().get("search", [])
        entity_id = ""
        for hit in hits:
            label = (hit.get("label") or "").casefold()
            description = (hit.get("description") or "").casefold()
            if label == cleaned.casefold() and "country" in description:
                entity_id = hit.get("id", "")
                break
        if not entity_id and hits:
            entity_id = hits[0].get("id", "")
        if not entity_id:
            return {}

        entity_response = requests.get(
            WIKIDATA_API_URL,
            params={
                "action": "wbgetentities",
                "ids": entity_id,
                "languages": "en",
                "props": "claims",
                "format": "json",
            },
            headers={"User-Agent": USER_AGENT},
            timeout=REQUEST_TIMEOUT,
        )
        entity_response.raise_for_status()
        entity = (entity_response.json().get("entities") or {}).get(entity_id, {})
        claims = entity.get("claims") or {}
        government_ids = []
        for claim in claims.get("P122", []):
            datavalue = ((claim.get("mainsnak") or {}).get("datavalue") or {}).get("value") or {}
            if datavalue.get("id"):
                government_ids.append(datavalue["id"])
        government_ids = government_ids[:3]
        if not government_ids:
            return {}

        labels_response = requests.get(
            WIKIDATA_API_URL,
            params={
                "action": "wbgetentities",
                "ids": "|".join(government_ids),
                "languages": "en",
                "props": "labels",
                "format": "json",
            },
            headers={"User-Agent": USER_AGENT},
            timeout=REQUEST_TIMEOUT,
        )
        labels_response.raise_for_status()
        labels_payload = labels_response.json().get("entities") or {}
        government_types = [
            ((labels_payload.get(item_id) or {}).get("labels") or {}).get("en", {}).get("value", "")
            for item_id in government_ids
        ]
        government_types = _dedupe_text(government_types)
        return {
            "government_type": ", ".join(government_types),
            "source": "Wikidata",
        }
    except (requests.RequestException, ValueError, TypeError, KeyError):
        return {}


@lru_cache(maxsize=256)
def load_country_intel(country_name: str) -> dict:
    if not country_name:
        return {}
    params_list = [
        {"fullText": "true"},
        {},
    ]
    payload = []
    try:
        for params in params_list:
            response = requests.get(
                f"https://restcountries.com/v3.1/name/{quote(country_name)}",
                params=params,
                headers={"User-Agent": USER_AGENT},
                timeout=REQUEST_TIMEOUT,
            )
            if response.ok:
                payload = response.json()
                if payload:
                    break
        item = payload[0] if payload else {}
        currencies = item.get("currencies") or {}
        currency_names = [
            details.get("name") for details in currencies.values() if details.get("name")
        ]
        languages = list((item.get("languages") or {}).values())
        capitals = item.get("capital") or []
        world_bank = load_world_bank_population(item.get("cca2", ""))
        open_meteo = load_open_meteo_country_profile(country_name)
        wikidata = load_wikidata_country_facts(country_name)
        population = (
            world_bank.get("population") or item.get("population") or open_meteo.get("population")
        )
        population_label = (
            world_bank.get("population_label")
            or _format_population(item.get("population"))
            or _format_population(open_meteo.get("population"))
            or ""
        )
        sources = _dedupe_text(
            [
                "REST Countries" if item else "",
                "World Bank" if world_bank else "",
                open_meteo.get("source", ""),
                wikidata.get("source", ""),
            ]
        )
        return {
            "official_name": item.get("name", {}).get("official", ""),
            "population": population,
            "population_label": population_label,
            "population_year": world_bank.get("population_year", ""),
            "capital": ", ".join(capitals),
            "region": item.get("region", ""),
            "subregion": item.get("subregion", ""),
            "area_km2": item.get("area"),
            "languages": languages,
            "currencies": currency_names,
            "timezones": item.get("timezones") or [],
            "demonym": ((item.get("demonyms") or {}).get("eng") or {}).get("m", ""),
            "independent": item.get("independent"),
            "un_member": item.get("unMember"),
            "country_code2": item.get("cca2", ""),
            "flag": (item.get("flags") or {}).get("svg")
            or (item.get("flags") or {}).get("png")
            or "",
            "government_type": wikidata.get("government_type", ""),
            "sources": sources,
        }
    except (requests.RequestException, ValueError, TypeError, KeyError):
        return {}


@lru_cache(maxsize=2048)
def reverse_geocode_place_bigdatacloud(lat_round: float, lon_round: float) -> dict:
    try:
        response = requests.get(
            BIGDATACLOUD_REVERSE_URL,
            params={
                "latitude": lat_round,
                "longitude": lon_round,
                "localityLanguage": "en",
            },
            headers={"User-Agent": USER_AGENT},
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        payload = response.json()
        name = (
            payload.get("locality")
            or payload.get("city")
            or payload.get("principalSubdivision")
            or payload.get("countryName")
            or ""
        )
        country = payload.get("countryName", "")
        region = payload.get("principalSubdivision", "")
        country_code = payload.get("countryCode", "")
        display_parts = _dedupe_text([name, region, country])
        if name or country:
            return {
                "name": name or country or "Ground track",
                "country": country or name or "Unknown",
                "country_code": country_code,
                "region": region,
                "display_name": ", ".join(display_parts),
            }
    except (requests.RequestException, ValueError, TypeError, KeyError):
        return {}
    return {}


def synthesize_location_summary(name: str, country: str, country_intel: dict) -> str:
    parts = []
    if name:
        parts.append(f"{name} is in {country or 'its country/region'}")
    if country_intel.get("region"):
        region_bits = [country_intel.get("region"), country_intel.get("subregion")]
        parts[-1] = f"{parts[-1]}, in {' / '.join(bit for bit in region_bits if bit)}"
    if country_intel.get("capital"):
        parts.append(f"The capital is {country_intel['capital']}")
    if country_intel.get("population_label"):
        parts.append(f"population {country_intel['population_label']}")
    languages = ", ".join((country_intel.get("languages") or [])[:3])
    if languages:
        parts.append(f"main languages: {languages}")
    currencies = ", ".join((country_intel.get("currencies") or [])[:2])
    if currencies:
        parts.append(f"currency: {currencies}")
    status_bits = []
    if country_intel.get("independent"):
        status_bits.append("independent")
    if country_intel.get("un_member"):
        status_bits.append("UN member")
    if status_bits:
        parts.append(", ".join(status_bits))
    if not parts:
        return ""
    sentence = ". ".join(part.rstrip(".") for part in parts if part)
    return sentence + "."


@lru_cache(maxsize=512)
def search_wikipedia_titles(query: str, limit: int = 5) -> list[str]:
    cleaned = _clean_search_query(query)
    if not cleaned:
        return []
    try:
        response = requests.get(
            "https://en.wikipedia.org/w/api.php",
            params={
                "action": "query",
                "list": "search",
                "srsearch": cleaned,
                "format": "json",
                "utf8": "1",
                "srlimit": max(1, min(limit, 10)),
            },
            headers={"User-Agent": USER_AGENT},
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        hits = response.json().get("query", {}).get("search", [])
        return [hit.get("title", "") for hit in hits if hit.get("title")]
    except (requests.RequestException, ValueError, TypeError, KeyError):
        return []


@lru_cache(maxsize=512)
def load_wikipedia_summary_by_title(title: str) -> dict:
    if not title:
        return {}
    try:
        response = requests.get(
            f"https://en.wikipedia.org/api/rest_v1/page/summary/{quote(title)}",
            headers={"User-Agent": USER_AGENT},
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        payload = response.json()
        return {
            "title": payload.get("title", title),
            "summary": payload.get("extract", ""),
            "description": payload.get("description", ""),
            "image": ((payload.get("thumbnail") or {}).get("source") or ""),
            "content_url": ((payload.get("content_urls") or {}).get("desktop") or {}).get("page")
            or "",
        }
    except (requests.RequestException, ValueError, TypeError, KeyError):
        return {}


def load_wikipedia_summary(query: str) -> dict:
    titles = search_wikipedia_titles(query, limit=1)
    return load_wikipedia_summary_by_title(titles[0]) if titles else {}


def _place_title_matches(name: str, country: str, title: str) -> bool:
    name_tokens = set(_match_tokens(name))
    title_tokens = set(_match_tokens(title))
    if not name_tokens or not title_tokens:
        return False
    return name_tokens.issubset(title_tokens)


def _satellite_reference_looks_reliable(query: str, summary: dict) -> bool:
    query_norm = _normalize_match_text(query)
    title_norm = _normalize_match_text(summary.get("title", ""))
    if not query_norm or not title_norm:
        return False
    compact_query = query_norm.replace(" ", "")
    compact_title = title_norm.replace(" ", "")
    if compact_query and (
        compact_query == compact_title
        or compact_query in compact_title
        or compact_title in compact_query
    ):
        return True
    query_tokens = set(_match_tokens(query))
    title_tokens = set(_match_tokens(summary.get("title", "")))
    if query_tokens and query_tokens.issubset(title_tokens):
        desc_blob = " ".join(
            [summary.get("title", ""), summary.get("description", ""), summary.get("summary", "")]
        ).casefold()
        return any(
            token in desc_blob
            for token in [
                "satellite",
                "spacecraft",
                "space station",
                "orbital",
                "orbit",
                "telescope",
                "observatory",
                "rocket",
                "debris",
            ]
        )
    return False


def load_place_reference(name: str, country: str, lat: float, lon: float) -> dict:
    try:
        response = requests.get(
            "https://en.wikipedia.org/w/api.php",
            params={
                "action": "query",
                "list": "geosearch",
                "gscoord": f"{round(lat, 4)}|{round(lon, 4)}",
                "gsradius": 20000,
                "gslimit": 8,
                "format": "json",
            },
            headers={"User-Agent": USER_AGENT},
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        for hit in response.json().get("query", {}).get("geosearch", []):
            title = hit.get("title", "")
            if not _place_title_matches(name, country, title):
                continue
            summary = load_wikipedia_summary_by_title(title)
            if summary:
                return summary
    except (requests.RequestException, ValueError, TypeError, KeyError):
        pass

    for variant in [f"{name}, {country}" if country else name, name]:
        for title in search_wikipedia_titles(variant, limit=5):
            if not _place_title_matches(name, country, title):
                continue
            summary = load_wikipedia_summary_by_title(title)
            if summary:
                return summary
    return {}


@lru_cache(maxsize=512)
def load_nearby_landmarks(lat_round: float, lon_round: float) -> list[dict]:
    try:
        response = requests.get(
            "https://en.wikipedia.org/w/api.php",
            params={
                "action": "query",
                "list": "geosearch",
                "gscoord": f"{lat_round}|{lon_round}",
                "gsradius": 10000,
                "gslimit": 6,
                "format": "json",
            },
            headers={"User-Agent": USER_AGENT},
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        items = []
        for row in response.json().get("query", {}).get("geosearch", []):
            items.append(
                {
                    "title": row.get("title", "Unknown"),
                    "distance_m": row.get("dist"),
                    "pageid": row.get("pageid"),
                }
            )
        return items
    except (requests.RequestException, ValueError, TypeError, KeyError):
        return []


def build_location_intel(name: str, country: str, lat: float, lon: float) -> dict:
    wiki = load_place_reference(name, country, lat, lon)
    country_intel = load_country_intel(country)
    place_intel = load_open_meteo_place_profile(name, country, round(lat, 3), round(lon, 3))
    landmarks = load_nearby_landmarks(round(lat, 2), round(lon, 2))
    return {
        "name": name,
        "country": country,
        "lat": lat,
        "lon": lon,
        "summary": wiki.get("summary", "")
        or synthesize_location_summary(name, country, country_intel),
        "description": wiki.get("description", ""),
        "image": wiki.get("image", ""),
        "content_url": wiki.get("content_url", ""),
        "place_intel": place_intel,
        "country_intel": country_intel,
        "landmarks": landmarks,
        "sources": _dedupe_text(
            [
                "Wikipedia" if wiki else "",
                "Wikipedia Geosearch" if landmarks else "",
                place_intel.get("source", ""),
                *(country_intel.get("sources") or []),
            ]
        ),
    }


def load_satellites() -> list[dict]:
    now = time.time()
    if (
        _tle_cache["items"]
        and _tle_cache["source"] == "live"
        and now - _tle_cache["fetched_at"] < TLE_CACHE_TTL
    ):
        return _tle_cache["items"]

    _ensure_fallback_satellites()
    _start_satellite_refresh()
    return _tle_cache["items"]


def load_satellite_by_catnr(catnr: int) -> dict:
    if catnr <= 0:
        return {}

    for item in load_satellites():
        if item.get("catnr") == catnr:
            return item

    try:
        response = requests.get(
            "https://celestrak.org/NORAD/elements/gp.php",
            params={"CATNR": catnr, "FORMAT": "tle"},
            headers={"User-Agent": USER_AGENT},
            timeout=TLE_REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        items = _parse_tle_payload(response.text)
        for item in items:
            if item.get("catnr") == catnr:
                return _decorate_satellite_item(item)
        if items:
            return _decorate_satellite_item(items[0])
    except (requests.RequestException, ValueError, TypeError):
        return {}

    return {}


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
        ttl = SATCAT_CACHE_TTL if cached["details"] else SATCAT_FAILURE_TTL
        if time.time() - cached["fetched_at"] < ttl:
            return cached["details"]
    try:
        response = requests.get(
            CELESTRAK_SATCAT_URL,
            params={"CATNR": catnr, "FORMAT": "json"},
            headers={"User-Agent": USER_AGENT},
            timeout=SATCAT_REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        payload = response.json()
        details = payload[0] if payload else {}
    except (requests.RequestException, ValueError, TypeError):
        details = {}
    _satcat_cache[catnr] = {"details": details, "fetched_at": time.time()}
    return details


def _space_track_credentials() -> tuple[str, str]:
    username = (
        os.environ.get("SPACE_TRACK_IDENTITY")
        or os.environ.get("SPACE_TRACK_USERNAME")
        or os.environ.get("ST_USER")
        or _dot_env_values.get("SPACE_TRACK_IDENTITY")
        or _dot_env_values.get("SPACE_TRACK_USERNAME")
        or _dot_env_values.get("ST_USER")
        or _dot_env_values.get("st-user")
        or ""
    ).strip()
    password = (
        os.environ.get("SPACE_TRACK_PASSWORD")
        or os.environ.get("ST_PASS")
        or os.environ.get("SPACETRACK_PASSWORD")
        or _dot_env_values.get("SPACE_TRACK_PASSWORD")
        or _dot_env_values.get("ST_PASS")
        or _dot_env_values.get("SPACETRACK_PASSWORD")
        or _dot_env_values.get("st-pass")
        or ""
    ).strip()
    return username, password


def load_space_track_satcat_details(catnr: int) -> dict:
    cached = _space_track_cache.get(catnr)
    if cached:
        ttl = SATCAT_CACHE_TTL if cached["details"] else SATCAT_FAILURE_TTL
        if time.time() - cached["fetched_at"] < ttl:
            return cached["details"]

    username, password = _space_track_credentials()
    if not username or not password:
        _space_track_cache[catnr] = {"details": {}, "fetched_at": time.time()}
        return {}

    details = {}
    try:
        session = requests.Session()
        login_response = session.post(
            SPACE_TRACK_LOGIN_URL,
            data={"identity": username, "password": password},
            headers={"User-Agent": USER_AGENT},
            timeout=SATCAT_REQUEST_TIMEOUT,
        )
        login_response.raise_for_status()
        response = session.get(
            SPACE_TRACK_SATCAT_QUERY_URL.format(catnr=catnr),
            headers={"User-Agent": USER_AGENT},
            timeout=SATCAT_REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        payload = response.json()
        details = payload[0] if payload else {}
    except (requests.RequestException, ValueError, TypeError, IndexError):
        details = {}

    _space_track_cache[catnr] = {"details": details, "fetched_at": time.time()}
    return details


def load_satnogs_satellite(catnr: int) -> dict:
    cached = _satnogs_cache.get(catnr)
    if cached and time.time() - cached["fetched_at"] < SATCAT_CACHE_TTL:
        return cached["details"]
    try:
        response = requests.get(
            SATNOGS_SATELLITES_URL,
            params={"norad_cat_id": catnr},
            headers={"User-Agent": USER_AGENT},
            timeout=SATCAT_REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        payload = response.json()
        details = payload[0] if payload else {}
    except (requests.RequestException, ValueError, TypeError, IndexError):
        details = {}
    _satnogs_cache[catnr] = {"details": details, "fetched_at": time.time()}
    return details


def _catalog_owner_label(details: dict) -> str:
    if details.get("OWNER_DESC"):
        return details["OWNER_DESC"]
    owner_code = (details.get("OWNER") or "").upper()
    return OWNER_CODE_MAP.get(owner_code, "")


def _country_labels_from_codes(value: str) -> list[str]:
    output = []
    for raw_code in (value or "").split(","):
        code = raw_code.strip().upper()
        if not code:
            continue
        output.append(SATNOGS_COUNTRY_MAP.get(code, code))
    return _dedupe_text(output)


def _clean_satellite_aliases(value: str) -> list[str]:
    aliases = []
    for piece in re.split(r"[,/]", value or ""):
        cleaned = piece.strip()
        if cleaned:
            aliases.append(cleaned)
    return _dedupe_text(aliases)


def _compact_iso_date(value: str) -> str:
    return (value or "").split("T", 1)[0]


def _satellite_query_variants(fallback_name: str, satnogs_details: dict) -> list[str]:
    variants = []
    base_names = [
        *(_clean_satellite_aliases(satnogs_details.get("names", ""))),
        satnogs_details.get("name", ""),
        fallback_name,
    ]
    for name in base_names:
        cleaned = (name or "").strip()
        if not cleaned:
            continue
        variants.extend(
            part.strip() for part in re.findall(r"\(([^)]+)\)", cleaned) if part.strip()
        )
        variants.append(cleaned)
        variants.append(re.sub(r"\([^)]*\)", "", cleaned).strip())
    return _dedupe_text(variants)


def load_satellite_reference(fallback_name: str, satnogs_details: dict) -> dict:
    for query in _satellite_query_variants(fallback_name, satnogs_details):
        for title in search_wikipedia_titles(query, limit=5):
            summary = load_wikipedia_summary_by_title(title)
            if summary and _satellite_reference_looks_reliable(query, summary):
                return summary
    return {}


def _satellite_field_sources(
    details: dict,
    satnogs: dict,
    reference: dict,
    profile: dict,
    owner_label: str,
    operator_type: str,
) -> dict:
    sources = {}
    catalog_source = profile.get("catalog_source") or "CelesTrak SATCAT"
    sources["identity"] = (
        catalog_source
        if details.get("OBJECT_NAME") or details.get("OBJECT_ID")
        else "SatNOGS DB"
        if satnogs.get("name")
        else "TLE name"
    )
    sources["classification"] = profile.get("classification_source") or "Unknown"
    sources["owner"] = (
        catalog_source
        if details.get("OWNER") or details.get("OWNER_DESC")
        else "SatNOGS DB"
        if satnogs.get("countries") and owner_label
        else "Name heuristic"
        if owner_label
        else "Unknown"
    )
    sources["operator_type"] = (
        catalog_source
        if details.get("OWNER") or details.get("OWNER_DESC")
        else "SatNOGS DB"
        if satnogs.get("website") and operator_type != "Unspecified"
        else "Name heuristic"
        if operator_type and operator_type != "Unspecified"
        else "Unknown"
    )
    sources["orbit"] = (
        catalog_source
        if any(
            details.get(key)
            for key in ["ORBIT_TYPE", "PERIOD", "INCLINATION", "APOGEE", "PERIGEE", "RCS"]
        )
        else "Derived from TLE"
    )
    sources["dates"] = (
        catalog_source
        if details.get("LAUNCH_DATE")
        else "SatNOGS DB"
        if satnogs.get("launched") or satnogs.get("deployed")
        else "Unknown"
    )
    sources["summary"] = (
        "Wikipedia" if reference else "SatNOGS DB" if satnogs.get("website") else "None"
    )
    return sources


def _satellite_confidence(field_sources: dict) -> dict:
    def rank(source: str) -> str:
        if source in {"CelesTrak SATCAT", "Space-Track SATCAT"}:
            return "high"
        if source in {"SatNOGS DB", "Derived from TLE"}:
            return "medium"
        if source in {"Wikipedia", "Name heuristic", "TLE name"}:
            return "low"
        return "unknown"

    fields = {key: rank(value) for key, value in field_sources.items()}
    if any(value == "high" for value in fields.values()):
        overall = "high"
    elif any(value == "medium" for value in fields.values()):
        overall = "medium"
    elif any(value == "low" for value in fields.values()):
        overall = "low"
    else:
        overall = "unknown"
    return {"overall": overall, "fields": fields}


def _decorate_satellite_item(item: dict) -> dict:
    profile = infer_satellite_profile({}, item.get("name", ""))
    return {
        **item,
        "object_name": item.get("name", ""),
        "purpose": profile["purpose"],
        "owner_label": profile["owner_label"],
        "operator_type": profile["operator_type"],
        "object_type": profile["object_type"],
        "classification_source": profile["classification_source"],
    }


def _decorate_satellite_items(items: list[dict]) -> list[dict]:
    return [_decorate_satellite_item(item) for item in items]


def _normalized_object_type(details: dict, fallback_name: str) -> str:
    object_type = (details.get("OBJECT_TYPE") or "").upper()
    name = (details.get("OBJECT_NAME") or fallback_name or "").upper()
    if object_type:
        return object_type
    if "R/B" in name:
        return "R/B"
    if "DEB" in name:
        return "DEB"
    if name:
        return "PAY"
    return ""


def infer_satellite_profile(details: dict, fallback_name: str) -> dict:
    name = (details.get("OBJECT_NAME") or fallback_name or "").strip()
    name_upper = name.upper()
    object_type = _normalized_object_type(details, fallback_name)
    owner_label = _catalog_owner_label(details)
    operator_type = ""
    purpose = ""
    source = "CelesTrak satcat" if details else "Name heuristic (satcat unavailable)"

    if object_type == "R/B":
        purpose = "Rocket body"
        if "ARIANE" in name_upper:
            owner_label = owner_label or "Arianespace / Europe"
            operator_type = "Commercial launch program"
        elif any(token in name_upper for token in ["ATLAS", "DELTA"]):
            owner_label = owner_label or "United States launch program"
            operator_type = "Government launch program"
        elif any(token in name_upper for token in ["SL-", "COSMOS", "INTERCOSMOS"]):
            owner_label = owner_label or "Soviet / Russian launch program"
            operator_type = "Government launch program"
        elif any(token in name_upper for token in ["CZ-", "LONG MARCH"]):
            owner_label = owner_label or "Chinese launch program"
            operator_type = "Government launch program"
        elif any(token in name_upper for token in ["H-2", "H-II"]):
            owner_label = owner_label or "Japanese launch program"
            operator_type = "Government launch program"
        elif "GSLV" in name_upper:
            owner_label = owner_label or "Indian launch program"
            operator_type = "Government launch program"
        purpose = "Rocket body"
    elif object_type == "DEB":
        purpose = "Orbital debris"
        operator_type = operator_type or "Unspecified"
    elif any(token in name_upper for token in ["ATLAS CENTAUR", "THOR AGENA"]):
        purpose = "Rocket body"
        owner_label = owner_label or "United States launch program"
        operator_type = operator_type or "Government launch program"

    if not purpose:
        if "ISS" in name_upper:
            purpose = "Crewed space station"
            owner_label = owner_label or "International partnership"
            operator_type = "Multinational / civil"
        elif "CSS" in name_upper or "TIANHE" in name_upper:
            purpose = "Crewed space station"
            owner_label = owner_label or "China Manned Space Program"
            operator_type = "Government / civil"
        elif any(
            token in name_upper for token in ["HST", "HUBBLE", "OAO", "ASTRO-H", "HXMT", "KORONAS"]
        ):
            purpose = "Science observatory"
            if any(token in name_upper for token in ["ASTRO-H"]):
                owner_label = owner_label or "JAXA / Japan"
            elif "HXMT" in name_upper:
                owner_label = owner_label or "Chinese Academy of Sciences"
            elif "KORONAS" in name_upper:
                owner_label = owner_label or "Russian government"
            else:
                owner_label = owner_label or "NASA / partner agencies"
            operator_type = operator_type or "Government / civil"
        elif any(token in name_upper for token in ["NOAA", "METEOR"]):
            purpose = "Weather observation"
            owner_label = owner_label or (
                "NOAA / United States" if "NOAA" in name_upper else "Russian government"
            )
            operator_type = operator_type or "Government / civil"
        elif any(
            token in name_upper
            for token in [
                "GOES",
                "METEOSAT",
                "HIMAWARI",
                "FENGYUN",
                " FY-",
                "ELEKTRO-L",
                "INSAT",
                "GOMS",
            ]
        ):
            purpose = "Weather observation"
            if "GOES" in name_upper:
                owner_label = owner_label or "NOAA / United States"
            elif "METEOSAT" in name_upper:
                owner_label = owner_label or "EUMETSAT"
            elif "HIMAWARI" in name_upper:
                owner_label = owner_label or "JMA / Japan"
            elif "FENGYUN" in name_upper or " FY-" in name_upper:
                owner_label = owner_label or "Chinese government"
            elif "ELEKTRO-L" in name_upper or "GOMS" in name_upper:
                owner_label = owner_label or "Russian government"
            elif "INSAT" in name_upper:
                owner_label = owner_label or "Indian government"
            operator_type = operator_type or "Government / civil"
        elif any(
            token in name_upper
            for token in [
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
                "AJISAI",
                "MIDORI",
                "GAOFEN",
            ]
        ):
            purpose = "Earth observation"
            if any(token in name_upper for token in ["TERRA", "AQUA", "LANDSAT", "SEASAT"]):
                owner_label = owner_label or "NASA / United States"
            elif any(token in name_upper for token in ["ENVISAT", "ERS-"]):
                owner_label = owner_label or "European Space Agency"
            elif any(token in name_upper for token in ["ALOS", "DAICHI", "AJISAI", "MIDORI"]):
                owner_label = owner_label or "JAXA / Japan"
            elif "SAOCOM" in name_upper:
                owner_label = owner_label or "CONAE / Argentina"
            elif any(token in name_upper for token in ["RESURS", "OKEAN"]):
                owner_label = owner_label or "Russian government"
            elif "ORBVIEW" in name_upper:
                owner_label = owner_label or "Commercial Earth observation operator"
                operator_type = operator_type or "Private / commercial"
            elif "GAOFEN" in name_upper:
                owner_label = owner_label or "Chinese government"
            operator_type = operator_type or "Government / civil"
        elif any(
            token in name_upper
            for token in [
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
            ]
        ):
            purpose = "Earth observation"
            if "SENTINEL" in name_upper:
                owner_label = owner_label or "European Union / ESA"
            elif any(
                token in name_upper
                for token in ["WORLDVIEW", "GEOEYE", "QUICKBIRD", "SKYSAT", "BLACKSKY"]
            ):
                owner_label = owner_label or "Commercial Earth observation operator"
                operator_type = operator_type or "Private / commercial"
            elif "RADARSAT" in name_upper:
                owner_label = owner_label or "Canada"
            elif any(token in name_upper for token in ["PLEIADES", "SPOT "]):
                owner_label = owner_label or "France / Airbus"
            elif "CARTOSAT" in name_upper:
                owner_label = owner_label or "ISRO / India"
            elif "ICEYE" in name_upper:
                owner_label = owner_label or "ICEYE"
                operator_type = operator_type or "Private / commercial"
            elif "KOMPSAT" in name_upper:
                owner_label = owner_label or "South Korea"
            else:
                operator_type = operator_type or "Government / civil"
            operator_type = operator_type or "Government / civil"
        elif any(token in name_upper for token in ["STARLINK", "ONEWEB", "IRIDIUM", "ORBCOMM"]):
            purpose = "Communications satellite"
            if "STARLINK" in name_upper:
                owner_label = owner_label or "SpaceX"
            elif "ONEWEB" in name_upper:
                owner_label = owner_label or "Eutelsat OneWeb"
            elif "IRIDIUM" in name_upper:
                owner_label = owner_label or "Iridium"
            elif "ORBCOMM" in name_upper:
                owner_label = owner_label or "Orbcomm"
            operator_type = operator_type or "Private / commercial"
        elif any(
            token in name_upper
            for token in [
                "INTELSAT",
                "EUTELSAT",
                "ASTRA",
                "GALAXY ",
                "TELSTAR",
                "DIRECTV",
                "ECHOSTAR",
                "SES-",
                "SES ",
                "O3B",
                "INMARSAT",
                "VIASAT",
                "TDRS",
                "TDRSS",
                "TURKSAT",
                "HISPASAT",
                "JCSAT",
                "SKYNET",
                "ANIK",
                "AMC-",
                "AMC ",
                "BADR",
                "NILESAT",
                "YAMAL",
                "EXPRESS-",
                "THAICOM",
                "CHINASAT",
                "APSTAR",
                "ASIASAT",
            ]
        ):
            purpose = "Communications satellite"
            if any(token in name_upper for token in ["INTELSAT", "GALAXY ", "TELSTAR"]):
                owner_label = owner_label or "Intelsat"
            elif any(token in name_upper for token in ["EUTELSAT", "O3B"]):
                owner_label = owner_label or "Eutelsat"
            elif "ASTRA" in name_upper or "SES" in name_upper:
                owner_label = owner_label or "SES"
            elif any(token in name_upper for token in ["DIRECTV", "ECHOSTAR"]):
                owner_label = owner_label or "United States broadcast operator"
            elif "INMARSAT" in name_upper:
                owner_label = owner_label or "Inmarsat"
            elif "VIASAT" in name_upper:
                owner_label = owner_label or "Viasat"
            elif any(token in name_upper for token in ["TDRS", "TDRSS"]):
                owner_label = owner_label or "NASA / United States"
                operator_type = operator_type or "Government / civil"
            elif "SKYNET" in name_upper:
                owner_label = owner_label or "United Kingdom military communications"
                operator_type = operator_type or "Government / military"
            elif "TURKSAT" in name_upper:
                owner_label = owner_label or "Turksat / Turkey"
            elif "HISPASAT" in name_upper:
                owner_label = owner_label or "Hispasat / Spain"
            elif "JCSAT" in name_upper:
                owner_label = owner_label or "SKY Perfect JSAT / Japan"
            elif "ANIK" in name_upper:
                owner_label = owner_label or "Telesat / Canada"
            elif any(
                token in name_upper
                for token in [
                    "BADR",
                    "NILESAT",
                    "YAMAL",
                    "EXPRESS-",
                    "THAICOM",
                    "CHINASAT",
                    "APSTAR",
                    "ASIASAT",
                ]
            ):
                owner_label = owner_label or "Regional communications operator"
            operator_type = operator_type or "Private / commercial"
        elif any(
            token in name_upper
            for token in [
                "GPS",
                "NAVSTAR",
                "GALILEO",
                "GLONASS",
                "BEIDOU",
                "COMPASS",
                "QZS",
                "QZSS",
                "IRNSS",
                "NAVIC",
            ]
        ):
            purpose = "Navigation satellite"
            if any(token in name_upper for token in ["GPS", "NAVSTAR"]):
                owner_label = owner_label or "United States government"
                operator_type = operator_type or "Government / military"
            elif "GALILEO" in name_upper:
                owner_label = owner_label or "European Union"
                operator_type = operator_type or "Government / civil"
            elif "GLONASS" in name_upper:
                owner_label = owner_label or "Russian government"
                operator_type = operator_type or "Government / military"
            elif any(token in name_upper for token in ["BEIDOU", "COMPASS"]):
                owner_label = owner_label or "Chinese government"
                operator_type = operator_type or "Government / military"
            elif any(token in name_upper for token in ["QZS", "QZSS"]):
                owner_label = owner_label or "Japan"
                operator_type = operator_type or "Government / civil"
            elif any(token in name_upper for token in ["IRNSS", "NAVIC"]):
                owner_label = owner_label or "India"
                operator_type = operator_type or "Government / civil"
        elif any(
            token in name_upper
            for token in ["USA ", "NOSS", "ONYX", "LACROSSE", "HELIOS", "YAOGAN"]
        ):
            purpose = "Reconnaissance / surveillance"
            if "USA " in name_upper or "NOSS" in name_upper:
                owner_label = owner_label or "United States government"
            elif "HELIOS" in name_upper:
                owner_label = owner_label or "French military"
            elif "YAOGAN" in name_upper:
                owner_label = owner_label or "Chinese government"
            operator_type = operator_type or "Government / military"
        elif any(token in name_upper for token in ["NROL", "SBIRS", "DSP ", "NAVY", "COSMOS"]):
            purpose = "Reconnaissance / surveillance"
            if any(token in name_upper for token in ["NROL", "SBIRS", "DSP ", "NAVY"]):
                owner_label = owner_label or "United States government"
            elif "COSMOS" in name_upper:
                owner_label = owner_label or "Soviet / Russian government"
            operator_type = operator_type or "Government / military"
        elif "COSMO-SKYMED" in name_upper:
            purpose = "Earth observation"
            owner_label = owner_label or "Italian government"
            operator_type = operator_type or "Government / dual-use"
        elif "COSMOS" in name_upper:
            purpose = "Likely government or military mission"
            owner_label = owner_label or "Soviet / Russian government"
            operator_type = operator_type or "Government / military"
        elif "INTERCOSMOS" in name_upper:
            purpose = "Scientific or technology mission"
            owner_label = owner_label or "Soviet / Russian government"
            operator_type = operator_type or "Government / civil"
        elif "ACS3" in name_upper:
            purpose = "Technology demonstration"
            owner_label = owner_label or "NASA / United States"
            operator_type = operator_type or "Government / civil"

    if object_type == "PAY" and not purpose:
        purpose = "Payload satellite"

    if not purpose:
        purpose = "Cataloged space object"
    if not owner_label and details.get("OWNER"):
        owner_label = OWNER_CODE_MAP.get((details.get("OWNER") or "").upper(), "")
    if not operator_type:
        if owner_label:
            operator_type = "Government / civil"
        else:
            operator_type = "Unspecified"

    return {
        "purpose": purpose,
        "owner_label": owner_label,
        "operator_type": operator_type,
        "object_type": object_type,
        "classification_source": source,
        "catalog_source": (
            "Space-Track SATCAT"
            if details.get("__source") == "space-track"
            else "CelesTrak SATCAT"
            if details
            else "Name heuristic"
        ),
    }


def infer_purpose(details: dict, fallback_name: str) -> str:
    return infer_satellite_profile(details, fallback_name)["purpose"]


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
                    "name": row.get("name")
                    or row.get("display_name", "Unknown place").split(",")[0],
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
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = (
        "geolocation=(self), microphone=(), camera=(), clipboard-write=(self)"
    )
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
    response.headers["X-XSS-Protection"] = "0"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "img-src 'self' data: https:; "
        "style-src 'self'; "
        "font-src 'self'; "
        "script-src 'self'; "
        "connect-src 'self'; "
        "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
    )
    return response


@app.before_request
def enforce_rate_limits():
    limited = _rate_limit_status(request.endpoint or "")
    if not limited:
        return None
    retry_after, limit, window_seconds = limited
    response = jsonify(
        {
            "error": "rate limit exceeded",
            "limit": limit,
            "window_seconds": window_seconds,
            "retry_after": retry_after,
        }
    )
    response.status_code = 429
    response.headers["Retry-After"] = str(retry_after)
    return response


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/satellites")
def satellites():
    return jsonify(
        {
            "items": load_satellites(),
            "fetched_at": int(_tle_cache["fetched_at"]),
            "source": _tle_cache["source"],
            "source_groups": _tle_cache["source_groups"],
            "refreshing": _tle_cache["refreshing"],
            "last_error": _tle_cache["last_error"],
        }
    )


@app.route("/api/country")
def country():
    lat, lon = _parse_finite_lat_lon()
    if lat is None or lon is None:
        return jsonify({"error": "finite lat and lon are required"}), 400

    lat_round = round(_clamp(lat, -90, 90), 1)
    lon_norm = ((lon + 180) % 360) - 180
    lon_round = round(lon_norm, 1)
    return jsonify(reverse_geocode_country(lat_round, lon_round))


@app.route("/api/location-label")
def location_label():
    lat, lon = _parse_finite_lat_lon()
    if lat is None or lon is None:
        return jsonify({"error": "finite lat and lon are required"}), 400

    lat_round = round(_clamp(lat, -90, 90), 2)
    lon_norm = ((lon + 180) % 360) - 180
    lon_round = round(lon_norm, 2)
    return jsonify(reverse_geocode_place(lat_round, lon_round))


@app.route("/api/search")
def search():
    query = request.args.get("q", "", type=str)
    return jsonify({"items": search_places(query)})


@app.route("/api/satellite-lookup/<int:catnr>")
def satellite_lookup(catnr: int):
    item = load_satellite_by_catnr(catnr)
    if not item:
        return jsonify({"error": f"No satellite TLE found for NORAD {catnr}"}), 404
    return jsonify(item)


@app.route("/api/countries")
def countries():
    return jsonify({"items": load_country_labels()})


@app.route("/api/location-intel")
def location_intel():
    name = request.args.get("name", "", type=str).strip()
    country = request.args.get("country", "", type=str).strip()
    lat, lon = _parse_finite_lat_lon()
    if not name or lat is None or lon is None:
        return jsonify({"error": "name, finite lat, and finite lon are required"}), 400
    return jsonify(build_location_intel(name=name, country=country, lat=lat, lon=lon))


@app.route("/api/satellite/<int:catnr>")
def satellite_details(catnr: int):
    fallback_name = request.args.get("name", "", type=str).strip()
    details = load_satcat_details(catnr)
    if details:
        details = {**details, "__source": "celestrak"}
    else:
        space_track = load_space_track_satcat_details(catnr)
        details = {**space_track, "__source": "space-track"} if space_track else {}
    satnogs = load_satnogs_satellite(catnr)
    reference = load_satellite_reference(fallback_name, satnogs)
    profile = infer_satellite_profile(details, fallback_name)
    owner_label = profile["owner_label"]
    operator_type = profile["operator_type"]
    classification_source = profile["classification_source"]
    satnogs_countries = _country_labels_from_codes(satnogs.get("countries", ""))
    satnogs_name = satnogs.get("name", "")
    if not owner_label and satnogs_countries:
        owner_label = ", ".join(satnogs_countries)
    if classification_source == "Name heuristic (satcat unavailable)" and satnogs:
        classification_source = "SatNOGS DB + Name heuristic"
    if operator_type == "Unspecified" and satnogs.get("website"):
        operator_type = "Cataloged operator / mission source"
    field_sources = _satellite_field_sources(
        details, satnogs, reference, profile, owner_label, operator_type
    )
    confidence = _satellite_confidence(field_sources)
    return jsonify(
        {
            "purpose": profile["purpose"],
            "object_name": details.get("OBJECT_NAME", "") or satnogs_name or fallback_name,
            "object_id": details.get("OBJECT_ID", ""),
            "object_type": details.get("OBJECT_TYPE", "") or profile["object_type"],
            "ops_status_code": details.get("OPS_STATUS_CODE", ""),
            "owner": details.get("OWNER", ""),
            "owner_label": owner_label,
            "operator_type": operator_type,
            "classification_source": classification_source,
            "launch_date": details.get("LAUNCH_DATE", "")
            or _compact_iso_date(satnogs.get("launched", "")),
            "deployed_date": _compact_iso_date(satnogs.get("deployed", "")),
            "launch_site": details.get("LAUNCH_SITE", ""),
            "orbit_type": details.get("ORBIT_TYPE", ""),
            "period_minutes": details.get("PERIOD"),
            "inclination_deg": details.get("INCLINATION"),
            "apogee_km": details.get("APOGEE"),
            "perigee_km": details.get("PERIGEE"),
            "rcs": details.get("RCS"),
            "aliases": _clean_satellite_aliases(satnogs.get("names", "")),
            "website": satnogs.get("website", ""),
            "image": f"https://db.satnogs.org/media/{satnogs['image']}"
            if satnogs.get("image")
            else "",
            "countries": satnogs_countries,
            "satnogs_status": satnogs.get("status", ""),
            "citation": satnogs.get("citation", ""),
            "summary": reference.get("summary", ""),
            "summary_url": reference.get("content_url", "") or satnogs.get("website", ""),
            "summary_source": "Wikipedia"
            if reference
            else ("SatNOGS DB" if satnogs.get("website") else ""),
            "field_sources": field_sources,
            "source_confidence": confidence,
            "raw": details,
            "raw_satnogs": satnogs,
        }
    )


if __name__ == "__main__":
    port = int(_env_value("PORT", "8000"))
    app.run(host="0.0.0.0", port=port, debug=_env_flag("FLASK_DEBUG", default=not _is_production()))
