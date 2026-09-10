# LetsGo Flatpak — verification checklist

Run after `packaging/flatpak/build-flatpak.sh` installs the build
(`flatpak run io.github.rubix_coder.LetsGoApp`). The Flatpak is the LetsGo **webapp**
rendered by Chromium, so this list is "does the browser feature survive the
sandbox", not "is the feature implemented".

## Status — first real desktop run, 2026-09-04 (v0.48.0)

**Passed.** Confirmed by the user on a live GNOME session: the app renders the
real vault (habits heat grid, streaks, dark theme), and **notifications and
general operation work** — the headline risk, since it means the service worker
survives the Flatpak sandbox and reaches `org.freedesktop.Notifications`
through the portal.

**One failure, since fixed by configuration:** Google sign-in returned
`Error 400: origin_mismatch` because `http://localhost:8637` was not a
registered Authorized JavaScript origin — see the README's *Google Calendar*
section, which is now a required setup step rather than a footnote.

The per-row boxes below stay unticked as a template for the next release; treat
the paragraph above as the record for 0.48.0.

## Headless smoke (CI-friendly)

```sh
LETSGO_SMOKE_SHOT=/tmp/letsgo.png \
  flatpak run --command=letsgo-webapp io.github.rubix_coder.LetsGoApp
# -> writes /tmp/letsgo.png of the rendered app, exits 0, prints SMOKE_OK
```

> Under Xvfb, xdotool mouse clicks do not reach the webview — the
> smoke shot only proves first paint. The rest of this list is manual.

## Manual

| # | Check | How | Pass |
|---|-------|-----|------|
| 0 | **Local-only, clean state** | `rm -rf ~/.var/app/io.github.rubix_coder.LetsGoApp` first. With **no server configured and the network off**, create a task, write a note, run a timer — nothing hangs or errors. This is the core promise; test it before anything else. | ☐ |
| 1 | **First paint / vault** | Launch → Unlock screen or dashboard renders | ☐ |
| 2 | **Vault persistence** | Add a task, quit, relaunch → task still there (profile at `~/.var/app/io.github.rubix_coder.LetsGoApp/config/…`) | ☐ |
| 3 | **Color scheme** | Settings → toggle light/dark and accent → chrome + cards recolor, no flash of wrong theme on next launch | ☐ |
| 4 | **Notifications** | Settings grant prompt → allow; start a 1-min timer → OS banner fires at 0:00 | ☐ |
| 5 | **Backgrounded reminder** | Start a short timer, minimize the window → banner still fires (service worker) | ☐ |
| 6 | **Alert sounds** | Settings → Security → Alert sound → Preview each (Chime/Beep/Gong/Marimba) → audible; timer-finish plays the chosen one | ☐ |
| 7 | **Status check-in** | Put a task in progress, wait the nudge interval → "still your focus?" prompt with Pause / Mark done / Still on it | ☐ |
| 8 | **Camera / ISBN scan** | Library → Scan → camera permission prompt → allow → live preview, a barcode resolves to a book | ☐ |
| 9 | **Google Calendar** | **Register `http://localhost:8637` as an Authorized JavaScript origin FIRST** (README § Google Calendar) or this fails with `Error 400: origin_mismatch`. Then Settings → Google Calendar → Add account → consent → events appear | ☐ |
| 10 | **Sync / team** (only if you host a server) | Login against your server URL; vault restore from WebDAV works | ☐ |
| 11 | **External links** | Click a book's external page → opens in the system browser, not inside the app | ☐ |
| 12 | **Mindmap / notes / gantt** | Open each plugin screen → renders, drag works | ☐ |

## OTA

```sh
# after publishing a newer build to your Flatpak repo:
flatpak update io.github.rubix_coder.LetsGoApp      # pulls the delta, no reinstall
# or: GNOME Software shows it under Updates within ~a day
```

| # | Check | Pass |
|---|-------|------|
| 13 | `flatpak remote-add --user letsgo https://<nas>/flatpak/letsgo.flatpakrepo` succeeds (GPG key trusted) | ☐ |
| 14 | `flatpak install --user letsgo io.github.rubix_coder.LetsGoApp` from a clean machine works | ☐ |
| 15 | Bump webapp version, rebuild+publish → `flatpak update` moves the client to the new version, vault intact | ☐ |
