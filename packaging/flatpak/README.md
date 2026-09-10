# LetsGo — Flatpak

Packages LetsGo as a Flatpak for Ubuntu 24.04 / 26.04 and any distro with
Flatpak. It is the Vite bundle rendered by **Chromium** (via the Electron
shell in `../electron/`), so everything the browser does works: the encrypted
vault, service-worker timer notifications, Web-Audio alert sounds, status
check-ins, the light/dark themes, camera ISBN scanning, Google Calendar
sign-in, WebDAV/team sync.

WebKitGTK is deliberately *not* used — it broke this app's Google sign-in and
service-worker notifications. That is why the shell is Electron.

## Layout

| File | Role |
|------|------|
| `io.github.rubix_coder.LetsGoApp.yml` | Flatpak manifest — consumes `electron-builder --linux dir`, layers it on `org.electronjs.Electron2.BaseApp//24.08` |
| `letsgo-launcher` | `/app/bin/letsgo` — hands the Electron binary to `zypak-wrapper` so Chromium's sandbox works inside bubblewrap |
| `io.github.rubix_coder.LetsGoApp.desktop` | desktop entry |
| `io.github.rubix_coder.LetsGoApp.metainfo.xml.in` | AppStream metadata template (`@VERSION@`/`@DATE@` filled at build time) |
| `make-icons.mjs` | resizes `webapp/assets/icon-only.png` into the hicolor sizes (uses `sharp` from `webapp/node_modules`) |
| `build-flatpak.sh` | the whole pipeline → a signed OSTree repo in `repo/` |
| `VERIFY.md` | post-build checklist (notifications, sounds, reminders, themes, OTA…) |

## Build

Prerequisites (once):

```sh
flatpak install --user flathub \
  org.freedesktop.Platform//24.08 org.freedesktop.Sdk//24.08 \
  org.electronjs.Electron2.BaseApp//24.08 org.flatpak.Builder
```

Then:

```sh
# dev build, installed into --user, unsigned repo
packaging/flatpak/build-flatpak.sh
flatpak run io.github.rubix_coder.LetsGoApp

# release build: sign the repo so the OTA remote is trustworthy
LETSGO_GPG_KEY=<your-key-id> packaging/flatpak/build-flatpak.sh --no-install
```

Run it from a **normal terminal**, not the VS Code snap terminal (the snap env
breaks the sandbox at runtime, though not the build).

## OTA — how updates reach a machine

A release bundle (`letsgo.flatpak`) installs, but does **not** self-update —
reinstall to upgrade. Automatic updates need the app served from a Flatpak
*repo*. Two ways to get one:

- **Flathub** — once listed, `flatpak update` and GNOME Software handle it for
  you and you host nothing. See `docs/PUBLISHING.md`.
- **Your own repo** — build a signed OSTree repo and serve it over HTTPS.

With a repo, a machine installs once:

```sh
flatpak remote-add --user letsgo \
  https://letsgo.example.com/flatpak/letsgo.flatpakrepo
flatpak install --user letsgo io.github.rubix_coder.LetsGoApp
```

