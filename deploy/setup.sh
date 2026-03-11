#!/usr/bin/env bash
# One-time host bootstrap for the container-based deployment.
# Run this once on the target host before the first Ansible deploy.
set -euo pipefail

APP_DIR=${APP_DIR:-/home/cass/satellite-chum}
TRUSTED_HOSTS=${TRUSTED_HOSTS:-your-domain.example}

mkdir -p "$APP_DIR"

if [ ! -f "$APP_DIR/.env" ]; then
    SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")
    {
        echo "SATELLITECHUM_ENV=production"
        echo "SECRET_KEY=$SECRET"
        echo "SESSION_COOKIE_SECURE=true"
        echo "TRUSTED_HOSTS=$TRUSTED_HOSTS"
        echo "TUNNEL_TOKEN="
    } > "$APP_DIR/.env"
    chmod 600 "$APP_DIR/.env"
    echo "Created $APP_DIR/.env — set TUNNEL_TOKEN and TRUSTED_HOSTS before deploying."
else
    echo "$APP_DIR/.env already exists, skipping."
fi
