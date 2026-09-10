# LetsGo desktop shell

The app as a real desktop app — **the identical Vite bundle rendered by
Chromium** (Electron), so everything that works in the browser works here:
the encrypted vault, service-worker timer notifications, camera ISBN
scanning, Google Calendar sign-in, PWA update banner, all of it. No IPC, no
preload, no forked code paths.

## Team mode / sync (optional)

**There is no default server.** Out of the box the shell serves the app
locally and talks to nothing.

A bundled localhost server (`server.cjs`) serves the app on
`http://localhost:8637`. If you configure an upstream, it reverse-proxies
**`/api` → your server** so the team backend is reached *same-origin* —
required because the server deliberately has no CORS and uses a
`SameSite=Lax` session cookie (it also strips the cookie's `Secure` flag,
which the server sets under `NODE_ENV=production`, so the session survives on
a localhost origin). This mirrors the nginx `/api` proxy described in
`../../webapp/DEPLOY.md` §5.

To point it somewhere, set `nasUrl` in `~/.config/LetsGoWeb/config.json` (it
is seeded empty on first run) or set `LETSGO_NAS_URL`. Then in the app:
**Login → leave "Server URL" empty** to use the same-origin proxy.

## Flatpak (the shipping format)

This same shell is packaged as a Flatpak in `../flatpak/`
(`build-flatpak.sh`) — sandboxed, and the only format this repo releases.
Prefer it over the `.deb` on modern Ubuntu: no AppArmor userns workaround
needed. See `../flatpak/README.md`.

## Build a .deb (optional, not part of releases)

```sh
packaging/electron/build-deb.sh          # → packaging/electron/dist/letsgo-webapp_<v>_amd64.deb
sudo apt install ./packaging/electron/dist/letsgo-webapp_*.deb
```

The version is always synced from `webapp/package.json`. The deb upgrades
cleanly over the retired 0.35.0 python-launcher package (same
`letsgo-webapp` package name).

## Ubuntu 24.04+ note (already handled)

Ubuntu restricts unprivileged user namespaces via AppArmor, which crashes
Chromium's sandbox in .deb-installed Electron apps. The package's postinst
installs `/etc/apparmor.d/letsgo-webapp` granting `userns` to exactly
`/opt/LetsGoWeb/letsgo-webapp` (the same approach Chrome and VS Code use);
postrm removes it.

## Data location

The vault lives in the Chromium profile at `~/.config/LetsGoWeb/` (origin
`http://localhost:8637`). It is **not** shared with a browser tab pointed at
your server — migrate once via Settings → Data → Export / Import if needed.

## Google Calendar

Add `http://localhost:8637` to the OAuth client's *Authorized JavaScript
origins* (Google permits plain-HTTP localhost origins) — see
`../../webapp/DEPLOY.md` §4.