and updates with `flatpak update` (or GNOME Software's automatic daily check).
Verified: a republish transferred 2.1 MB (not 112 MB) and `flatpak update`
moved the client across commits using the static delta. The vault is untouched
by an update.

### Hosting your own repo

`build-flatpak.sh` writes an OSTree repo to `packaging/flatpak/repo/`. Serve
that directory over HTTPS at `<origin>/flatpak/` and set `LETSGO_REPO_ORIGIN`
so the build emits a matching `letsgo.flatpakrepo` descriptor:

```sh
export LETSGO_GPG_KEY=<your-key-id>
export LETSGO_REPO_ORIGIN=https://your-domain.example.com
packaging/flatpak/build-flatpak.sh --no-install
rsync -a --delete packaging/flatpak/repo/ you@host:/var/www/letsgo-flatpak/
```

An `nginx` location for it — note it must **not** fall back to an SPA
`index.html` if you also serve the webapp from the same vhost:

```nginx
location /flatpak/ {
    alias /var/www/letsgo-flatpak/;
    try_files $uri =404;
    autoindex off;
}
```

**Filesystem requirement:** an OSTree repo needs POSIX permissions and
hardlinks, so it cannot live on exFAT/FAT (`rsync -a` cannot set modes there).
Use ext4/xfs/btrfs, or a loop-mounted ext4 image.

**Size:** about 112 MB for the first publish. OSTree is content-addressed and
the Electron runtime objects are identical between rebuilds, so an app-only
release rewrites roughly **2 MB**; only an Electron version bump rewrites the
full ~110 MB. Updates transfer static deltas, and the vault is untouched by an
update.

### In-app update prompt (the app tells you, and restarts itself)

**The problem this solves.** `flatpak update` deploys a new commit *underneath*
a running app. OSTree never touches the running process, so the window keeps
executing the old deployment — for hours — while `flatpak info` cheerfully
reports the new version. On 2026-09-05 an update landed at 10:40 against an app
started at 09:46 and the new feature was simply invisible until a restart.
The browser build's own staleness check (`webapp/src/lib/updateCheck.ts`) is
structurally blind here: the shell serves its own bundled `index.html`, so the
comparison only ever sees itself.

**Two detectors, because the portal alone is too slow.** The portal's
UpdateMonitor polls **twice an hour** (`DEFAULT_UPDATE_POLL_TIMEOUT_SEC` in
flatpak's `portal/flatpak-portal.c`), so a freshly published update can look
like nothing shipped for nearly 30 minutes — observed 2026-09-05: CI green,
`flatpak remote-info` already showing the new version, and the app's own
`/__shell/update` correctly reporting `supported:true, available:false`.
So the agent ALSO reads the OSTree remote summary itself every 3 minutes:
fetch `<repo>/summary`, parse the GVariant (`(a(s(taya{sv}))a{sv})`), take the
commit for `app/<id>/<arch>/<branch>`, compare with `app-commit` from
`/.flatpak-info` — the commit actually RUNNING, not the one deployed. That
catches a new publish and an update installed underneath a running app, in
minutes. Only the portal can tell the two apart, so a repo sighting never
claims `restartOnly` and never downgrades an answer the portal has given.
`Update()` depends on neither detector: it runs a real `FlatpakTransaction`
(`do_update_child_process`), so it refreshes and pulls whatever is needed and
finishes "empty" when the commit was already deployed.

The repo URL comes from the shell's `config.json` (`flatpakRepoUrl`,
defaulting to `<nasUrl>/flatpak/`) and is passed to the agent as argv[1].

**How it works.** The Electron main process runs a small Python agent
(`packaging/electron/flatpak-update-agent.py`) that holds one long-lived D-Bus
connection to `org.freedesktop.portal.Flatpak` and its `UpdateMonitor`. That
portal is reachable from inside the sandbox with **no extra finish-args** —
verified, `CreateUpdateMonitor` returns a monitor path under the manifest as
it stands. The agent is Python because the monitor is a *private* object whose
signals go only to the connection that created it: a shelled-out `gdbus call`
loses it when the command exits, and `gdbus monitor` cannot eavesdrop inside
the sandbox. The freedesktop 24.08 runtime ships python3 + PyGObject, so this
adds no dependency to anything.

`packaging/electron/flatpakUpdate.cjs` owns the agent and exposes it through
the shell's existing local server as `/__shell/update` — an HTTP route, not
IPC, because the window deliberately has no preload and no nodeIntegration.
The webapp asks with a plain same-origin `fetch`
(`webapp/src/lib/shellUpdate.ts`) and shows a bar with **Restart & update** and
**Postpone** (4 hours). A browser or PWA 404s on that path and keeps the old
reload banner, so nothing changed off the desktop.

Two situations both raise the bar, and the button says which:
- `remote-commit` ahead of `local-commit` → something to download.
  *Restart & update* installs it via the portal, then relaunches.
- `local-commit` ahead of `running-commit` → already deployed underneath us.
  *Restart now* skips the portal entirely; only a restart is owed.

**Known behaviours.** The portal shows its own confirmation dialog and refuses
with `Only the focused app is allowed to show a system access dialog` if the
app is not focused — the bar surfaces that message rather than a shrug. The
agent is spawned with `LD_PRELOAD`/`LD_LIBRARY_PATH`/`ZYPAK_*` stripped, since
zypak's Chromium preload would otherwise be inherited by python3. The agent
ships as an `extraResources` file, never inside `app.asar`, because python
cannot read an archive Electron only makes *look* like a directory.

Tests: `node packaging/electron/test-flatpak-update.cjs` drives a stand-in
agent over the same line-JSON protocol (no D-Bus needed), and
`test-server.cjs` covers the route. Both run in `build-flatpak.sh` step 2.

### CI

`.github/workflows/flatpak.yml` builds the Flatpak on an x86_64 cloud runner
and uploads `letsgo.flatpak` as a workflow artifact. Run it from
**Actions → Flatpak → Run workflow**.

The CI bundle is **unsigned** — signing and publishing a repo is a deployment
step you do yourself (see below), or you let Flathub handle distribution.

## Signing key

Sign any repo you publish — an unsigned remote makes clients trust whatever is
served. Generate a key once and **keep it forever**:

```sh
export GNUPGHOME=~/.gnupg-letsgo        # a dedicated keyring, mode 0700
mkdir -p -m 700 "$GNUPGHOME"
gpg --quick-generate-key "LetsGo Flatpak <you@example.com>" default default never
gpg --list-secret-keys --keyid-format=long
```

Then pass the key id as `LETSGO_GPG_KEY`. Notes that matter:

- **Reuse the same key for every publish.** A repo signed by a different key
  than the one clients already trust makes every client fail verification.
- Keep the keyring on a filesystem that supports mode `0700` — gpg warns
  "unsafe permissions on homedir" on exFAT and similar.
- A GPG *fingerprint* is public information; the private key is what must never
  leave the signing host. If you sign in CI, use an encrypted secret, or sign
  on a self-hosted runner and keep the key off GitHub entirely.
- The public key is embedded in `letsgo.flatpakrepo` (base64 `GPGKey=`), so
  `flatpak remote-add` trusts the repo with no extra step. `build-flatpak.sh`
  regenerates that file each run.
- **Back the private key up** (`gpg --export-secret-keys --armor <id>`) and
  store it somewhere safe. Losing it is not fatal — generate a new one and have
  each client re-add the remote — but that is a manual step on every device.

## Data location

The vault lives in the Flatpak's per-app data, not shared with a browser tab:

```
~/.var/app/io.github.rubix_coder.LetsGoApp/config/…    (Chromium profile, origin http://localhost:8637)
```

Migrate from a browser via **Settings → Data → Export / Import**.

## Google Calendar — REQUIRED one-time setup

**Without this, sign-in fails with `Error 400: origin_mismatch`.** Confirmed on
first real launch, 2026-09-04.

The app serves the webapp from `http://localhost:8637`, so *that* is the origin
Google sees — not the address a browser deployment would use. Register it:

> **Google Auth Platform → Clients** → the LetsGo web client →
> **Authorized JavaScript origins** → **Add URI** →
> ```
> http://localhost:8637
> ```
> → **Save**. Propagation takes a few minutes.

Google permits plain-HTTP `localhost` origins (it is the one exception to the
HTTPS rule), so no certificate or tunnel is needed. This is purely additive —
any origin you already registered for a browser deployment stays. See
`../../webapp/DEPLOY.md` §4 for the full client setup.

### Why not avoid this entirely?

A **Desktop app** OAuth client would sidestep the JavaScript-origin check
altogether (it uses a `http://127.0.0.1:<port>` loopback redirect with PKCE,
the flow `webapp/src/lib/native/googleAuth.ts` already sketches) — and it
issues **refresh tokens**, which would also end the ~7-day re-consent that
testing-mode web clients suffer. That is a worthwhile future change; it needs
the shell to run the code+PKCE flow instead of GSI, so it is not a config
tweak. Adding the one origin above is the two-minute fix.
