# Satellite Chum

Live satellite tracking over Earth with a 3D globe, place lookup, above-horizon filtering, orbital perspective, and lightweight satellite enrichment.

## What It Does

- tracks live satellites from TLE feeds on an interactive globe
- lets you search for a place or jump directly to a NORAD CAT ID
- shows satellites above the horizon for a selected place
- provides a focused orbital perspective panel
- enriches satellites with catalog, SatNOGS, and optional Space-Track metadata
- caches satellite and intel payloads client-side for faster reloads

## Data Sources

- CelesTrak TLE and SATCAT
- SatNOGS TLE and satellite metadata
- optional Space-Track SATCAT fallback
- Open-Meteo geocoding
- BigDataCloud reverse geocoding
- World Bank population data
- Wikidata and Wikipedia-derived reference content

## Local Development

Create or reuse the project virtual environment, install dependencies, and run the Flask server:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

The app listens on `http://127.0.0.1:8000` by default.

Useful environment variables:

- `PORT`
- `FLASK_DEBUG`
- `SATELLITECHUM_MAX_SATELLITES`
- `SATELLITECHUM_TLE_TIMEOUT`
- `SATELLITECHUM_SATCAT_TIMEOUT`

Optional Space-Track credentials:

- `SPACE_TRACK_IDENTITY` or `SPACE_TRACK_USERNAME`
- `SPACE_TRACK_PASSWORD`

The app also supports existing `.env` keys `st-user` and `st-pass`.

## Production Configuration

Set these before exposing the app publicly:

- `SATELLITECHUM_ENV=production`
- `SECRET_KEY=<strong random value>`
- `SESSION_COOKIE_SECURE=true`
- `TRUSTED_HOSTS=<comma-separated hostnames>`

Production hardening already included:

- secure session cookie defaults
- `ProxyFix` support for reverse-proxy deployments
- strict same-origin CSP for scripts, styles, fonts, and browser fetches
- app-side rate limiting on public API routes
- Gunicorn-based container runtime
- read-only container filesystem and dropped Linux capabilities in Compose

## Container Deployment

Build and run locally with Compose:

```bash
cp .env.example .env
docker compose up --build
```

The Compose stack includes:

- `redis`: ephemeral Redis instance for shared rate-limit state across workers
- `app`: Gunicorn serving the Flask app on the internal network
- `tunnel`: `cloudflared` sidecar for internet exposure without binding a public host port

Fill in `TUNNEL_TOKEN` in `.env` before using the tunnel.

## Ansible Deployment

This repo includes a deploy job shaped after the `uavchum` project:

- playbook: `deploy/deploy.yml`
- server bootstrap: `deploy/setup.sh`
- systemd unit: `deploy/satellite-chum.service`

Typical flow:

```bash
ansible-playbook -i deploy/inventory.ini deploy/deploy.yml
```

The playbook archives the repo, uploads it to the target host, extracts it into the app directory, and rebuilds the Podman Compose stack.

## Project Layout

- `app.py`: Flask app and API routes
- `templates/index.html`: main UI shell
- `static/app.js`: globe UI, polling, caching, controls
- `static/style.css`: app styling and theme variants
- `compose.yml`: production-style local stack
- `Dockerfile`: app container image

## Verification

Basic checks used during development:

```bash
python3 -m py_compile app.py
node --check static/app.js
```
