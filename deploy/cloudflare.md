# Cloudflare Tunnel Deployment

1. Create a Cloudflare Tunnel and copy its token.
2. Set `TUNNEL_TOKEN` in the server `.env`.
3. Set `TRUSTED_HOSTS` to your public hostname.
4. Run `podman compose up -d` in the deployed app directory.

The compose stack does not publish the app port to the public host. Traffic is expected to reach the app through `cloudflared`.
