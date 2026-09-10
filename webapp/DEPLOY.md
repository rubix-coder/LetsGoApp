# Self-hosting the LetsGo web build

The Flatpak needs none of this — it serves the app locally and works offline.
Follow this only if you want LetsGo reachable in a browser, or want **team
mode**.

`webapp/dist/` is a static single-page app. Any static host works; it needs
exactly one thing: an **SPA fallback** so unknown paths return `index.html`.

## 1. Build

```sh
pnpm install
pnpm build            # -> webapp/dist/
```

If you set a server origin into the build (only needed for a shell that is not
served from the same origin):

```sh
VITE_LETSGO_SERVER_ORIGIN=https://your-domain.example.com pnpm build
```

## 2. Serve it

### Docker Compose (easiest — app + optional API together)

```sh
docker compose -f packaging/docker-compose.yml up -d
```

That starts nginx on `:8080`, already wired with the SPA fallback and the
`/api` proxy (`packaging/nginx.conf`). It expects `webapp/dist` to exist, so
build first. Use `up -d api` for the backend only.

### nginx

```nginx
server {
    listen 443 ssl;
    server_name your-domain.example.com;

    root /srv/letsgo;          # contents of webapp/dist
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;   # SPA fallback
    }
}
```

### Caddy

```
your-domain.example.com {
    root * /srv/letsgo
    try_files {path} /index.html
    file_server
}
```

## 3. HTTPS

Serve over HTTPS. Two features depend on it:

- **Google Calendar** — Google refuses to register a plain-HTTP origin
  (`http://localhost` is the only exception).
- **Team mode** — with `NODE_ENV=production` the session cookie is `Secure`,
  so over plain `http://` the browser drops it and login silently fails.

Any normal certificate works — Let's Encrypt via certbot or Caddy's automatic
TLS. (If you run on a Tailscale tailnet, a MagicDNS `*.ts.net` name gets a real
publicly-trusted cert, which Google accepts.)

## 4. Google Calendar — the OAuth client

Optional, and it uses **your own** OAuth client. No client ID or secret ships
in this repo, and no client *secret* is ever used.

### Create the client ID

The console was reorganised into **Google Auth Platform** in 2025–26; the old
"APIs & Services → OAuth consent screen" path no longer matches.

1. **Enable the API** — *APIs & Services → Library* → search **Google Calendar
   API** → **Enable**.
2. **Branding** — *Google Auth platform → Branding*. On a fresh project this is
   a **Get started** wizard: app name, user support email, developer contact.
3. **Audience** — *Google Auth platform → Audience* → **External**. Under **Test
   users**, add **every Google account you intend to connect** (up to 100).
   Consent is refused for accounts that are not listed.
4. **Client** — *Google Auth platform → Clients* → **Create client** →
   application type **Web application**. Under **Authorized JavaScript
   origins** add:

   ```
   https://your-domain.example.com   # the origin you serve LetsGo from
   http://localhost:5173             # only for `pnpm dev`
   ```

   Leave **Authorized redirect URIs empty** — the token model never navigates
   away from the page, so it uses no redirect URI.
5. Copy the client ID and paste it into **Settings → Google Calendar**, then
   **Add a Google account** once per account.

### What to expect

- The scope `calendar.events` is **sensitive**, so while the app's publishing
  status is **Testing** the consent screen shows an unverified-app warning —
  expected for a self-hosted app, and no verification is required in this state.
- Testing-mode grants are short-lived (~7 days), so silent renewal eventually
  fails and the Settings pane reports **"Google needs you to sign in again"**.
  The LetsGo logo also turns **amber** — click it (or the **Reconnect Google**
  button in Settings) to re-consent; Google requires a real click for this,
  which is exactly why the sync surfaces a status rather than popping a dialog.
  Moving the app to *In production* stops the weekly re-consent, at the cost of
  an unverified-app interstitial you click through once.
- No client secret is used or stored anywhere: the browser receives a
  short-lived access token kept in `localStorage` (so a still-live one survives
  a browser restart; a dead one is always discarded on load), which never
  enters the vault — so the encrypted blob you sync carries no Google
  credential.

### Firefox: allow the silent-renewal cookie

Silent token renewal runs through a hidden `accounts.google.com` iframe, which
needs that domain's cookies. Firefox's strict Enhanced Tracking Protection
blocks them, so every session starts logged out of Google even though the token
is still good.

One-time fix, in the profile you run the app in: **Settings → Privacy &
Security → Cookies and Site Data → Manage Exceptions** → add
`https://accounts.google.com` as **Allow**. (Chrome allows this by default; no
action needed there.)

## 5. Team mode

Static files alone have no backend, so `POST /api/auth/signup` returns **405**.
Team mode needs `server/` running beside the static site with `/api` proxied on
the **same origin** — the session cookie must stay first-party, and the server
has no CORS support by design.

1. **Run the API** (persistent SQLite in a volume):

   ```sh
   docker compose -f packaging/docker-compose.yml up -d api
   ```

   Signup is closed by default, but the **first account is always allowed** so
   you can bootstrap yourself as admin. Set `ALLOW_SIGNUP: "true"` while
   onboarding others, or use invite links.

2. **Proxy `/api`** — add one location to your server block:

   ```nginx
   location /api/ {
       proxy_pass http://127.0.0.1:8787;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
   }
   ```

   Then reload the web server.

3. **Cookie gotcha** — see §3. Serve over HTTPS, or drop `NODE_ENV: production`
   from the compose file for a LAN-only setup.

## Notes

- The vault is **per-browser** (`localStorage`). You deploy the app, never any
  data, so there is nothing to migrate server-side.
- Changing the origin you serve from means a *new* vault, because storage is
  scoped per origin. Export first if you are moving hosts.
