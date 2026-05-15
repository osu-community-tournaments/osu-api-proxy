# osu! API Proxy (Fastify + Docker)

Self-hosted proxy for the osu! API v1/v2. Runs as a single Docker container
behind your existing nginx, so the upstream egress IP is your VPS — not a
shared cloud pool.

## Architecture

- `app` (Docker, Fastify on Node 22, run via `tsx`) listens on
  `127.0.0.1:3000`.
- Host **nginx** terminates TLS for your domain, applies `limit_req`, and
  reverse-proxies to the container.

## Prerequisites

- A Linux VPS with Docker and `docker compose`.
- Host nginx already serving HTTPS for the chosen domain.
- A TLS cert (Let's Encrypt or otherwise) for the domain.

## Deploy

```bash
git clone <your-fork-url>
cd osu-api-proxy

cp .env.example .env
# Optional: set PROXY_SECRET=... in .env to require an auth secret.

npm run docker:up
```

Verify: `curl http://127.0.0.1:3000/health` → `{"status":"ok",...}`.

### Wire up nginx

1. Add to `http {}` once (e.g. `/etc/nginx/nginx.conf`):

   ```nginx
   # 160r/m ≈ 2.67 r/s ≈ 40 requests per 15s sustained.
   limit_req_zone $binary_remote_addr zone=osuapi:10m rate=160r/m;
   ```

2. Copy `nginx.conf.example` to `/etc/nginx/sites-available/osu-proxy.conf`,
   adjust `server_name` and `ssl_certificate*` paths, symlink into
   `sites-enabled/`.
3. `nginx -t && systemctl reload nginx`.
4. Hit `https://your.domain/health` to confirm.

## Authentication (optional)

If `PROXY_SECRET` is set in `.env`, every request must include the secret
in **one** of:

| Method                        | Example                                                    |
|-------------------------------|------------------------------------------------------------|
| Header (recommended)          | `X-Proxy-Secret: your-secret-here`                         |
| Query param (API v2)          | `https://your.domain/api/v2/...?proxy_secret=your-secret`  |
| Query param (API v1)          | `https://your.domain/api/get_beatmaps?k=KEY&proxy_secret=your-secret` |

The query parameter is stripped before forwarding upstream.

If `PROXY_SECRET` is unset, the proxy is open.

## Apps Script

Replace all `https://osu.ppy.sh` with your proxy URL. If you set a secret,
add the header to every `UrlFetchApp` call:

```js
var options = {
  method: "get",
  headers: {
    "Authorization": "Bearer " + osuToken,
    "X-Proxy-Secret": "your-secret-here"
  }
};
var response = UrlFetchApp.fetch(url, options);
```

## Local development

```bash
npm install
npm run dev      # tsx watch
npm test         # node --test
npm run typecheck
```

## Operations

- Logs: `docker compose logs -f app` (Pino JSON).
- Restart: `docker compose restart app`.
- Update: `git pull && npm run docker:up` (compose rebuilds the image).
