# SSL/HTTPS Activation: tasks.millenium.co.ke

How HTTPS was set up for the Kazi Yangu deployment on `75.119.136.33`. Written after the fact as a runbook, read this before touching nginx or Certbot on that server again.

## Result

| | |
|---|---|
| Live URL | **https://tasks.millenium.co.ke/** |
| Server | `75.119.136.33` (Ubuntu 24.04.4 LTS) |
| Web server | nginx 1.24.0 |
| Certificate | Let's Encrypt, ECDSA, auto-renewing |
| Issued | 2026-08-30 → expires 2026-11-28 |
| Certbot account email | briankerio47@gmail.com |

`http://tasks.millenium.co.ke/` and `http://75.119.136.33/` both redirect (301) to the HTTPS URL above.

## Starting point

Before this work, the app was reachable only at `http://75.119.136.33/`: one nginx site (`app.conf`) with `server_name _;` (catch-all) serving the frontend and proxying `/api/` and `/socket.io/` to the Node backend on `127.0.0.1:4000`. No domain, no TLS, no Certbot installed. See `.github/workflows/deploy.yml` for how code gets onto this server (that pipeline only rebuilds the app; it does not touch nginx or certificates, both are managed by hand per this document).

DNS was already pointed correctly (`tasks.millenium.co.ke` → `75.119.136.33`, confirmed via three independent resolvers) before any server changes were made.

## What changed

### 1. Split the one catch-all nginx site into two

**`/etc/nginx/sites-available/app.conf`**: `server_name` changed from `_` to `tasks.millenium.co.ke`. Nothing else about the app (root, the `/api/` and `/socket.io/` proxy blocks) changed at this point. Backed up first to `/root/nginx-backups/app.conf.bak.<timestamp>`.

**`/etc/nginx/sites-available/ip-redirect.conf`** (new): a `default_server` block that catches the bare IP (and anything else that doesn't match the domain) and 301s it to the real domain:

```nginx
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name 75.119.136.33 _;

    return 301 https://tasks.millenium.co.ke$request_uri;
}
```

Enabled via symlink in `sites-enabled/`, `nginx -t` + `systemctl reload nginx` before moving on.

### 2. Installed Certbot

```bash
apt-get install -y certbot python3-certbot-nginx
```

Installing the `certbot` package on Ubuntu auto-creates and enables `certbot.timer` (systemd); no separate cron/timer setup needed.

### 3. Obtained the certificate

```bash
certbot --nginx -d tasks.millenium.co.ke \
  --non-interactive --agree-tos -m briankerio47@gmail.com --redirect
```

The `--nginx` plugin found the `server_name tasks.millenium.co.ke` block in `app.conf`, completed the HTTP-01 challenge through it, then **edited `app.conf` itself**: added a `listen 443 ssl` block with the `ssl_certificate`/`ssl_certificate_key` directives, and (because of `--redirect`) turned the plain port-80 block for that domain into a redirect to HTTPS. All Certbot-managed lines are tagged `# managed by Certbot` in the file; don't hand-edit those, re-run Certbot instead.

### 4. Fixed mixed content (frontend/backend still pointed at the old bare-IP HTTP origin)

The frontend had been built with `VITE_API_BASE_URL=http://75.119.136.33/api` and `VITE_SOCKET_URL=http://75.119.136.33`. Loaded over HTTPS, browsers block those as mixed content, so the app would look deployed but login/API calls would silently fail.

Fixed by updating, then rebuilding:

- `/var/www/app/frontend/.env` → `VITE_API_BASE_URL=https://tasks.millenium.co.ke/api`, `VITE_SOCKET_URL=https://tasks.millenium.co.ke`, then `npx vite build`.
- `/var/www/app/backend/.env` → `CORS_ORIGIN=https://tasks.millenium.co.ke`, then `pm2 restart app-backend`.

### 5. Added cache-control headers (a stale-bundle bug found right after)

nginx wasn't sending `Cache-Control` on anything, so a browser that had `index.html` cached from before step 4 kept calling the old HTTP endpoint even after the server was fixed. Added to `app.conf`:

```nginx
location = /index.html {
    add_header Cache-Control "no-cache";
}

location /assets/ {
    add_header Cache-Control "public, max-age=31536000, immutable";
    try_files $uri =404;
}
```

`index.html` is always revalidated (so a new deploy is visible immediately); the hashed `/assets/*` bundle files are cached forever, safe since Vite gives every build new filenames.

## Renewal

Certbot's systemd timer (`certbot.timer`) runs automatically (twice daily, standard Ubuntu package default) and only actually renews when a certificate is within 30 days of expiring. Nothing to schedule manually.

To check it:

```bash
systemctl status certbot.timer
systemctl list-timers certbot.timer
certbot certificates
```

To test renewal without actually renewing:

```bash
certbot renew --dry-run --non-interactive < /dev/null
```

**Gotcha hit while writing this doc:** running `certbot renew --dry-run` *without* `--non-interactive` (and without closing stdin) over a non-interactive SSH session hung indefinitely; it was silently waiting on a prompt that could never arrive since there's no TTY. Always pass `--non-interactive` (or redirect stdin from `/dev/null`) when running Certbot from a script or CI.

## Files touched, for reference

| File | What |
|---|---|
| `/etc/nginx/sites-available/app.conf` | `server_name` → domain; Certbot added the 443/SSL block + domain redirect; cache-control locations added |
| `/etc/nginx/sites-available/ip-redirect.conf` | New: bare-IP to HTTPS-domain redirect |
| `/etc/letsencrypt/live/tasks.millenium.co.ke/` | Certificate + key (managed by Certbot, don't touch by hand) |
| `/etc/letsencrypt/renewal/tasks.millenium.co.ke.conf` | Renewal config (authenticator/installer = nginx) |
| `/var/www/app/frontend/.env` | API/socket URLs → HTTPS domain |
| `/var/www/app/backend/.env` | `CORS_ORIGIN` → HTTPS domain |
| `/root/nginx-backups/` | Pre-edit backups of `app.conf`, timestamped |

## What CI does *not* handle

`.github/workflows/deploy.yml` rebuilds the app on every push to `master` but never touches nginx config, Certbot, or the `.env` files (both are gitignored, by design). If the domain, CORS origin, or nginx routing ever need to change again, it's a manual step on the server; update this document when it happens.
