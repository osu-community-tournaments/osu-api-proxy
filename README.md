# osu! API Proxy (pure nginx)

## What it does

- Forwards `/api/*` and `/oauth/token` to `https://osu.ppy.sh`.
- Rejects everything else with 404.
- Applies `limit_req` rate limiting at 3 r/s (burst 10).
- Optionally requires a shared secret via header or query string.
- Strips Cloudflare-style headers (`CF-Connecting-IP`, `CF-Ray`, …) before
  forwarding upstream.

## Prerequisites

- A Linux VPS with nginx (≥ 1.18 — anything modern).
- A TLS cert for the chosen domain (Let's Encrypt / certbot / acme.sh / etc.).

## Deploy

There are two flavors of the server block. Pick one.

| File                          | When to use                                                      |
|-------------------------------|------------------------------------------------------------------|
| `nginx.conf.example`          | Open proxy. Network-level access control (firewall, private DNS). |
| `nginx-secret.conf.example`   | Anyone can hit the domain; require a shared secret.              |

### Steps

1. **Copy configuration with your details** into `/etc/nginx/sites-available/osu-proxy.conf`.
   Adjust `server_name` and `ssl_certificate*` to your domain.

2. **Enable & reload:**

   ```bash
   ln -s /etc/nginx/sites-available/osu-proxy.conf /etc/nginx/sites-enabled/
   nginx -t && systemctl reload nginx
   ```

3. **Verify:** `curl https://your.domain/health` → `{"status":"ok",...}`.

## Authentication (secret variant)

Send the secret in one of:

| Method                | Example                                                                |
|-----------------------|------------------------------------------------------------------------|
| Header (recommended)  | `X-Proxy-Secret: your-secret-here`                                     |
| Query param (API v2)  | `https://your.domain/api/v2/...?proxy_secret=your-secret`              |
| Query param (API v1)  | `https://your.domain/api/get_beatmaps?k=KEY&proxy_secret=your-secret`  |

The `proxy_secret` query parameter is stripped before the request is
forwarded to osu.ppy.sh. The `X-Proxy-Secret` header is also stripped.

The secret lives in your nginx config. Keep that file readable only by
nginx (`chmod 0640`, owned by root, group nginx).

## Apps Script usage

Replace all `https://osu.ppy.sh` with your proxy URL. If you use the secret
variant, add the header to every `UrlFetchApp` call:

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
