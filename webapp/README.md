# LetsGo — the app

The LetsGo planner: a responsive React + TypeScript SPA for desktop browsers
and phones. **This is the application** — the Flatpak in `../packaging/` wraps
this exact build in a Chromium shell. There is no separate native codebase.

Design language is "Modern" soft-surface: a violet accent (`#7c5cf4` light,
`#9d85f8` dark) on a soft neutral-gray ground with near-white raised cards,
Instrument Sans for the interface and JetBrains Mono for numerics. Dark theme
is "midnight indigo" — its own blue-violet ground ladder, not light mode
inverted. **`src/theme.css` is the source of truth; read its header before
writing UI code.**

## Run it

```sh
pnpm install          # from the repo root
pnpm dev              # http://localhost:5173
pnpm test             # vitest
pnpm build            # tsc --noEmit + vite build → dist/
```

## What's inside

- **Unlock gate** — first run creates a passphrase; the whole store is
  encrypted at rest in localStorage (PBKDF2-SHA256, 310k iterations →
  AES-256-GCM via WebCrypto — the strongest KDF the browser ships natively).
  No recovery: a lost passphrase means starting over.
- **Todo** — Kanban (drag between columns, LIFO Done, ⋯ status menu on every
  card/row), Eisenhower, Gantt, List lenses; Schedule (full-day hour grid at
  day / 3-day / week, drag from the unscheduled tray, drag blocks to move,
  drag the bottom edge to resize in 15-minute steps, overlap lanes, now-line,
  repeating blocked-time bands, routine ghosts); Calendar (month grid with a
  week-start setting, drag a chip to reschedule, routine ghost chips, mobile
  agenda).
- **Markdown ⇄ todos** — drop a `.md` file on the Todo screen (or use the
  import button) and every bullet becomes a task, indentation nesting
  subtasks, `[x]` marking done, `[label](url)` titles reduced to the label —
  the exact desktop parser, ported with its test cases. Re-importing the same
  file updates by (source, title) and deletes tasks whose lines left the
  file. `[block]label [HHMM:HHMM][nD|nW|nM]` bullets (and editor titles)
  become repeating blocked-time placeholders. Export walks the tree back out
  as nested checkbox markdown.
- **Task editor** — full schema: status, priority (P0 highest), schedule,
  deadline, estimate (with 15/30/45/60 presets), repeat (daily / weekly /
  monthly routines), tags, subtask tree, `[[note links]]`. Modal on desktop,
  full-screen sheet on mobile.
- **Task tree semantics** — a parent's status and window are derived from its
  subtasks (done only when all children are done; a skipped child holds it at
  in-progress); estimates auto-schedule: editing any estimate in an anchored
  tree re-packs the subtree back-to-back live, and dragging a parent shifts
  its whole subtree; moving a task to in-progress auto-starts its timer, and
  leaving in-progress banks the session.
- **List view** — nested subtask tree, inline priority / estimate editing
  (estimate edits re-pack live), multi-select with bulk done / skip / delete,
  group by status or priority.
- **Timer** — pomodoro / countdown / stopwatch against a task, session log,
  dark full-screen focus mode. Finishing a countdown fires an OS notification
  through the service worker — works while the tab or installed PWA is open,
  including backgrounded/minimized, and catches up on reopen. (A fully closed
  browser can't be woken without a push server; that's a platform limit, not a
  bug — WhatsApp Web has the same one.)
- **Notes** — folder tree, markdown editor with Edit / Split / Preview,
  Ctrl/Cmd+B/I and list auto-continue shortcuts, task backlinks, wikilink
  navigation, and "Send checkboxes to Todo" (source-synced like md import).
- **Mindmap** — pan/zoom node canvas; nodes carry task status colors.
- **Dashboard** — day at a glance with a Week / Month / Year / All range
  filter: KPIs, status donut, weekly focus bars, work-pattern card
  (completion score, skip rate, early/late vs deadline), up-next. Donut
  segment order + hatch texture keep the status palette colorblind-legible.
- **Library** — a shelf of physical books. Scan ISBN barcodes with the phone
  camera (Chrome on Android; the reticle turns green and beeps per book, ~2s
  each), import a Goodreads / StoryGraph / LibraryThing CSV, or type an ISBN —
  which also makes a USB/Bluetooth barcode wedge work. Metadata and covers
  come from Open Library, falling back to Google Books; both are free and
  keyless. A scan is saved before the lookup runs, so scanning offline still
  builds the shelf and "Resolve" fills the gaps later. Search, filter by
  status / shelf / tag, sort, and track reading status, rating and dates.
- **Settings** — plugins (enabled plugins populate the nav), appearance
  (light / dark / system, density, status colors, reduced motion), security
  (notifications, passphrase change with re-encryption, lock), data
  (JSON export/import, erase), about.

Mobile (< 800px) swaps the sidebar for bottom tabs plus a FAB. Installable as
a PWA (manifest + service worker).

## Network use

The app is local-first: with no sync configured it makes no network calls of
its own. Everything below is **opt-in and user-configured** — nothing is
enabled by default and no credentials ship in this repo.

| Feature | Talks to | Credential |
| --- | --- | --- |
| WebDAV sync | a server you host | your WebDAV username/password |
| Google Calendar | Google | **your own** OAuth client ID (no secret) |
| Team mode | a `server/` you host | session cookie |
| Book metadata | Open Library, then Google Books | none (Google Books key optional) |
| Book link resolving | Anthropic API | **your own** API key, billed to you |

API keys are deliberately kept **out of the vault** (`src/lib/apiKeys.ts`):
they live in `localStorage` on the device they were typed on, so they are
never synced, never pushed to a server, and never included in a Settings
export.

## Storage

Data lives **per browser, per origin**, encrypted at rest. That means the
Flatpak's fixed origin (`http://localhost:8637`) is what makes it durable
across launches, and that moving to a different origin starts a fresh vault —
export first via **Settings → Data** if you are migrating.
