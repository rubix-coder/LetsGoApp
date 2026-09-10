# LetsGo ▸▸

A local-first productivity app for Linux — tasks and planning, a day schedule
and calendar, notes and mindmaps, habits and focus timers. Your data lives on
your machine in an encrypted vault. There is no account, no telemetry, and no
server unless you choose to run one.

Packaged as a **Flatpak**: the LetsGo app rendered by a Chromium shell, so
notifications, reminders and sounds behave the way they do in a browser.

## Your data stays yours

LetsGo ships with **no backend and no telemetry**. On first run it talks to
nothing: no default server, no account, no phone-home. Everything lives on
your device.

Sync is opt-in and *you* own the other end of it:

- **WebDAV** — point it at any WebDAV server you run (Nextcloud,
  openmediavault, `rclone serve webdav`, …). The vault is encrypted
  client-side before it leaves the device.
- **Google Calendar** — optional, and it uses **your own** OAuth client ID,
  entered in Settings. No shared credentials ship in this repo.
- **Team mode** — an optional Node backend in `server/` that you host yourself.

The Library is the one feature that reaches a third party when you *use* it:
looking up a book queries Open Library (then Google Books), and resolving an
awkward book link can call the Anthropic API with a key you supply. Both are
opt-in, and API keys are stored on-device only — never in the vault, never
synced, never in an export. Full breakdown:
[`webapp/README.md`](webapp/README.md#network-use).

> **Want a hosted instance instead of running your own?**
> Open an issue on [the tracker](https://github.com/rubix-coder/LetsGoApp/issues)
> or reach out via [@rubix-coder](https://github.com/rubix-coder) on GitHub.
> Hosting is arranged case by case; the software itself is, and stays, free.

## Install

### Option A — build it yourself (works today)

Needs `flatpak`, [Node](https://nodejs.org) 20+ and
[pnpm](https://pnpm.io/installation). Install the Flatpak runtimes once:

```sh
flatpak remote-add --user --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
flatpak install --user flathub \
  org.freedesktop.Platform//24.08 org.freedesktop.Sdk//24.08 \
  org.electronjs.Electron2.BaseApp//24.08 org.flatpak.Builder
```

Then:

```sh
git clone https://github.com/rubix-coder/LetsGoApp.git
cd LetsGoApp
packaging/flatpak/build-flatpak.sh      # builds, then installs --user
flatpak run io.github.rubix_coder.LetsGoApp
```

The script handles the dependency install itself; the first run takes a few
minutes, mostly Electron. To build without installing, pass `--no-install`.

### Option B — a prebuilt bundle

If a [release](https://github.com/rubix-coder/LetsGoApp/releases) is
available, or you grabbed the `letsgo-flatpak-x86_64` artifact from a CI run:

```sh
flatpak install --user flathub org.freedesktop.Platform//24.08   # once
flatpak install --user ./letsgo.flatpak
flatpak run io.github.rubix_coder.LetsGoApp
```

> If you already have LetsGo installed from a signed remote, installing an
> unsigned bundle over it fails with *"GPG verification enabled, but no
> signatures found"*. Remove the old copy first
> (`flatpak uninstall --user io.github.rubix_coder.LetsGoApp`) — your vault in
> `~/.var/app/` is not touched — or install from the remote instead.

### Updates

Neither route self-updates — rebuild or reinstall to upgrade. Automatic
updates (`flatpak update`) need the app served from a Flatpak *repo*:

- **Flathub** — the plan; once listed, `flatpak update` handles it for you.
  Steps: [`docs/PUBLISHING.md`](docs/PUBLISHING.md).
- **Your own repo** — host one yourself, see
  [`packaging/flatpak/README.md`](packaging/flatpak/README.md).

### Uninstall

```sh
flatpak uninstall --user io.github.rubix_coder.LetsGoApp
rm -rf ~/.var/app/io.github.rubix_coder.LetsGoApp    # also removes your vault
```

## What it does

**Manage tasks** — capture work and break it into subtask trees, then see it your
way: a **Board** (Kanban, Eisenhower matrix, Gantt, or List lens), a day
**Schedule** timeline, or a month **Calendar**. Each task carries a priority
(P0–P3), tags, a deadline, an estimate, dependencies, and an optional recurrence
(routines). Estimate-driven **auto-scheduling** packs a task tree back-to-back
inside your work-hours window — drop an unplanned tree onto the schedule and the
plan unfolds; drag any card to re-flow the rest; completed tasks stay anchored,
and a scheduling **lock** freezes a placement.

**Manage time** — run **Pomodoro / countdown / stopwatch** timers and a
distraction-free **Focus mode**; timers auto start/stop with a task's status and
log time against it, so estimates get an ETA from your own history. Ad-hoc
**quick timers** run alongside. **Scheduled reminders** pop up to start a task
when its time arrives, and to **extend** (by a chosen number of minutes) or
finish it when it runs past its slot.

**Jot ideas** — nested **notebooks and pages** with a block editor (markdown,
tables, code, `[[wikilinks]]`) and a raw-markdown mode where **Tab** indents.
Drag to reorder notebooks and pages, multi-select for bulk delete, and send a
note's bullets straight to the Todo board. The **Mindmap** turns your content
into an interactive graph — a **notes web** from the wikilinks between notes, a
**task tree**, or a single note's **outline** — with pan / zoom and auto-focus on
the part you clicked.

**And the cool stuff** — a **Dashboard** day-at-a-glance; **import** markdown or
iCal (re-import to keep them synced) and **export** markdown / JSON; pick which
view **opens on launch**; light / dark / system themes with accent palettes and
density; 12/24-hour clock and week-start. Security is a **WebCrypto-encrypted
vault** opened with a passphrase or passwordless, plus opt-in timer
notifications and sounds. Sync is your choice: an encrypted blob to your **WebDAV server**, or **team mode** against a self-hosted `server/` with invite links,
roles (owner / co-admin / editor / viewer) and live CRDT sync.


## Repository layout

A pnpm monorepo. Each directory has one job:

| Path | What it is |
|---|---|
| `webapp/` | **The app** — a React + TypeScript + Vite SPA. All the UI and logic. |
| `packaging/electron/` | **Desktop shell** — Electron/Chromium window that serves the built app locally and proxies `/api` to your server if you configure one. |
| `packaging/flatpak/` | **The Flatpak** — manifest, build script, AppStream metadata, desktop entry. |
| `server/` | **Optional team backend** (Node) — accounts, projects, roles and live sync. Not required for single-user use. |
| `docs/` | Architecture, publishing guide, ADRs. |
| `.github/` | CI (test + build) and the Flatpak build workflow. |

## Develop

```sh
pnpm install
pnpm dev            # webapp at http://localhost:5173
pnpm test           # webapp + server unit tests
pnpm build          # static bundle -> webapp/dist/
pnpm test:shell     # builds, then smoke-tests the desktop shell
```

Optional team backend:

```sh
pnpm --filter letsgo-server dev     # http://localhost:8787
```

The dev server proxies `/api` to it.

### Build the Flatpak

See [Install → Option A](#option-a--build-it-yourself-works-today) for the
prerequisites and the one command. After a build, walk
[`packaging/flatpak/VERIFY.md`](packaging/flatpak/VERIFY.md) — start with row 0,
which checks the app works with no server and no network.

CI builds the same bundle — **Actions → Flatpak → Run workflow**.

### Self-host the web build

`webapp/dist/` is a static SPA, so any static host works; it just needs an SPA
fallback to `index.html`. For team mode, run `server/` beside it with `/api`
proxied on the same origin. Recipes (nginx / Caddy, Docker Compose, HTTPS and
cookie gotchas) are in [`webapp/DEPLOY.md`](webapp/DEPLOY.md).

## Stack

React 18 + TypeScript + Vite · WebCrypto-encrypted vault · Loro CRDT (team
live sync) · Electron/Chromium shell · Flatpak.

## Docs

- [`webapp/DEPLOY.md`](webapp/DEPLOY.md) — **self-hosting** the web build, HTTPS, Google Calendar, team mode
- [`docs/PLUGINS.md`](docs/PLUGINS.md) — **plugins**: enabling and reordering them, and adding your own
- [`docs/PUBLISHING.md`](docs/PUBLISHING.md) — publishing to Flathub and the Linux software stores
- [`packaging/flatpak/README.md`](packaging/flatpak/README.md) — building, signing and hosting a Flatpak repo
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — how to work on it
- [`CHANGELOG.md`](CHANGELOG.md) — version history

## Contributing

Issues and pull requests are welcome — see
[`CONTRIBUTING.md`](CONTRIBUTING.md). Security reports: please follow
[`SECURITY.md`](SECURITY.md) rather than opening a public issue.

## License

**GNU Affero General Public License v3.0 or later** — see [`LICENSE`](LICENSE).

In short: you may use, study, modify and redistribute LetsGo freely. If you
modify it and let other people use it **over a network**, the AGPL requires you
to offer them the source of your modified version too. Running an unmodified
copy for yourself carries no obligation.
