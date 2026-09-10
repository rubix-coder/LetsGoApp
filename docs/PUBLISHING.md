# Publishing LetsGo to the Linux software stores

How a build reaches the app grids in **GNOME Software**, **KDE Discover** and
Ubuntu's **App Center**. Work top to bottom; Flathub is the one that matters.

---

## 0. What "in the Ubuntu store" actually means

Ubuntu's App Center shows two kinds of app:

| Source | Reaches | Effort | Verdict |
|---|---|---|---|
| **Flathub** (Flatpak) | Every major distro — Ubuntu, Fedora, Mint, SteamOS, Pop!_OS | Moderate | **Do this.** One submission, every distro. |
| **Snap Store** | Ubuntu-centric | Moderate | Optional, later. Nothing here depends on it. |
| **`.deb`** | People who download it | Trivial | `packaging/electron/build-deb.sh`. Not a store listing, and not part of the release flow. |

This repo ships the Flatpak only — there is no Tauri/native build and no
Android build here. Ubuntu 24.04+ App Center shows Flatpaks once the user
enables Flathub, and
GNOME Software / KDE Discover do so out of the box on most distros. Flathub is
the highest-leverage single move, so everything below is about Flathub.

---

## 1. Prerequisites

- [ ] The repo is public at `https://github.com/rubix-coder/LetsGoApp`.
- [ ] `LICENSE` is present (AGPL-3.0-or-later). Flathub requires a real license.
- [x] **Screenshots** — five committed in `docs/screenshots/` and referenced by
      `packaging/flatpak/com.rubixcoder.letsgo.metainfo.xml.in`. Flathub loads
      them from `raw.githubusercontent.com`, **so those URLs only resolve once
      the repo is public.** Check them in a browser after publishing.
- [x] **App icon** — `webapp/assets/icon-only.png` (1024x1024, violet gradient
      with the ▸▸ mark); `packaging/flatpak/make-icons.mjs` resizes it into the
      hicolor set at build time, and `packaging/electron/build/icon.png`
      matches. The icons are **generated**, not hand-drawn: edit
      `webapp/scripts/make-icon-assets.mjs` and run `pnpm --filter
      letsgo-webapp icons` — it rewrites them byte-identically.

Validate the metadata before you submit anything:

```bash
# builds the metainfo.xml from the template, then validates it
packaging/flatpak/build-flatpak.sh --no-install
flatpak run org.freedesktop.appstream-glib validate \
  packaging/flatpak/staging/com.rubixcoder.letsgo.metainfo.xml
```

Fix every error and every warning you reasonably can — the Flathub reviewer
runs the same check.

---

## 2. Build and test the Flatpak locally

```bash
packaging/flatpak/build-flatpak.sh          # builds and installs --user
flatpak run com.rubixcoder.letsgo
```

Then walk `packaging/flatpak/VERIFY.md`. Two things specifically:

1. **It must work with no server.** Fresh install, no config: create a task,
   write a note, run a timer. Nothing may hang waiting on a network call.
2. **No stale config.** `rm -rf ~/.var/app/com.rubixcoder.letsgo` first, so you
   are testing what a new user gets, not your own leftover state.

CI builds the same bundle: **Actions → Flatpak → Run workflow**, then download
the `letsgo-flatpak-x86_64` artifact.

---

## 3. Submit to Flathub

Flathub builds from a **manifest in their repo**, not from yours.

1. Fork [`flathub/flathub`](https://github.com/flathub/flathub) and create a
   branch named exactly `com.rubixcoder.letsgo`.
2. Add the manifest (`com.rubixcoder.letsgo.yml` or `.json`) at the repo root
   of that branch. Base it on `packaging/flatpak/` but point `sources` at a
   **tagged git URL**, not a local path:

   ```yaml
   sources:
     - type: git
       url: https://github.com/rubix-coder/LetsGoApp.git
       tag: v0.60.1
       commit: <the full sha that tag points at>
   ```

   Flathub requires a `tag` **and** the matching `commit` — floating branches
   are rejected.
3. Open a PR from that branch against `flathub/flathub` `master`.
4. A bot builds it and posts the result; a human reviews. Expect review
   comments on: the finish-args (ask for the narrowest permissions that work),
   missing screenshots, and any network access at build time — **builds are
   offline**, so every dependency must be a declared source. Electron apps in
   particular need `node_modules` vendored or declared, not `npm install`-ed
   during the build.
5. On merge you get `flathub/com.rubixcoder.letsgo` — your own repo. Push there
   to ship an update; the build farm publishes it.

Turnaround is typically days to a couple of weeks for a first submission.

### Likely review sticking points for this app

- **Electron + AGPL is fine**, but the manifest must vendor its npm deps.
- **`--share=network`** will be questioned. LetsGo needs it for optional
  WebDAV/Google sync — say so in the PR description.
- **App ID must match** the `id` in the metainfo, the `.desktop` file name, and
  the icon file name. All three are already `com.rubixcoder.letsgo`.

---

## 4. Optional: Snap Store

Only if you want Ubuntu-specific reach. You would add a `snap/snapcraft.yaml`
(none exists in this repo today), then:

```bash
snapcraft            # build
snapcraft login
snapcraft register letsgo
snapcraft upload --release=stable letsgo_*.snap
```

Name registration is first-come — register `letsgo` early even if you never
publish, so nobody else takes it.

---

## 5. Optional: your own OTA Flatpak repo

Independent of Flathub, for a private or pre-release channel:

```bash
export LETSGO_GPG_KEY=<your-key-id>
export LETSGO_REPO_ORIGIN=https://your-host.example.com
packaging/flatpak/build-flatpak.sh --no-install
# serve packaging/flatpak/repo/ at <origin>/flatpak/
```

Users add it with `flatpak remote-add --user letsgo
<origin>/flatpak/letsgo.flatpakrepo` and update with `flatpak update`.

Keep the signing key safe and **reuse the same one forever** — publishing a
repo signed with a different key makes every existing client fail verification.

---

## 6. Release checklist

- [ ] Version bumped in `webapp/package.json` (the Flatpak builds from it;
      `build-flatpak.sh` syncs the shell to match).
- [ ] `CHANGELOG.md` entry written.
- [ ] `pnpm test` and `pnpm test:shell` pass.
- [ ] Flatpak built and smoke-tested from a clean state
      (`rm -rf ~/.var/app/com.rubixcoder.letsgo` first).
- [ ] Tag pushed (`v0.60.1`).
- [ ] Release created with `letsgo.flatpak` attached.
- [ ] Flathub manifest bumped to the new tag + commit sha.
