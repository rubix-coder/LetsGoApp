# Changelog

All notable changes to LetsGo are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- **Tapping a habit wiped the completions of the tasks feeding it (webapp
  0.60.1).** Fallout from the task-derived target added in 0.60.0. Three tasks
  feeding one habit make the day want three ticks, but the Habits screen's tick
  button sent `+1` whenever the target was above one — so one tap left the
  habit at 1/3. The habit-to-task edge read that as "not done" and pushed it
  back onto every task feeding the habit, reopening them and dropping
  `completedAt` on work that really had been finished.

  A partial tally now carries no verdict: 2/3 says two of the three were done,
  never which two, so `linkedHabitsDone` answers `null` there — which every
  caller already reads as "leave the task alone". A tally of zero is not
  partial and still reopens everything, and habits counted by hand are
  untouched: eight glasses of water at 7/8 still reports its one task as
  unfinished.

  The tick button is fixed too. It sent `+1` unconditionally, so a
  multi-target habit could be ticked past its target and could never be
  un-ticked from that button at all; a tap on a habit already at target now
  clears the day.

### Added
- **Linked tasks set a habit's times-per-day (webapp 0.60.0).** Link morning,
  noon and evening water to "Drink water" and the day wants three ticks, one
  per task — the number is derived rather than typed, and it is asked per day,
  so a Tuesday carrying three linked tasks wants three while a Monday carrying
  two wants two.

  This is the mirror of the binding that already existed. One task feeding many
  habits was wired up ("get ready" closes brush teeth, shampoo and floor); many
  tasks feeding one habit was not, and behaved badly — any single completed
  task filled the habit's whole day, which then reached back and auto-closed
  the sibling tasks. Each task now moves the tally one step, and the day is
  kept only once all of them are done.

  A **single** linked task is deliberately left alone: it is one whole
  obligation, so "drink water" with a target of 8 and one task still fills all
  8 rather than being demoted to 1. The derivation starts at two tasks. The
  editor's Times-per-day field shows the derived number and says what set it;
  unlink a task to type one by hand again.

  History is not rewritten: `isDoneOn` takes the day's target as an argument
  and the stats walks in `lib/habitStats.ts` keep passing the habit's own
  stored `timesPerDay`. A past day judged by today's task list would break
  streaks that were honestly kept.

### Fixed
- **The edit-habit dialog could not be saved (webapp 0.59.1).** The form was one
  long column inside a dialog capped at `calc(100vh - 48px)` with nothing set
  to scroll, so on anything short of a tall screen the Cancel/Save row was
  clipped off the bottom edge — not scrolled past, gone. Editing a habit was
  unfinishable.

  It now uses the same three-part shape as the task and book editors: a fixed
  header, a body that scrolls, and a footer that is always on screen. The
  optional bulk is folded into collapsible sections — the 30-glyph emoji grid
  and the linked-task picker start closed, the schedule starts open, and each
  closed header states its own value ("Every day · 3× a day", "2 linked") so
  the folded form is still a complete read of the habit. A phone gets the
  full-height sheet the other editors already use rather than a modal.

  The disclosure is a new shared `Collapse` in `components/ui`, and the summary
  line is `habitScheduleSummary` in `lib/habits`, tested.

### Added
- **Every screen reopens on the view you left it on (webapp 0.59.0).** The
  companion to Todo's fix below, for the screens whose views were never in the
  URL to begin with. The dashboard's range, the mindmap's lens, the timer's
  side panel, the notes editor's Editor/Markdown switch and the heat-grid
  range on a habit's record all held their choice in plain component state — so
  visiting another tab unmounted the screen and took the choice with it. Each
  now remembers, per device, through one shared `lib/viewMemory` helper.

  The library's shelf tabs, cover/list layout and grouping already stuck, by
  three hand-rolled copies of the same code; they move onto the shared helper
  too. That is not only tidying: those reads ran inside `useState`
  initialisers with no guard, and `localStorage` does not return null in
  private-mode Safari — it throws. Reading the library there took the whole
  screen down. The helper swallows it and falls back, and it validates a
  stored value against the views actually on offer, so a view renamed between
  releases no longer leaves a screen with nothing to render.

- **Todo opens on the view you chose, every time (webapp 0.58.0).** Todo is
  the one plugin with sub-views, and its tab navigates to a plain `/todo` —
  which landed on the Kanban board unconditionally. Anyone working in Gantt,
  Schedule or Calendar got thrown back to Kanban on every trip through another
  tab, and the one setting that could say otherwise (Settings → Plugins) was
  hidden unless Todo also happened to be the launch plugin, and applied only
  at launch.

  The select now shows on the Todo row whenever the plugin is enabled, and
  governs every route into Todo rather than just the cold start. Its new
  default, **Last used view**, restores whichever view you were last in — the
  behaviour you'd expect from a tab bar — while pinning a specific view still
  works for anyone who wants Todo to always open the same way. The remembered
  view is per-device (localStorage), so a phone and a desktop can sit on
  different views and switching views never dirties the synced document; a
  pinned choice is a deliberate one and syncs with the vault as before. An
  older vault's launch route (`landingView: "todo/board/gantt"`) is carried
  onto the new setting on load, so an existing choice widens from launch-only
  to always rather than being lost.

- **Schedule cards show their details, not just a title (webapp 0.57.0).** A
  two-hour block was a large empty rectangle carrying a title and a time
  range, so everything needed to actually START the work sat one click away in
  the editor — a click made at the exact moment you were about to begin. A
  card now spends its leftover height on the task's write-up.

  The rule is about pixels, not minutes: a card offers a line only once it has
  the room for a whole one, so 15- and 30-minute blocks are untouched at every
  zoom level and never carry crushed text. Line breaks are preserved, so a
  description written as a checklist still reads as a checklist; markdown
  markers, wikilink brackets and blank lines are stripped because they cost
  space without adding meaning. Long text clamps with an ellipsis at the
  card's edge, and hovering gives the whole of it back in the tooltip. The
  running scratch `comment` leads when a task has both, being the more
  situational of the two. Suppressed where a column is too slim for prose —
  week view, a phone above one day, and any card sharing its lane.

- **Elapsed against estimate, on the card (webapp 0.57.1).** A compact mono
  pill beside the priority: `~1h` before you start, `25m / 1h` once the clock
  has run. It sits on the TITLE row, which is the one row every card renders
  however short — so a 30-minute block still reports its time, which the row
  below cannot promise. The pill's own background is the progress bar — a
  gradient stop at elapsed/estimate — so the card gains a progress indicator
  without spending a row on one. It tints on overrun, and ticks live while the
  timer is on that task; the whole grid shares one clock rather than every
  card owning an interval.

### Fixed
- **Elapsed time reset to zero after a pause (webapp 0.57.2).** Elapsed is the
  sum of every stretch worked on a task, and a pause freezes that sum rather
  than discarding it — two places disagreed.

  The reducer only banked a running clock when the timer moved to another
  task, so a task that had been auto-paused first lost everything it had
  worked: its held seconds were overwritten by the new task's run and never
  reached `loggedMin`. Coming back to it showed 0m, and — because the
  countdown target is what's left of the estimate — the finish alert then rang
  at whatever remained of a figure that no longer matched. Held time is now
  banked whichever way the clock leaves a task, by status change or by the
  timer's own picker, along with its pending break.

  The screens made the same assumption in reverse: cards, the dashboard totals
  and today's focus figure added the live count only while `runningSince` was
  set, so a pause visibly dropped the elapsed figure back to the banked total
  until the run was closed out. They all read one helper now
  (`taskElapsedMin`), which counts held time whether the clock is running or
  paused, and a paused card keeps showing its elapsed row.

- **The finish alert gonged again on every resume (webapp 0.57.2).** The
  "already rang" mark was the current run's start instant, which changes each
  time you resume — so a run that had passed its target and kept going fired
  the banner and chime the moment you came back from every auto-pause. The
  mark now belongs to the run itself (task, mode and target), cleared only
  when the clock is genuinely back before its target.

- **The time-check prompt reported the wrong figure (webapp 0.57.2).** It
  measured wall-clock since the task last entered `in_progress`, which resets
  on each resume, so it under-reported a task picked back up and disagreed
  with the elapsed badge on the card it was asking about. It reports worked
  time now.

- **One-hour cards sliced their description in half (webapp 0.57.1).** The
  detail clamp budgets 13px for the time row, but the badge's first home was
  that row, which its border and line-height grew to 16px — so every card with
  exactly one line of room lost 3px of it. Both rows now carry an explicit
  height, making the numbers `taskCardMeta` computes against a property the
  layout asserts rather than one it assumes.

### Added
- **A task can feed many habits (webapp 0.56.0).** The binding was one-way-ish
  — a habit could be fed by several tasks, but a task could feed only one
  habit. It is now many-to-many, which is how the real cases are shaped: one
  "Get ready" task feeds brush teeth, shampoo and clean the bathroom floor;
  one "Meal time" task feeds whey protein, lunch, snack and dinner.

  Completing the task fills every linked habit's day at once. The reverse edge
  waits for the whole checklist: the task closes only when **all** its habits
  are kept that day, and un-ticking any one of them reopens it — "get ready"
  is not finished because you brushed your teeth. Which day a completion lands
  on is unchanged: always the day the task belongs to, so ticking Monday's
  task on Tuesday still credits Monday.

  The task editor's habit picker is now a multi-select, and a habit's "linked
  tasks" list no longer hides tasks that are already bound elsewhere — a task
  feeding several habits is offerable, and visible, from each of them.

### Changed
- **`Task.habitId` became `Task.habitIds` (webapp 0.56.0).** Migrated on load
  by `hydrateState`, which carries an older vault's single id into the list
  and drops the dead field, so nothing downstream reads both shapes. A state
  with nothing to migrate is returned by identity, keeping hydration a true
  no-op. Deleted and archived habits are ignored when deciding whether a
  task's checklist is complete, so neither can hold a task open forever.

### Added
- **A wishlist for books you don't own yet (webapp 0.55.0).** A fifth reading
  status, `wishlist`, plus a "Wishlist" tab beside the shelf ones — the list
  you open standing in a shop. Four ways to fill it, because a book reaches
  you in four different ways:
  - **Paste a link** — Amazon, Flipkart, a publisher's page, anything. An
    Amazon book ASIN usually IS the ISBN-10 (`/dp/0140449132`), so the free
    databases answer most links with no Claude key and no billed request at
    all. When the link carries no code, Claude reads the page with the
    server-side `web_fetch` tool, falling back to `web_search` for the
    retailers that block fetchers — which is most of them, and Amazon nearly
    always. Whatever it finds is then re-checked against Open Library and
    Google Books, so the stored record has trusted metadata and a stable
    cover rather than the model's recollection.
  - **Search a title** — the existing free title search, no key needed.
  - **Scan the barcode** — `#/library/scan/wishlist` is the same scanner
    filing what it reads under "want" instead of "own".
  - **Type it in** — always offered, and the automatic paths fall into it on
    failure rather than dead-ending. A wishlist that refused a book because a
    retailer blocked a fetcher would be worse than a paper note.

  A wishlist entry keeps `sourceUrl` (reopen it where you found it) and gains
  `acquiredAt` when bought; `addedAt` keeps meaning "when I first wanted
  this". Buying it is one action — "Mark as bought" in the editor — and
  scanning a wishlisted book while cataloguing the shelf does it for you,
  which is the moment the wishlist exists to end.

### Changed
- **Shelf statistics now ignore the wishlist (webapp 0.55.0).** Books you do
  not own are counted separately from `total`, so "how much of what I own
  have I read" no longer drops every time you add something you want — a good
  browsing session should not read as a reading failure. Grouped by status,
  the wishlist sorts last, behind everything actually on a shelf.

### Fixed
- **"Restart now" installed nothing (webapp 0.54.0).** When the portal reported
  the update as already deployed (`restartOnly`), apply() short-circuited —
  relaunch, skip the portal entirely. When that flag was wrong the button
  therefore installed nothing, relaunched into the same build, and looked like
  the update had silently failed. It now ALWAYS asks the portal: `Update()` is
  cheap when there is genuinely nothing to pull (it answers "empty"), so the
  shortcut bought nothing and cost correctness.
- **The update agent no longer outlives the app (webapp 0.54.0).** It kept its
  main loop running after stdin closed, so every launch left another agent
  behind — three were found alive at once on one desktop. It now quits on EOF,
  and the shell stops it explicitly before relaunching (`app.exit()` skips
  `before-quit`).

### Added
- **Habits gets the movable, resizable panels too (webapp 0.53.0).**
  - **The Habits screen**: Overview, Today, This week and Archived are panels
    now — place them side by side, resize them, same handle and grip as the
    Dashboard, own **Reset layout**.
  - **The per-habit record**: the streak tiles, year heat grid, trend, by-month,
    by-weekday, by-year and linked-tasks blocks are panels. It was a 640px
    stacked column; on desktop it opens as a 1080px workspace so three columns
    of chart actually fit. One arrangement covers every habit — you lay the
    record out once and read every habit the same way.
  - Both stay a single stacked column on a phone, and a desktop arrangement is
    never overwritten by being viewed there.

### Fixed
- **The drag handles are visible now (webapp 0.53.0).** They faded in on hover
  so an untouched dashboard would look unchanged — which made a feature nobody
  could find: the panels were movable and the only thing saying so was
  invisible. They now sit at a quiet 38% opacity and come to full strength on
  hover or focus.

### Fixed
- **The update prompt now appears within minutes instead of up to half an hour
  (webapp 0.52.0).** 0.50.0 shipped the prompt but relied entirely on the
  Flatpak portal's UpdateMonitor to raise the flag — and that polls **twice an
  hour** (`DEFAULT_UPDATE_POLL_TIMEOUT_SEC`, flatpak `portal/flatpak-portal.c`).
  With CI long green and `flatpak remote-info` already reporting the new
  version, the running app's own endpoint correctly answered
  `supported:true, available:false`: the plumbing was right, the portal simply
  had not looked yet.
  - The agent now also reads the OSTree remote summary directly every 3
    minutes — fetch `<repo>/summary`, parse the GVariant, take the commit for
    this app's ref, compare it with `app-commit` from `/.flatpak-info` (the
    commit actually RUNNING, not the one deployed). Verified live against the
    NAS repo from inside the sandbox: it reported the pending update instantly.
  - The portal monitor stays, because it is the only thing that can tell an
    already-deployed update from one still to download. A repo sighting never
    claims `restartOnly` and never downgrades an answer the portal has given.
  - `Update()` needed no change: it runs a real FlatpakTransaction, so it
    installs whichever detector raised the flag and finishes "empty" when the
    commit was already deployed.
  - The repo URL comes from the shell's `config.json` (`flatpakRepoUrl`,
    default `<nasUrl>/flatpak/`).

### Added
- **Build your own Dashboard and Events view: panels move and resize (webapp
  0.51.0).** Both surfaces were fixed grids. Every panel now has a drag handle
  (top-right) and a resize grip (bottom-right), both invisible until you hover
  the panel, so an untouched dashboard looks exactly as it did.
  - **Move**: drag a panel's handle onto another and drop on its left or right
    half to place it before or after. Columns, rows and side-by-side setups all
    fall out of the order plus each panel's footprint.
  - **Resize**: drag the grip to change how many grid columns and rows a panel
    covers — live, with the footprint shown as you drag. Each panel has its own
    floor (the status donut cannot go below two rows and stay readable).
  - **Keyboard**: focus a handle and use the arrow keys to reorder, shift with
    the arrow keys to resize. The layout is not mouse-only.
  - **Touch**: long-press the handle to move (the same gesture the calendar
    already uses), drag the grip to resize.
  - Layouts save to `settings.panelLayouts` inside the encrypted vault, so they
    ride the existing NAS/team sync — the dashboard you build in the desktop app
    is the one the browser opens. **Reset layout** appears in the header once
    anything has moved.
  - Deliberately a span model, not free x/y placement: no collision solving, no
    gaps to compact, and nothing that stops meaning anything when the window
    narrows. Saved layouts are self-repairing — panels that no longer exist are
    dropped and new ones are appended at their default size, so a card that
    arrives with a future release can never be invisible behind an old layout.

### Changed
- **Events sections open independently instead of as an accordion (webapp
  0.51.0).** One-open-at-a-time made sense for a single column and actively
  fights placing sections side by side. Opening a section that was left one row
  tall now also gives it room.
- **The desktop app now tells you an update is waiting, and restarts itself
  (webapp 0.50.0).** Flatpak deploys a new commit *underneath* a running app
  and never touches the running process, so the window kept executing old code
  while `flatpak info` reported the new version — an update that landed at
  10:40 against an app started at 09:46 was simply invisible until a manual
  restart. A bar now appears in the app with **Restart & update** and
  **Postpone** (4 hours), and it says which of the two situations it is:
  something to download, or something already on disk that only needs a
  restart ("Restart now").
  - The Electron main process runs a small Python agent talking to
    `org.freedesktop.portal.Flatpak`'s UpdateMonitor — reachable from inside
    the sandbox with no extra permissions. Python because the monitor is a
    private object whose signals reach only the connection that created it, and
    the runtime already ships python3 + PyGObject: no new dependency.
  - The shell exposes it as `/__shell/update` on its existing local server
    rather than as IPC — the window still has no preload and no
    nodeIntegration, and the webapp just does a same-origin `fetch`. A browser
    or PWA 404s there and keeps the existing reload banner, which the desktop
    shell could never use: it serves its own bundled `index.html`, so the
    staleness check only ever compared the app against itself.
  - The portal shows its own confirmation and refuses when the app is not
    focused; the bar surfaces that reason instead of failing silently. The
    agent is spawned with zypak's `LD_PRELOAD` and Electron's loader vars
    stripped, and ships beside `app.asar` rather than inside it, since python
    cannot read an archive Electron only makes look like a directory.
- **An Events tab beside Calendar: every all-day event in one list (webapp
  0.49.0).** Birthdays, anniversaries, holidays and bills are invisible on a
  month grid for 364 days and then late. `/todo/events` inverts the calendar —
  it lists the events themselves, each at the day it NEXT falls on, so the
  recurring ones are the thing you look at rather than the thing you miss.
  - **Sectioned by kind**, using the EVENT_KINDS the editor already offers
    (Birthday / Anniversary / Holiday / Celebration / Bill / Appointment /
    Trip / Other). Sections are an accordion — one open at a time — and each
    collapsed header already carries its count and its soonest date, so the
    closed state is the glance and opening one is for the detail.
  - **Filter by week / month / year**, with prev-next stepping and Today, plus
    an **All** scope that lists every event once at its next occurrence and
    keeps finished one-offs, dimmed, at the end.
  - **A glance band** — how many events fall in the next 7 days, the rest of
    this month, and the rest of this year. Each tile jumps the list to the
    window it counted.
  - **Quick add**: name, date, kind, emoji and a repeat in one small dialog,
    no trip through the full task editor. Picking a kind fills the emoji and
    the routine (a birthday is yearly, a bill is monthly). Saving something
    that falls outside the window on screen widens the list to All rather than
    swallowing it.
  - Nothing new is stored to make this work: an event is still an all-day task
    anchored at `scheduledAt ?? deadline` with an ordinary repeat. The one
    field added is optional `task.eventKind`, recorded when a kind is picked;
    events saved before it existed are sectioned by their emoji, which is what
    identified a kind up to now. `lib/eventList.ts` carries the date logic and
    strides monthly/yearly repeats by the calendar instead of walking days —
    pinned by test to agree with the Calendar's `repeatOccursOn` for every
    unit, including a 31st anchor skipping February and a 29 Feb birthday
    landing on the next leap year.
- **The webapp installs as a Flatpak now, with OTA updates (webapp 0.48.0).**
  A full desktop clone of the webapp for Ubuntu 24.04 / 26.04 and any
  Flatpak distro — the identical Vite bundle rendered by Chromium via the
  Electron shell (`packaging/electron/`), layered on
  `org.electronjs.Electron2.BaseApp//24.08`. Everything the browser build
  does works: the encrypted vault, service-worker timer notifications,
  Web-Audio alert sounds, status check-ins, the light/dark themes with the
  violet accent, camera ISBN scanning, Google sign-in, NAS/team sync.
  `packaging/flatpak/build-flatpak.sh` produces a GPG-signed OSTree repo with
  static deltas; publish it beside the webapp on the NAS and clients install
  with `flatpak remote-add` + `flatpak install` and update with
  `flatpak update`. `.github/workflows/flatpak.yml` runs the build+publish on
  the self-hosted NAS runner (`packaging/flatpak/README.md`,
  `packaging/flatpak/VERIFY.md`). Replaces the stale Tauri/WebKitGTK Flatpak
  manifest (v0.14.1), which broke this app's Google sign-in and SW
  notifications — the reason the shell is Electron.
- **Google Calendar stays connected across restarts, and the logo shows sync
  health (webapp 0.48.0).** The backend-less webapp uses ~1-hour Google tokens
  with no refresh token, and three things made it feel like it logged out
  constantly:
  - **Tokens persist properly.** The cache moved from `sessionStorage` (wiped
    on tab close) to `localStorage`, so a still-live token survives a browser
    restart — dead ones are still pruned on load, and it still never enters the
    vault. A token left behind by an older session is adopted once.
  - **Background sync renews silently.** The auto-sync loop now attempts GIS's
    hidden-iframe renewal itself instead of giving up the moment the cached
    token lapses; a cached-but-revoked token that 401s mid-sync triggers one
    clean retry. A failed silent renewal buys a 10-minute cooldown so a truly
    dead session can't make every tick hammer Google (`lib/gcalAuth`,
    `lib/gcalSync`).
  - **The LetsGo logo is the sync indicator.** Its badge turns green while
    syncing, amber when Google needs you to reconnect, red on a sync error —
    for **both** Google and the NAS/WebDAV vault. Clicking it does the right
    next thing: reconnect Google, open Settings when Google isn't configured,
    or sync everything now. Settings grows a **Reconnect Google** button and a
    one-time Firefox cookie-exception hint (`components/ui`, `shell/AppShell`,
    `lib/googleSync`).
- **The focus timer keeps honest time now (webapp 0.47.0).** Three linked
  changes so "worked 6 hours" means six hours of work:
  - **Countdown aims at the task.** Focusing a task in Countdown mode sets the
    target to its *remaining* estimate (`estimateMin − loggedMin`, 5-minute
    floor) — a 120-minute task shows `2:00:00`, not a fixed hour. Pomodoro
    stays 25 minutes by definition; editing the estimate while the clock is
    idle refreshes the target (`timerTargetSec` in `lib/store`).
  - **Auto-pause when you step away.** If the timer runs past *Auto-pause when
    away* minutes (Settings → Schedule, default 10) with no interaction, it
    pauses itself — worked time frozen at your last interaction, and the idle
    span logged as a break rather than banked as focus.
  - **A Log tab on the Timer screen.** Every session, worked and paused, grouped
    by day with `worked · paused` totals. A wrong row can be deleted; deleting a
    worked row refunds its minutes to the task (`lib/sessionLog`,
    `screens/TimerLog`).
- **Status check-ins (webapp 0.47.0).** While any task sits in progress, a
  configurable nudge (Settings → Schedule, default every 25 minutes) asks
  whether it is still your focus, with Pause / Mark done / Still on it — the
  antidote to a pile of half-finished tasks nobody closed out
  (`screens/StatusNudge`).
- **A choice of alert sound (webapp 0.47.0).** Settings → Security → Alert sound
  offers Chime (the original), Beep beep beep, Gong (a meditation bell) and
  Marimba, with a Preview button — used for timer-finished and status check-in
  notifications. All still synthesised via the Web Audio API, so nothing is
  added to the download and it works offline (`lib/sound`).
- **Habits became something you can actually read (webapp 0.42.0).** The plugin
  tracked days and showed a 7-day strip plus one 28-day percentage — enough to
  tick, nothing to look back on. Every habit now opens a record:
  - **A contribution heat grid** over 3 / 6 / 12 months, coloured by how much of
    the day's target was met.
  - **A rolling 30-day trend line**, so a year reads as a curve rather than 365
    spikes.
  - **Completion by month, by year and by weekday**, the last of which surfaces
    the insight a streak count structurally cannot — *"Wed is where it slips
    most"*.
  - **Records as headline figures**: current streak, longest run ever (with the
    dates it spanned), lifetime rate, and total ticks.
  - An **overview strip** above today's checklist: last-12-weeks rate, perfect
    days, best run across all habits, and a day-by-day bar for the last 84 days.
  All of it derives on read from the existing `log`, so nothing new is stored
  and no stat can drift from the ticks it summarises (`lib/habitStats.ts`).
- **An emoji picker for habits (webapp 0.42.0).** The field existed but you had
  to bring your own glyph; there is now a curated 30-emoji grid, one tap, with
  the free-text field still there for anything else.
- **Tasks link to habits (webapp 0.42.0).** A practice that is both a scheduled
  task and a tracked streak had to be ticked twice, and a missed second tick
  quietly broke a streak that was really kept. `Task.habitId` binds them, and
  the binding is reflected on **both** edges: completing the task fills the
  habit's day, filling the habit's day completes the task. Settable from either
  side (task editor → Habit, or habit editor → Linked tasks). Completion lands
  on the day the TASK belongs to, so ticking Monday's task on Tuesday credits
  Monday. `skipped` deliberately does not award the day (`lib/habitLink.ts`).

### Fixed
- **Resuming a paused task no longer shifts its schedule (webapp 0.47.1).**
  Starting an overdue task drags it to the present and reflows its tree — a
  deliberate "late start" move. Resuming from a pause went down the same path,
  so a task scheduled at 10:00, paused at 10:25 and resumed at 10:45 jumped its
  start to 10:45 and pushed everything after it. Resume is now excluded from the
  late-start reschedule (`setStatus` in `lib/store`): a held task kept running
  on its original slot, so its card still spans from 10:00.
- **Recurring tasks now obey the board window (webapp 0.46.0).** A repeating
  task — most visibly a yearly birthday or anniversary, or a monthly bill —
  was shown on every date-axis-less view (board, list, Eisenhower, Gantt) all
  year regardless of "how far back / how far ahead", because the window check
  passed every task carrying a `repeat` rule unconditionally. It now keeps a
  routine only when the series actually lands an occurrence inside the window
  (`repeatOccursInRange` in `lib/mdTasks.ts`); an open-ended future still shows
  every routine, and Schedule/Calendar are unchanged since they window by the
  visible dates already.
- **Imported habit history is no longer thrown away (webapp 0.42.0).** Every
  streak, rate and chart walked from `createdAt`, but a habit imported from a
  markdown ledger is created *today* and carries years of log behind it — so
  the import's whole point was discarded and a long-kept habit read as one day
  old. Walks now start at `habitStartMs`: the earlier of `createdAt` and the
  first logged day. A tick on a day is evidence that day happened.
  ⚠️ This changes `currentStreak` for any habit whose log predates its
  `createdAt` — those streaks get *longer*, which is the correct number.
- **CI stopped failing on `Artifact storage quota has been hit`.** Every run
  died on its last step, and because `ci.yml`'s deploy job downloads that
  artifact, the webapp silently stopped deploying to the NAS while `main`
  looked merely red. The bundle now travels from the ubuntu build job to the
  self-hosted deploy job through `actions/cache` (a separate 10 GB-per-repo
  pool) instead of an artifact (billed against the account allowance), with
  `fail-on-cache-miss` so a lost cache is a loud failure rather than an empty
  publish. The APK and Windows-installer uploads — which had no
  `retention-days` and so inherited the repo's 90-day default, and are what
  actually filled the quota — now expire after 7 days.
- **Google Calendar stopped rejecting the same events on every sync (webapp
  0.41.0).** “‘Happy birthday!’ could not be updated in Google Calendar:
  Invalid start time.” arrived once per sync, per event, forever — dismiss one
  and the next appeared. Two causes, both in the push path:
  - Google owns some of the events it lists — contact birthdays
    (`eventType: "birthday"`), Gmail bookings, focus time, out-of-office and
    working-location blocks — and refuses every write to them with that exact
    400. They are strictly pull-only now (`isReadOnlyEvent` in `lib/gcal.ts`);
    the app reads them into the vault and never writes back.
  - An all-day event mirrored as a task kept a stale `scheduledAt`, so every
    sync tried to rewrite it as a TIMED event. `events.patch` merges `start`
    key by key, so the stored `date` survived alongside the new `dateTime` and
    Google rejected the result. All-day tasks are now written as `date` events
    (end day exclusive), pulling an all-day event CLEARS the slot and marks the
    task `allDay`, and every body states the key it does not use as an explicit
    `null` — which is how the API is told to clear it. `gcalApi.insertEvent`
    strips those nulls, since a create has nothing to clear.
- **“When does today start?” works on a day of appointments (webapp 0.41.0).**
  The confirm button was disabled whenever nothing would move — which is
  exactly what happens when every task today is locked, i.e. precisely the day
  you are most likely to be starting late. The answer is always accepted now,
  and `planDayStartOutcome` reports WHY nothing moved (all locked/routines,
  nothing scheduled, or the plan already fits) both in the dialog preview and
  in the confirmation banner.
- **Notes no longer forget which page you were on.** The tab bar navigates to a
  bare `/notes`, so leaving for Todo and coming back reset the editor to the
  first notebook every time. The last page opened is remembered and restored
  (desktop only — on mobile a bare `/notes` is the list, and re-opening a page
  would trap the back button).

### Added
- **`scripts/gh-artifacts.sh` + `docs/ci-artifact-quota.md`.** GitHub offers no
  bulk artifact delete — the web UI removes them one at a time from inside each
  run, which is not a task a human does across hundreds of runs. The script
  lists and prunes artifacts and run logs over the REST API using nothing but
  `curl` and `python3` (dry run by default, `--yes` to arm). The runbook covers
  the same ground by hand, including the raw `curl` calls, for when neither the
  script nor the Actions UI is available — and documents the 6-12 hour usage
  recalculation that makes a successful prune look like it did nothing.
- **All-day Google events arrive as events (webapp 0.41.0).** A birthday or
  holiday pulled from Google is flagged `allDay` with a glyph (🎂 for a contact
  birthday), so the dated views hang it off the day as a notch instead of
  filing it as a bare deadline.
- **Per-event reminder lead time (webapp 0.41.0).** Google's calendar default
  (30 minutes) was the only answer the app could give. Settings → Google
  Calendar now sets the account-wide lead time — at start, 5/10/15/30 min,
  1/2 hours, 1 day, a custom number of minutes, none at all, or the calendar's
  own default — and every task can override it in its editor (Reminder
  section). Pushed as a `popup` override; changing it is a real, pushable
  difference, so an edit reaches Google on the next sync.
- **E-ink theme (webapp 0.41.0).** A fifth theme alongside Light/Dark/System/
  Thermal: electronic paper — a five-step gray ladder on paper white, no hue
  anywhere, hairlines instead of shadows, a serif body face, and zero motion
  (an e-ink panel refreshes; a transition on that hardware is a smear). Like
  Thermal it is an explicit choice — “System” never resolves to it.
- **One place to delete anything in Notes (webapp 0.41.0).** “Select” now puts
  a checkbox on every row — notebook, page and subpage — so a mixed selection
  is deleted in a single confirm, with a live “2 notebooks · 5 pages” summary
  and a guard that keeps the last notebook (a new page needs a home). The tree
  unfolds while selecting so nothing is unreachable.
- **How much to show, for the boards (webapp 0.41.0).** Board, List,
  Eisenhower and Gantt listed the entire vault — a year of finished work in one
  column. Settings → Schedule sets how far back and how far ahead they reach
  (3 days / 1 week / 2 weeks / 1–6 months / 1 year / Everything, independently
  each way), defaulting to Everything so an upgrade never hides work. Undated
  tasks and repeating routines are always shown, a project stays visible while
  any task inside it does, and the board says how many trees are outside the
  window. Schedule and Calendar are untouched — they are their own date axis.
- **Note layouts after the fact, and one you write yourself (webapp 0.41.0).**
  A page's layout could only be chosen at creation. The editor now has “Change
  layout”, which is non-destructive by contract: an empty page is replaced, a
  page with content keeps every word and gets the layout's sections appended
  below a rule. Settings → Plugins → Notes adds “Ask which layout every time”
  (so every “+”, not just the sidebar's, opens the chooser) and a custom layout
  you author yourself, with `{{title}}` and `{{date}}` placeholders, offered
  alongside the built-ins and settable as the default.
- **Habit tracker plugin (webapp 0.40.0, all shells).** Seventh plugin
  (`habits`): daily/weekday habits with per-day tick targets ("drink water
  ×8"), streaks that skip non-due days and don't zero out before today is
  over, a Today checklist, a tappable current-week strip (fix yesterday's
  log, not yesterday's habit), 28-day completion rates, archive/restore,
  and a Dashboard card (done/due today, 7-day consistency, longest run)
  that renders nothing when the plugin is off — the Reading/Goals contract.
  Markdown compatibility both ways (`lib/habitsMd.ts`): export writes a
  hand-editable ledger (`## 🌅 Wake up by 6` / `- days: daily` /
  `- 2026-08-07: 1`), re-import reconciles by habit name and merges ledgers
  day-wise by max so a re-import never erases ticks recorded meanwhile.
  Model in `lib/habits.ts` + reducer actions, 17 new tests; day math steps
  through noon so DST can't skip or double a day.
- **Android widgets & plugin-catalog designs** (`docs/design/`): widget
  lineup around a plaintext opt-in snapshot (the vault key never leaves the
  app), and a three-stage catalog path (catalog of built-ins → hash-pinned
  remote ESM plugins → converge on the Tauri manifest format).

### Fixed
- **Task search actually finds tasks (webapp, all shells).** The board
  filter tested root titles only, so any nested subtask — which is most
  tasks after a markdown/iCal import — was unfindable and search read as
  completely broken. `lib/taskSearch.ts` matches the whole subtree (title
  or `#tag`, case-insensitive, `#`-stripped against bare stored tags) and
  keeps the parent visible; Gantt now honors the same filter via the
  matched-subtree id set, and the search box no longer renders on
  Schedule/Calendar where it silently did nothing.
- **`lateStartReducer` tests were time-of-day flaky** — "an hour from now"
  crossed midnight when the suite ran late in the evening; the clock is now
  pinned to mid-morning with fake timers.

### Added
- **Android app of the webapp — Capacitor shell (`webapp/android/`).**
  The identical Vite bundle now builds into an installable APK
  (`pnpm android:apk`), phones and tablets — same screens, themes, accents,
  touch drag and logic as the browser, chosen over a Tauri Android target
  because the machine still has no Rust toolchain and the Electron desktop
  shell set the precedent of wrapping the web bundle unchanged. Native
  bridges cover only what a WebView can't do (`webapp/src/lib/native/`,
  branch on `isNative`; web builds take none of these paths): the vault's
  localStorage is mirrored into SharedPreferences and restored on boot so
  WebView eviction can't eat data; notifications go through
  `@capacitor/local-notifications` with timer banners OS-scheduled at the
  target instant (they fire while the app sleeps — stronger than the web's
  setTimeout); exports (JSON/markdown/HTML) write to cache + share sheet in
  place of the WebView-dead `<a download>`; the Library's "Save as PDF"
  prints through a 50-line bundled `PrinterPlugin` (PrintManager); NAS
  WebDAV sync and team-mode `/api` ride the native HTTP stack re-anchored to
  the deployed origin (no CORS work on the NAS, no Basic-auth popup, MKCOL
  treated as advisory since Android's stack rejects custom verbs); Google
  sign-in swaps popup-based GSI for the installed-app Custom-Tab PKCE flow
  with refresh tokens (silent renewals — needs a one-time Android OAuth
  client, see `webapp/ANDROID.md`); the status bar follows theme + accent;
  hardware back pops the hash router then minimizes; the stale-deploy
  UpdateBar is disabled (updates are APKs). Launcher icons/splash are
  generated from the icon design via `scripts/make-android-assets.mjs` +
  `@capacitor/assets` (the ▸▸ chevrons redrawn as paths — the SVG's
  JetBrains Mono `<text>` doesn't survive rasterizers without the font).
  Toolchain that got installed for this: Temurin JDK 21 (`~/.local/opt/jdk`),
  Android SDK platform/build-tools 36 (`~/Android/Sdk`).

### Fixed
- **Android: "Restore from your NAS" failed with `Unexpected token '<' …
  is not valid JSON`.** Two causes, both Android-only: the relative
  `/webdav` default is the *desktop shell's* proxy path — inside the APK it
  falls through to the SPA and answers with `index.html` — and even a full
  NAS URL would then hit WebView CORS the NAS never answers. The Tauri
  backend (0.54.0) now ships `tauri-plugin-http` (with an http/https URL
  scope in the default capability), and the webapp's WebDAV layer
  (`webapp/src/lib/sync.ts`, 0.39.0) routes absolute-URL fetches through
  it when running inside Tauri — Rust-side HTTP, CORS-exempt; browser and
  Electron sessions keep the platform fetch and never load the plugin
  chunk. UX: in the APK the Unlock restore form starts with an empty URL
  field, a `https://your-nas/webdav` placeholder and a hint to use the
  NAS's full (e.g. Tailscale) address; an HTML-instead-of-JSON response now
  reads "that URL answered with a webpage, not the vault" instead of a
  JSON parse error.

### Changed
- **Android APK now wraps the webapp, not the desktop frontend
  (`src-tauri/tauri.android.conf.json`).** The Android lane previously
  bundled the desktop `src/` UI; the intended mobile experience is the
  webapp (touch layout, bottom tab bar, mobile sheets). Tauri's
  platform-specific config override points the Android build — and only
  the Android build — at `webapp/dist`, with the before-build command
  building the webapp; desktop `tauri.conf.json` is untouched. The webapp
  is local-first, so it runs standalone in the Android WebView; the NAS
  `/api`/`/webdav` same-origin proxy that the Electron .deb provides does
  not exist in the APK, so team mode/NAS sync are unavailable there until
  a mobile equivalent lands.

### Added
- **Webapp: Thermal theme — a receipt-printer third theme
  (`webapp/src/theme.css`, Settings → Appearance).** Joins Light/Dark/System
  as an explicit choice ("system" never resolves to it): warm thermal-paper
  surfaces on a darker counter ground, one near-black ink for the whole
  accent family, the classic two-color-printer red as the only second ink
  (skipped/danger/now-line/bookmark), JetBrains Mono for every face, zero
  corner radius, and hard ink-offset shadows with no blur. It is an
  expression change, not a palette swap: nothing animates (no card
  hover-lift, button lift, knob glide, pulse ring, or unfurl — state
  stamps), the segmented control's active option becomes an inverted ink
  block, the toggle loses its "one rounded exception" and squares off,
  action-button and tab labels print uppercase (user content is never
  re-cased), pills/tags/chips/status dots square into ticket stubs,
  structural seams (tab bar, gantt header/rail, table heads, editor
  sections, markdown rules) go dashed, text selection inverts ink-on-paper,
  and status hues collapse onto an ink-weight ramp. Sticky-note tints and
  all-day-event sand flatten onto paper; the accent picker is bypassed
  under thermal (a hint in Settings says so); FocusMode and ScanMode keep
  their forced-dark islands. Theme picker gains a fourth preview card.

### Added
- **Thermal theme — a third theme alongside light and dark
  (`src/designSystem/tokens.css`, `thermal.css`).** A receipt-printer
  aesthetic: warm thermal-paper surfaces on a darker "counter" ground, one
  near-black ink for text/accent/chrome, and the classic two-color-printer
  red as the only second ink (skipped/danger). Everything renders in
  JetBrains Mono, corners square off (`--radius-*: 0`), and shadows become
  hard 1-px ink offsets — the overlay layer gets a paper-on-paper hard drop
  with a full ink outline. Status hues collapse onto an ink-weight ramp
  (pending faint, in-progress heavy black, done mid-gray, skipped red), and
  the primary-button lane becomes the solid inverted block of a receipt
  banner. The theme is a full expression change, not a palette swap —
  `thermal.css` is a receipt EXPRESSION layer scoped under
  `:root[data-theme="thermal"]`: motion is eliminated (print stamps — no
  sliding tab highlight, no gliding switch knob, no fading popovers, no
  growing chart bars, no hover-lift; `--press-scale` 1, motion tokens
  0 ms), the segmented control's active tab becomes a solid inverted ink
  block with the label knocked out in paper, the pill switch squares into a
  mechanical stamp toggle (geometry preserved so the knob travel still
  fits), every decorative pill/circle squares into a ticket stub (status
  badges, tags, estimate chips, routine-day chips, priority badges,
  mindmap pills, color swatches, the calendar's today circle becomes a
  boxed invert), section titles across board columns, trays, quadrants,
  dashboard and editors become tracked-uppercase labels on dashed rules,
  action-button labels print uppercase (user content is never re-cased),
  the calendar month grid rules turn dashed, dashboard chart geometry
  squares off, notes sticky tints collapse to ink washes plus the red
  second ink, and text selection inverts ink-on-paper. Deliberately kept:
  the timer's circular dot-matrix LEDs (that IS the printer aesthetic),
  the roller-picker's odometer motion, and focus mode's forced dark theme.
  The titlebar toggle now cycles light → dark → thermal (glyph previews
  the destination: ☾ / ▤ / ☀); a stored `thermal` choice survives
  restarts, and first-run behavior still follows the OS dark/light
  preference.

### Changed
- **Webapp dark theme reworked — "midnight indigo" (`webapp/src/theme.css`).**
  The old dark theme was the light palette inverted onto neutral grays
  (`#0c0c11 → #17171e → #20202a`), which read as one bland sheet. Every
  ground step now carries a blue-violet cast (`#0b0d16 → #131625 → #1b1f33`)
  with matching tinted dividers, text and grid/dot/paper patterns; the accent
  family lifts a step in luminance and chroma (violet `#9d85f8 → #a78bfa`,
  soft blocks 16% → 20%, glows stronger), status hues brighten to match, and
  the hero wash gains a second deep-blue bloom so large surfaces stop reading
  flat. Contrast floors kept or improved: text-2 7.3:1 and text-3 5.6:1 on a
  card. The four alternate accents' dark variants and the all-day-event sand
  were retuned onto the new ground; Settings theme/accent swatches updated.

### Fixed
- **Desktop shell: dock/taskbar showed a generic icon (`packaging/electron/`).**
  On Wayland, GNOME picks the running app's icon by matching the window's
  app-id against the desktop file; Electron wasn't announcing one, so the
  window never linked to `letsgo-webapp.desktop`. The shell now passes
  `--wayland-app-id=letsgo-webapp` and sets an explicit window icon for X11
  sessions.

### Added
- **Desktop .deb of the web app — Chromium shell + NAS proxy
  (`packaging/electron/`).** The 0.35.0 browser-launcher package (below) is
  replaced by a real desktop app: the identical Vite bundle rendered by
  Electron/Chromium — chosen over a Tauri/WebKitGTK shell precisely so
  service-worker notifications, camera ISBN scanning, WebCrypto and Google
  sign-in behave exactly as in the browser (also: the machine currently has
  no Rust toolchain). A bundled localhost server (`server.cjs`, node
  built-ins only, 10 tests) serves the app on the fixed origin
  `http://localhost:8637` and reverse-proxies **`/api` and `/webdav`
  same-origin to the NAS** (default `https://letsgo.example.com`,
  override via `~/.config/LetsGoWeb/config.json` or `$LETSGO_NAS_URL`) —
  required because the team backend has no CORS and a `SameSite=Lax`
  cookie; the proxy also strips the cookie's `Secure` flag so sessions
  survive the localhost origin. Team mode: leave Login's "Server URL"
  empty. The deb (same `letsgo-webapp` package name, so it upgrades over
  0.35.0) carries a postinst AppArmor `userns` profile for Ubuntu 24.04+'s
  sandbox restriction. Build: `packaging/electron/build-deb.sh`.

- **Debian package for the web app (`packaging/deb/`) — superseded by the
  entry above before ever shipping.** `packaging/deb/
  build-webapp-deb.sh` builds `letsgo-webapp_<version>_all.deb`: the static
  Vite build under `/usr/share/letsgo-webapp` plus a python3-stdlib launcher
  (`letsgo-webapp`) that serves it on `http://localhost:8637` with an SPA
  fallback and Vite-correct cache headers (assets immutable, `index.html`
  no-cache), opens the default browser, and reuses a running instance
  instead of double-binding. Architecture `all`, Depends only `python3` —
  installs on any Debian/Ubuntu machine, fully offline (fonts are bundled).
  Desktop entry + icon included; the optional team backend (`server/`) is
  deliberately not packaged (webapp/DEPLOY.md §5 covers it).
- **Overnight cards continue into the next day (`webapp/`).** A task crossing
  midnight (22:45 sleep → 06:45) used to exist only in its start day's
  column, clipped at 24:00. The clipped remainder now renders at the top of
  the next day's column as a continuation card — dashed top edge, `⤷` title
  prefix, display-only (no drag/resize), and its status square reads and
  writes the occurrence of the day it STARTED on, so marking last night's
  sleep done never touches tonight's. (`carrySegmentMs`,
  `webapp/src/lib/scheduleGeometry.ts`)

- **Schedule zoom + half-hour gridlines (`webapp/`).** A fully packed day was
  unreadable at the fixed 54px/hour rows. The schedule toolbar gains −/+
  zoom buttons (42–126px per hour, persisted per device); zooming keeps the
  time under the viewport's center fixed instead of snapping back to 07:00,
  and every hour row now carries a faint half-hour ruling so tightly packed
  cards stay scannable. (`zoomHourH`, `webapp/src/lib/scheduleGeometry.ts`)

### Fixed
- **Starting a late task no longer reschedules it onto tomorrow (`webapp/`).**
  On a fully locked routine day (Parivartan: every block locked, ending in an
  overnight sleep), pressing "start" on an overdue task pulled it to "now",
  and the locked-block avoidance then hopped it over the entire remaining
  wall of appointments — landing the card on TOMORROW 06:50, marked active,
  with the timer running today. The late-start pull now abandons the move
  whenever the first conflict-free slot falls on a different day than "now"
  (locked wall or shut work window alike): the task keeps its slot and simply
  goes active where it was planned. (`planLateStart`,
  `webapp/src/lib/estimate.ts`)

- **Schedule cards no longer overflow the day grid (`webapp/`).** A task
  whose duration crosses midnight (an overnight sleep block, a long block
  near the bottom of the day) rendered its full height past the 24:00 line,
  spilling into the empty space below the grid. Card and blocked-time-slot
  heights now clip at the day's bottom edge; the remainder belongs to the
  next day's column. (`visibleCardMinutes`, `webapp/src/lib/scheduleGeometry.ts`)

### Added
- **"A newer version is available" banner (`webapp/`).** An installed PWA (or
  a tab that never closes) can keep running a weeks-old bundle: new note
  features then render as raw markdown on that device while a fresh browser
  shows them properly — which reads as cross-device data corruption. The app
  now re-checks the deployed `index.html` on focus (and half-hourly),
  compares the build-hashed entry script against the one it's running, and
  offers a one-click Reload when they differ.

- **Hideable notes workspace pane (`webapp/`).** A chevron in the pane header
  collapses the notebooks/pages sidebar to a slim rail, giving the editor and
  markdown views the full width; the choice persists across sessions.

- **Drawing pad paper styles (`webapp/`).** The sketch surface can now be
  plain, grid, dotted, ruled, or checked — picked from the toolbar, stored in
  the drawing's JSON so the ruling travels with the note. Papers are CSS
  backgrounds behind the transparent canvas, so the eraser reveals the ruling
  instead of punching holes and the saved drawing doesn't grow.

- **New pages land where you're working (`webapp/`).** The notes "+" button
  used to file every new page under the first notebook ("Work") no matter
  what was open. It now creates in the notebook of the note you're viewing,
  and every notebook row in the sidebar has its own "+" to create a page in
  that notebook directly.

### Added
- **Claude web-search rescue for unindexed books (`webapp/`).** When a book is
  in neither Open Library nor Google Books and the title search finds nothing
  — the regional-reprint case — the resolver now asks Claude to find it on
  the open web (the API's server-side web search tool), if a Claude key is
  set in Settings → Library. The model's answer is validated like the
  cover-photo path (ISBN checksum, year sanity, wrong-book title guard),
  then fed back through the free databases so covers and metadata come from
  the stable sources, with the web answer filling only what they lack.
  Records filled this way are stamped `provider: "web"` for later
  re-checking, and the Settings "Last lookup run" card counts them
  separately ("N via Claude web search"). Costs a few cents per rescued book
  on the user's own key; fires only for books everything else gave up on.

### Changed
- **Book lookup switches strategy by itself (`webapp/`).** When an ISBN is in
  neither Open Library nor Google Books, the resolver now runs the title
  search automatically and applies a hit only when its title plausibly IS the
  book — instead of printing "use the title search or a cover photo" at the
  user. The shelf's one-liner distinguishes the two honest outcomes: "N not
  in the databases — add manually!" (both providers answered; typing is the
  only path) and "error fetching N — details in Settings → Library". The
  details actually live there: a "Last lookup run" card lists the run's
  counts and every distinct failure reason, and auth/quota failures
  (401/403/429, Google's error envelope) additionally raise a warning banner
  beside the API-key field. Saving a key or a later clean run clears it.

### Fixed
- **Dark mode made the drawing pad's default ink invisible (`webapp/`).** The
  paper follows the theme (near-black in dark) while the pen palette stored
  fixed hexes in each saved stroke — so the default near-black pen drew at
  ~1.06:1 contrast. The default pen is now "ink": painted with the theme's
  live text color, so it is dark-on-light and light-on-dark automatically.
  Legacy strokes saved with the old literal hex are mapped onto the same
  behaviour — pixel-identical in light mode, readable in dark.

- **Bookmarks now hang from every book (`webapp/`).** The ribbon only
  appeared on books marked "reading" or already bookmarked, so on most books
  there was nothing to click to set a page. Every cover and list row now
  shows the ribbon — a muted "+" invite until a page is set, the page number
  once it is.

- **The note margin rule now looks draggable and stays under the toolbar
  (`webapp/`).** The Word-style margin stop was a bare 2px line — nothing
  said "drag me" until you happened to hover it — and, spanning the whole
  scrolled column at the toolbar's z-index, it painted over the sticky
  formatting bar when scrolled. It now wears a slim grab pill (scrollbar-thumb
  sized, centered on the line so it never crowds the first line of text) at
  the top of the rule and sits below the bar's stacking level.

- **Tighter notes editor chrome (`webapp/`).** The Goal/tag chips moved into
  the formatting bar's right end (the markdown view, which has no bar, keeps
  their own row) — one full chrome row saved above every note. The dead space
  left of the line numbers is halved, and the margin rule's grab cue slimmed
  from a 14px dotted tab to a scrollbar-thumb pill centered on the line, so
  it no longer crowds the first line of text.

- **The schedule's "now" dot sat below its line (`webapp/`).** The current-time
  marker's dot was positioned from the line element's padding box, which sits
  under the 2px border that draws the line — a 2.5px vertical offset. The dot
  is now centered on the line itself.

- **Visual consistency pass across the webapp (`webapp/`).** Four smaller
  look-wrong-on-screen issues found in the same audit:
  - The mindmap's collapsed-count badge paired `--on-accent` text with the
    amber `--st-pending` fill — white-on-amber (≈1.9:1) in light mode, fine in
    dark. Amber stays light in both themes, so the badge now uses a fixed dark
    ink.
  - Markdown/note-block checkmarks were hardcoded white on the done-green
    fill, which fades on dark mode's lighter green; they now use
    `--on-accent`, which flips to dark ink exactly when the green lightens.
  - The schedule's "now" line was an off-palette literal (`#e5484d`) that
    never adapted to dark. It is now a `--now-line` token (with a dark
    variant), documented as deliberately clear of the rose/crimson
    status-and-priority hues.
  - Corner radii in inline styles drifted (6/7/8 px on like controls, literal
    12/14 on cards). A `--radius-sm: 6px` token now anchors small
    chips/menu-rows/buttons, and card-like surfaces use `--radius-card`
    (Kanban columns, dashboard task rows, scan viewfinder) or `--radius`
    (scan hint panel, mindmap minimap) instead of magic numbers.

- **Guided entry kept suggesting a field it had just inserted (`webapp/`).**
  Accepting the `!P1` suggestion, typing a space and pressing Tab again put a
  second `!P1` on the line — and a third, and a fourth.

  The tokenizer that reads a task line's metadata was anchored hard to the end
  of the string, so a token only counted if it was the very last character. A
  single trailing space made the **whole** metadata tail unparseable. Guided
  entry only offers a suggestion on a line that ends in a space — so the
  parser was blind at precisely the moment the editor asked it which fields
  were already stated, and it answered "none" every time.

  Trailing whitespace no longer ends the metadata. As a side effect, any line
  with a trailing space now renders its tokens dimmed and round-trips
  correctly, which it did not before.


### Fixed
- **"Not in any database" was sometimes a guess (`webapp/`).** Resolve ruled a
  book out if *either* provider replied — but Open Library answers a miss with
  HTTP 200 and an empty object, so it "replies" on virtually every lookup with
  a live network. A rate-limited or misconfigured Google Books was therefore
  invisible: the app confidently reported "not in any database" having
  actually consulted one database.

  That matters because the two outcomes call for opposite responses — type the
  details in by hand, or go fix your API key — so reporting the wrong one
  sends you off doing work you didn't need to do. Ruling a book out now takes
  **both** providers answering; anything less reports which one went missing
  and says the book isn't ruled out yet.

### Added
- **Three fixes for books the scanner can't identify (`webapp/`).** "Not
  recognised" turned out to be two different failures, and the biggest one was
  not the books at all.

  **Google Books was answering 429 to every single lookup.** Not just obscure
  titles — everything, verified against the live endpoint. The unkeyed API
  shares one daily quota across every anonymous caller from an IP, so once it
  is exhausted the whole fallback is dead and Open Library is the only source
  left. Settings → Library now takes a **Google Books API key**, which moves
  the app onto its own 1,000 lookups a day. The rate-limit message says so
  instead of suggesting you try again in a minute, which was a lie: the shared
  quota does not recover in a minute.

  **The camera got the controls it was missing.** A torch toggle (a glossy
  cover under indoor light is the single most common reason a barcode won't
  decode), a zoom slider, and tap-to-refocus — each offered only where the
  hardware actually reports it, since a dead toggle is worse than no toggle.
  And when nothing has decoded for a while the scanner now *says so* and
  points at the manual ISBN field; before, a barcode that genuinely could not
  be read looked exactly like not aiming properly.

  **Photograph the cover when no database has the ISBN.** Regional editions
  whose ISBN was never registered are absent from every free database at any
  price tier — but the title is printed on the front. With a Claude API key
  set, the scanner and the book editor can both read a cover instead. The
  result is offered for checking rather than applied silently, a model-supplied
  ISBN is discarded unless it passes its own checksum (a wrong ISBN would
  quietly attach the record to a different book), and an implausible year is
  dropped rather than stored.

  Both keys are held in localStorage on the device they were typed on and are
  **never written into the vault** — so they do not sync to the NAS, do not
  reach other devices, and are not in the Settings JSON export. That is the
  rule `GoogleAccount` already states for Google tokens, applied here too.

### Fixed
- **Scanning a book twice no longer adds it twice (`webapp/`).** The scanner
  only ever de-duplicated within a single session, and `upsertBook` matched
  records by id — but every scan mints a fresh id, so cataloguing a shelf
  across two sittings quietly produced a second copy of everything re-scanned.

  Identity is now the ISBN (or, without one, title plus lead author folded to
  ignore case, accents and punctuation), and the reducer merges on it. That
  closes the hole for **every** entry point at once — scan, manual add, editor
  save and CSV import all pass through the same place — and the merge keeps
  whatever the user curated: a rating, note, shelf or bookmark is never
  overwritten by a machine-supplied value, and the furthest-read bookmark
  wins. Re-scanning a book you already own now says **"already have it"**
  instead of doing nothing visible, and the session summary counts those
  separately from books still filling in.

  Duplicates created before this fix are still in the vault, so the Library
  offers a **Merge N duplicates** button whenever it finds any.

- **The plugin drag handle in Settings now actually drags (`webapp/`).** The
  grip on each row in Settings → Plugins showed a `grab` cursor and had no
  drag behaviour behind it at all — there was no stored order to change. Rows
  can now be reordered by dragging, and the order drives the sidebar and the
  mobile tab bar, which is the point of it. Both input paths are wired: HTML5
  drag for a mouse and a long-press for touch, because mobile browsers never
  fire drag events from a finger. The stored order is self-repairing — a
  plugin it does not mention is appended rather than hidden, so adding one in
  a later release can never make it invisible to someone who had reordered.

### Added
- **Export the library as PDF or HTML (`webapp/`).** A download button in the
  Library header writes a standalone catalogue — one file, no external
  stylesheet, no font request, nothing to fetch, so it still opens years later
  on a machine with no network. PDF is the same document handed to the
  browser's print dialogue rather than a bundled PDF writer, which would have
  cost more than the whole Library feature; it prints from a hidden iframe
  because Android Chrome blocks popup windows aggressively. The export follows
  what is on screen: current filter, current grouping, and a line saying so
  when it is only part of the shelf.

- **Group the library by author, publisher, year, title or status
  (`webapp/`).** A "Group by" control beside the sort, in both toolbars, with
  a counted heading per section. Grouping and sorting compose rather than
  fight — "group by author, sort by year" does what it says. Unknown buckets
  always sort last, because a real shelf of a few hundred books always has
  records missing a publisher or a year and an "Unknown" heading at the top
  would push the actual content off the first screen. Years read newest-first;
  status reads in reading order (Reading, Unread, Read, Did not finish) rather
  than alphabetically.

- **Reading progress on the dashboard (`webapp/`).** How many books are owned,
  what share has been read, and how many are under way — with a stacked bar
  and a legend. Abandoned books are counted separately from finished ones
  rather than rolled together, since that would flatter the number being
  moved. Pages read are shown only when page counts exist, alongside how many
  books they cover, because a good share of a real shelf has no page count at
  all. The card renders nothing when the Library is disabled or empty, so the
  dashboard is unchanged for anyone not using it.

- **A bookmark ribbon on every book, and a mobile Library toolbar that fits
  (`webapp/`).** Two changes to the Library.

  A red cloth ribbon now hangs off books you are reading, in all three views,
  carrying the page you are on. Click it and type a new number. It is
  deliberately kept clear of the rose used for "did not finish" — a bookmark
  marks a place, not a verdict — and it only appears on books being read or
  already bookmarked, so an unread shelf stays quiet. Where the page count is
  known, a hairline along the foot of the cover shows how far through you are;
  where it is not — the common case for the regional and small-press editions
  neither Open Library nor Google Books carries — there is simply no bar
  rather than a wrong one. Setting a page on an unread book starts it, since
  that is plainly what putting a bookmark in means. The same field is in the
  book editor. An empty field takes the bookmark out, which is why "no
  bookmark" and "page 0" are stored as different things.

  The mobile toolbar was one long horizontal scroll strip — search, status,
  every shelf, every tag, sort and layout on a single line — so on a 360px
  phone most of it sat off-screen with nothing to suggest it existed. It is
  now split by how often each control is touched: search on its own full-width
  row, reading status on a row that scrolls by itself, and the
  set-once controls (shelves, tags, sort, layout) behind a **Filters**
  disclosure that shows how many are active. Books a scan captured but never
  filled in get a banner with a **Resolve** button instead of a chip lost off
  the right edge — after a scanning session that is the next thing to do.

- **Google sign-in stops popping up on its own (`webapp/`).** A window kept
  appearing and closing by itself, and sometimes needed an "OK" click. Three
  things compounded: the calendar sync ran on **every window focus** — so
  alt-tabbing back to the browser triggered one — plus every five minutes and
  on mount; and whenever the cached token had expired it asked Google for a new
  one. Google's "silent" renewal is not silent: `prompt: ""` still opens a
  popup, and a browser that requires a user gesture (Firefox) shows a
  blocked-popup prompt instead — the one needing a click.

  The focus listener is gone; the five-minute timer already keeps things
  current and **Sync now** covers wanting it immediately. Background sync never
  asks for a token now — it reports that a sign-in is needed and renewal
  happens on a click, where a popup is expected. A signed-in token still lives
  in sessionStorage, so it survives a reload and only a new tab starts over.

- **The Library scanner now works in Firefox, and books it can't find are
  actually finishable (`webapp/` 0.32.0).** Two problems found on a real shelf
  of Indian books.

  **Firefox and Safari can now scan.** Only Chrome ships `BarcodeDetector`, so
  everywhere else fell back to typing. A WASM decoder now fills the gap behind
  the identical API, loaded with a dynamic import so Chrome never downloads it
  — it is a separate 43 KB chunk plus a 1.07 MB WASM asset that the fast path
  never touches. Verified by decoding real photographs of the books in
  question: both barcodes read correctly.

  **"Not found" no longer means "we couldn't check".** Google Books' unkeyed
  endpoint shares one daily quota across every anonymous caller, and its 429
  reply carries no `totalItems` — which the old code read as *zero results*.
  Holding a real book and being told it does not exist is the worst possible
  answer, so a lookup now reports found / not-found / unavailable separately,
  and only a provider that actually replied can rule a book out.

  **Books with no database entry are now finishable in a few taps.** India-only
  reprints (a Wiley India edition, say) and small regional publishers get
  printing-specific ISBNs that were never indexed, even when the work itself is
  well known. A card that misses now says *"Tap to add details"* rather than
  showing 13 digits where a title belongs, and the editor opens with a **title
  search**: type a few words, pick from the results, and author, publisher,
  year, page count and cover all fill in. Open Library's search index is tried
  first — it is far broader than its ISBN index and is not subject to Google's
  quota.

  **List view, bulk actions, and drawn covers.** The cover grid was the only
  layout; at a few hundred books that is good for browsing and poor for
  finding. There is now a **List** layout beside it — about twice the rows per
  screen, with author, year and shelf always visible — and the choice is
  remembered per device. Mobile defaults to the list, since a phone fits about
  four covers at a time.

  Rows carry checkboxes with shift-click range select, and a floating action
  bar does **bulk delete**, bulk status and bulk shelf. Previously deleting a
  dozen mis-scans meant opening and confirming twelve books one at a time.

  Books without a cover now get a **drawn one** — a spine, publisher rules and
  a geometric mark derived from the title, so no two look alike and none look
  like a failed image load. Small and regional publishers rarely have cover
  images on file, so on a real shelf this is a common state rather than an
  edge case.

  Also fixed: **clicking a book on desktop did nothing.** The editor was only
  mounted in the mobile layout, so the whole desktop edit path — including
  fixing the very books that failed to resolve — was unreachable.

  Also corrected: Open Library returns cover-*ID* URLs, not ISBN URLs, so they
  cannot be rebuilt from the ISBN and are now stored. They had been discarded
  on the assumption that every Open Library cover was derivable.

- **Free-text timer durations with units (`webapp/` 0.31.0, desktop timer
  plugin).** The custom-timer field was minutes-only — a number input in the
  webapp, a 1–120 minute roller on the desktop deck, so a 10-second timer was
  impossible. It is now a text box that reads units: `10s`, `25m`, `1h`,
  compound entries like `1h30m` or `1h 30m 15s`, long spellings (`45 sec`,
  `2 minutes`, `3 hours`), and fractions (`1.5h`). A plain number still means
  minutes, so nothing typed into the old field changes meaning. The parse
  result is echoed live under the box (`= 1h 30m`), unreadable text shows the
  accepted formats and disables Start, and durations are capped at 24h. The
  preset chips (5m/7m/10m/25m in the webapp, Focus 25m / Break 5m / Away on
  the desktop deck) are unchanged. On the desktop deck an empty box still
  starts an open-ended count-up timer.
- **Dark mode has depth again, and sub-AA text is fixed (`webapp/` 0.31.0).**
  Dark mode read as one flat sheet for a measurable reason: `--color-surface`
  and `--color-card` were the *same hex*, so a card sitting on a panel had no
  edge at all. Dividers were worse — `--color-divider-soft` sat at 1.02:1
  against a card, which is invisible.

  There is now a real elevation ladder — background → surface → card, each
  about 1.1:1 above the last — so cards lift without the UI looking striped.
  Dividers went to 1.31:1 and 1.14:1, and `--color-text-3` from 3.32:1 to
  **4.86:1**, clearing the 4.5 AA floor it had been under.

  Light mode had two genuine misses: `--color-text-3` (placeholders, meta,
  em-dashes) at **2.67:1** and `--color-text-2` at 4.39:1, both under AA. They
  are now 3.83:1 and 5.71:1, and the page ground dropped a step so white cards
  actually read as raised.

  Accents, status colours and the violet identity are untouched — this is a
  contrast and elevation fix, not a restyle. Several values that hardcoded the
  old background hex (`--accent-soft` across all five accent families, the
  event tint, the segmented-control track, priority and count chips) now track
  `var(--color-bg)` or sit on the new ladder, so they cannot drift again.
- **Library: a digital shelf for physical books (`webapp/` 0.31.0).** A sixth
  plugin, for cataloguing a real bookshelf without the per-book cost that makes
  people give up on it.

  **Scanning** is the point. Point the phone at the barcode on the back of a
  book and it lands on the shelf in about two seconds — the reticle flashes
  green, a short blip sounds, and you move to the next spine. Live EAN-13
  capture uses the browser's own `BarcodeDetector`, so there is no decoder
  library and no new dependency; it needs Chrome on Android, and everywhere
  else falls back to typing.

  A scanned book is **saved before its metadata is fetched**. Scanning a shelf
  with no signal still produces a complete shelf — those records carry their
  ISBN as the title until the toolbar's **Resolve** button fills them in. There
  is no queue to lose and nothing to reconcile if the tab closes mid-shelf.

  Rejected reads are silent by design: a shelf holds boxed sets carrying UPC-A
  barcodes, magazines carrying a 977-prefixed ISSN, and price add-ons printed
  beside the ISBN, all of which the camera will happily read. Only real book
  barcodes are accepted, and only accepts make a sound — otherwise the phone
  would beep continuously at whatever it was pointed at. Dedupe is permanent
  within a session, because the detector fires the same value twenty-plus times
  a second while you hold it on one spine.

  **Manual ISBN entry sits on the scanner permanently**, not just as a
  fallback. It is how a missed spine gets typed without leaving the screen, and
  it makes a cheap USB or Bluetooth barcode wedge work with no extra code.

  **Import** takes a Goodreads, StoryGraph or LibraryThing CSV, handling the
  armour each one wraps ISBNs in to stop Excel eating the leading zero. Nothing
  commits until the counts are shown, and a re-import fills gaps without ever
  overwriting a rating, note, shelf or tag you set.

  **Browsing** is a cover grid with search (title, author, ISBN — hyphens and
  accents both work), status/shelf/tag filters, six sorts, and per-book
  tracking: status, whole-star rating, start and finish dates, shelf location,
  tags and notes. Metadata and covers come from Open Library, falling back to
  Google Books; both are free and keyless, so nothing is stored in settings.
  Covers are derived from the ISBN rather than stored — the whole vault lives
  in localStorage, and 400 embedded images would not fit.
- **Migration is now a single tested function (`webapp/`).** `hydrateState` in
  `lib/migrate.ts` replaces three copies of the same `??=` normalisation at
  each load path, and covers a fourth that had none: the JSON-import path
  dispatched a parsed file straight into the store, so any export taken before
  a field existed arrived missing it. It also deep-merges `settings.plugins`,
  which fixes a latent bug where a newly added plugin id arrived `undefined`
  for every existing vault and the plugin silently never appeared.
- **All-day events, hung off the date as a notch (`webapp/` 0.30.0).** A
  birthday or an anniversary is not a task with a start time — it is a property
  of the **day** — so it no longer pretends to be one. Any task can be turned
  into an all-day event from the editor's new **All-day event** section: flip
  the switch, pick a **kind** (Birthday, Anniversary, Holiday, Celebration,
  Bill, Appointment, Trip, Other) and an **emoji**, and it stops competing for
  space in the task stream.

  Wherever a view shows a date, the event now hangs directly beneath it as a
  small sand-tinted tag notched up into the date. Collapsed it shows **only its
  emoji**, so a month stays readable; hovering or focusing it **unfurls** the
  full name and its repeat ("🎂 Priya's birthday · yearly"). The tag is drawn
  as a floating copy at the nub's own coordinates, because month cells, day
  headers and the gantt axis all clip their overflow — a Saturday birthday in
  the last column would otherwise be cut in half. Three notches fit a day
  before the rest roll into `+n`, so the row never wraps and never pushes the
  day's real work down.

  - **Calendar** — a notch under each day number; on mobile, the event's emoji
    takes the day's marker slot and the day list gains a tappable event row.
  - **Schedule** — a notch under the day label. An event never claims an hour
    slot, so it cannot collide with a time block or make a day look busy.
  - **Gantt** — a notch under the date at day scale, plus a faint dashed rule
    down the track body, so you can see which bars run *through* the event.
  - **List, Kanban and Eisenhower** — no date axis to notch, so an event leads
    with its emoji and carries an **all day** tag where a time would be.

  Events are ordinary tasks underneath, so they keep tags, notes, sub-tasks,
  search, the markdown round-trip and per-day status. The switch is
  deliberately **lossless**: turning a task into an event keeps its scheduled
  time and merely ignores the clock, so switching back restores it.
- **Yearly repeats.** The repeat unit set was daily/weekly/monthly, which made
  the one routine an event most needs impossible to express. `Yearly` now joins
  it everywhere — the editor's Repeat control, the `@every(1y)` markdown token,
  the `[block]…[1Y]` time-block token, and iCal/Google Calendar import
  (`FREQ=YEARLY`, which previously dropped on the floor). Picking a Birthday,
  Anniversary or Holiday kind pre-selects a yearly repeat in one tap; Bill
  pre-selects monthly.
- **Four more note templates, including a drawing pad (`webapp/` 0.29.0).**
  Alongside Blank and Daily planner:
  - **Habit tracker** — a Mon–Sun grid to tick habits off, plus streak and
    what-got-in-the-way sections. Written as a GFM table, which the editor
    already edits and round-trips as one block.
  - **Journal** — a dated entry with prompts: how the day went, what went well,
    what you'd do differently, and a carry-forward list of real `- [ ]` to-dos.
  - **Scrapbook** — loose sections for clippings, links, images and a note on
    why you kept them. The one undated template, since a scrapbook accretes.
  - **Drawing pad** — a canvas you can sketch on with a **stylus**, finger or
    mouse. Pen **pressure** drives line width (other inputs draw an even line),
    with five inks, four widths, an eraser, undo and clear.

  The drawing is stored as stroke JSON inside a fenced ` ```draw ` block, so the
  note body stays plain markdown and the sketch rides along with export, NAS
  sync, the team document and the editor's round-trip for free — fenced blocks
  were already preserved verbatim, so this needed no parser change. The canvas is
  a fixed 1400×900 logical surface scaled to the available width, so a sketch
  drawn on a phone opens with the same proportions on a desktop rather than
  reflowing into a different picture. A drawing can also be dropped into any note
  from the `/` menu — the template just seeds a note that already contains one.

### Added
- **Delete a notebook (`webapp/` 0.28.1).** Notebooks could be created but never
  removed. Each one now has a delete control in the notes tree, with an inline
  "Really?" confirm since it takes the notebook's pages with it. The last
  remaining notebook is deliberately protected — a new note needs somewhere to
  live, and a vault with none has no way back to one.
- **Pick a template per note (`webapp/` 0.28.1).** The template was a single
  global default, so every new page got the same layout. The **+** button now
  opens the template list (Blank / Daily planner) and each note starts from
  whichever suits it; the Settings choice is marked "default" in the menu rather
  than being the only option.

### Fixed
- **The ghost suggestion sat in the wrong place (`webapp/` 0.28.1).** The note
  editor's CSS paired rendered-vs-textarea typography for paragraphs, headings
  and quotes but never for list types, so a focused to-do silently dropped to the
  browser's default form-control size while the ghost overlay used the page's —
  two different text widths, so the hint landed on top of the text. Both now share
  an explicit size, which also fixes the long-standing size jump when you focus a
  list item.
- **Guided entry now works in Markdown view too (`webapp/` 0.28.1).** The ghost
  only appeared in the block editor. The raw markdown view offers the same
  suggestion at the end of the caret's line, with Tab to accept and `-` to skip.

### Added
- **A note can now carry every task field, and the two stay in step (`webapp/`
  0.28.0).** Markdown used to express only a title, done-ness and nesting, so
  "Send to Todo" was a one-way funnel: you drafted structure in a note, then
  re-entered every real detail by hand and the note went stale immediately. Task
  lines now take a tail of field tokens:

  ```markdown
  - [/] Ship the export pipeline !P0 #work ~90m @start(2026-08-04 09:00) @lock @id(a7x2) // ask Priya
      > Blocked on the vendor's API key.
      - [x] Draft the schema !P1 ~45m @id(b3k1)
      - [ ] Wire the writer ~2h @after(Draft the schema) @id(c9m4)
  ```

  `!P0`–`!P3` priority · `#tag` · `~90m` / `~2h` / `~1h30m` estimate ·
  `@start(…)` · `@due(…)` · `@every(1d|2w|3m)` · `@lock` · `@after(task text)` ·
  `// comment` · `>` lines for the description · and all four checkbox states,
  `[ ]` `[/]` `[x]` `[-]`, where in-progress and skipped previously collapsed to
  `[ ]` and were lost. A field the line **states** is authoritative; a field it
  omits leaves the task's value alone, so a note can adopt the format one token
  at a time. Malformed tokens degrade to plain title text rather than failing —
  `review PR #3` and `email me@x.com` are untouched, and a backtick escapes a
  sigil.
- **Edits made anywhere flow back into the note (`webapp/` 0.28.0).** Change a
  task on the board, in the list, by dragging it on the schedule, in the editor,
  through the day-start re-plan or from a Google Calendar pull, and its line in
  the note is rewritten to match. One code path covers every view.
- **Renaming a task line no longer destroys it (`webapp/` 0.28.0).** Task
  identity was `(source, title)`, so editing a line's text deleted the task and
  created a new one — silently discarding its logged time, its Google Calendar
  link, its dependency edges and a routine's per-day history. "Send to Todo" now
  stamps a short `@id(…)` on every task line (idempotently — sending twice
  changes nothing), and that key is matched first. Notes are located by scanning
  for the key rather than by `source`, which is the note's title and changes the
  moment you edit the heading.
- **Guided field entry (`webapp/` 0.28.0).** On a to-do line ending in a space,
  the next unstated field appears as dim ghost text — **Tab** accepts it, **-**
  skips to the one after, in a fixed order so muscle memory builds. Requiring
  the trailing space is what keeps Tab-to-nest working: a Tab pressed straight
  after the last word still nests the item. Skips are transient, recorded
  nowhere, so a field added in future simply joins the sequence. Field tokens
  render dimmed in notes so a note still reads as a note.

  Two deliberate behaviour changes: unticking a box now genuinely un-completes a
  task and clears its completion date (the markdown could previously only ever
  mark something done), and `- [-] foo` changes from a task titled `"[-] foo"`
  to a **skipped** task titled `"foo"`.
- **Drag the Gantt date header to move through time (`webapp/` 0.27.0).** The
  timeline strip along the top of the Gantt chart is now a grab handle: pull it
  right and earlier dates come into view, pull it left for later ones — the
  chart moves with your finger like a sheet of paper, instead of asking you to
  aim at a scrollbar at the far edge of the window. Works with mouse, pen and
  touch; a vertical swipe still scrolls the rows normally, so the gesture never
  fights the list. The scrollbar, wheel, trackpad and keyboard scrolling all
  keep working exactly as before — this is another way in, not a replacement.
- **Google Calendar sync, with as many accounts as you like (`webapp/` 0.26.0).**
  A new **Settings → Google Calendar** pane connects one or more Google accounts,
  each syncing with a calendar of its own — work and personal side by side, each
  independently pausable. Any task carrying a scheduled time becomes a timed
  event and comes back edited: move an event in Google and the task moves here.
  Nested subtasks sync as their own events and name their parent chain in the
  event description ("Part of: Website refresh › Hero section"); parents are not
  sent separately, since their window is only the span of their children.
  Events created in Google arrive as tasks, all-day ones as **deadlines** rather
  than 24-hour blocks so they never bury the timeline. Deleting on either side
  deletes on the other. When both sides changed, the more recent edit wins —
  except for a **locked** task, which always wins and is written back over the
  calendar. Syncs on open, on tab focus and every five minutes, or on demand.
  Requires a Google Cloud OAuth **Web client ID** pasted into Settings, and an
  **HTTPS origin** (Google rejects plain-HTTP origins — `webapp/DEPLOY.md` §3b
  covers the Tailscale certificate route). No client secret exists to leak: the
  browser holds a one-hour access token in `sessionStorage` that never enters the
  encrypted vault. Local-vault mode only, like the Security pane — in a team
  project these settings would be shared with everyone.
- **"When does today start?" (`webapp/` 0.26.0).** Wake at 05:00, open the app at
  09:00, and the tasks you planned for 07:00 are stranded in the past dragging
  every downstream estimate out of date. On the first open of each day LetsGo now
  asks what time the day really begins and re-packs that day's remaining
  **unlocked** tasks from there, in the order you planned them, honouring
  estimates, the break, work hours and every locked appointment. The dialog
  previews the moves before you commit ("07:00 → 09:35"), offers **Now** and
  fixed-hour shortcuts, and **Keep my plan** leaves everything untouched. Asked
  once a day — the answer is recorded in the synced settings, so a second device
  does not ask again — and switchable off in **Settings → Schedule**. Done,
  skipped and routine tasks are left alone, as are other days.
- **Nothing is scheduled on top of a locked task (`webapp/` 0.26.0).** Locked
  tasks were already immovable, but the auto-packer would happily lay other work
  straight over one. Now every automatic placement — estimate packing, drag
  reflow, the late-start move and the new day-start re-plan — clears a locked
  task by the configured break (default 5 minutes) on **both** sides, so work
  never merely abuts an appointment either. A locked subtask inside a packed tree
  is treated as a fixed anchor its siblings flow around, and a task dropped onto
  a locked slot snaps clear of it instead of overlapping.
- **Lock and unlock from any view (`webapp/` 0.26.0).** The scheduling lock used
  to be reachable only through the list view's bulk-edit bar, so releasing a lock
  meant navigating to one specific view and selecting the task there. It is now
  in the **⋯ menu on every card and row** (Kanban, Eisenhower, Gantt, List), a
  **Lock scheduling** checkbox in the task editor — which opens from every
  surface, schedule and calendar included — and the lock badge on a schedule card
  is itself a button that releases the lock in one click.
- **Switchable note templates (`webapp/` 0.25.0).** New notes can start from a
  **Daily planner** layout — the paper-planner "Today" page with a Checklist,
  Top 3 Priorities, For Tomorrow, Don't Forget and Notes sections — instead of
  the classic blank page. Pick the default in **Settings → Plugins → Notes**
  ("New note: Blank" / "New note: Daily planner"); every note created afterwards
  uses it, and existing notes are untouched. The scaffold is plain markdown
  (`- [ ]` checkboxes the editor renders as to-dos, a dated `# Today` heading),
  so export, Send-to-Todo and sync all keep working. Blank stays the default for
  new and existing vaults.
- **Auto-move a late task to now (`webapp/` 0.24.0).** Marking an overdue
  scheduled task **In progress** pulls it to the current time and reflows the
  rest of its tree behind it, so a 10:00 task begun at 13:00 stops sitting in
  the past dragging every downstream estimate out of date. **Locked** tasks are
  immovable anchors: if one occupies the slot, the started task lands after it
  plus the break (a locked 13:00–14:00 task pushes the start to 14:05) and a
  banner names the blocker — "work on the locked task first". Chains of locked
  tasks clear in one step, and the work-hours window still applies. Routines are
  exempt: their `scheduledAt` is a recurrence anchor, not an appointment.
- **Configurable break between tasks (`webapp/` 0.24.0).** Settings → Schedule
  takes a break length (default **5 minutes**) that the auto-packer leaves
  between any two consecutive tasks, dependent or independent. Applied between
  neighbours only — never before the first task or after the last — so a
  subtree's span stays its work plus its internal gaps. `0` restores the old
  edge-to-edge packing.
- **GOAL-tagged notes show progress on the dashboard (`webapp/` 0.24.0).**
  Notes gain tags, and tagging a page **GOAL** (its own toggle in the note's tag
  strip) gives it a progress bar on the dashboard. Progress spans the tagged
  page *and its subpages*, counting linked tasks (Send to Todo, matched on
  `source`) when any exist and falling back to `- [ ]` checkboxes in the note
  bodies otherwise — never both, since a sent bullet exists in both places. Only
  the outermost tagged page in a branch is reported. Skipped tasks leave the
  denominator. The card is hidden entirely until something is tagged.
- **Subtasks while creating a task, and attaching existing ones (`webapp/`
  0.24.0).** The task editor's Subtasks section now appears for brand-new tasks
  too, staging children on the draft and writing them when the task is saved
  (so Cancel cancels). A new "Attach an existing task" picker reparents an
  existing task on save; candidates exclude the task's own descendants so no
  cycle can be built.
- **Move pages between notebooks, and create notebooks (`webapp/` 0.24.0).**
  Drag a page onto any notebook header, or pick a different notebook from the
  breadcrumb (now a select, and visible on mobile where the rest of the
  breadcrumb is hidden). A moved page takes its subpages with it and becomes a
  top-level page in the destination. "New notebook" at the foot of the tree
  creates notebooks beyond the three seeded ones.
- **Quick comments on tasks (`webapp/` 0.24.0).** A new `Comment` column in the
  list view — and a matching field in the task editor for mobile — holds a
  running scratch note ("waiting on the API key"), kept separate from the
  task's description.
- **Resizable list columns (`webapp/` 0.24.0).** Drag the handle on a column's
  trailing edge, or nudge it with the arrow keys when focused; "Reset widths"
  restores the defaults. Widths track screen size rather than content, so they
  persist per device in `localStorage` instead of the synced vault.
- **More `/` commands in Notes (`webapp/` 0.24.0).** The slash menu gains
  **Table** (previously toolbar-only) and the **warning**, **tip** and
  **success** callouts (previously info-only), and every entry now carries
  search keywords, so `/warning`, `/grid` or `/snippet` find the right block.
- **Choose a timer clock face (`webapp/` 0.23.0).** Settings → Appearance now
  offers five readout styles for the focus timer and quick-timer cards, each
  shown as a live preview: the existing **Dot matrix**, plus **Seven-segment**
  (LCD bars with faint unlit segments), **Flip clock** (split-flap digit
  cards), **Minimal** (plain tabular type) and **Analog** (a dial whose hands
  read straight off the MM:SS). Stored as `settings.clockFace` (defaults to dot
  matrix; existing vaults backfill on load). A new `ClockDisplay` component
  swaps faces behind the two former `DotMatrix` call sites without changing
  their layout.
- **Scheduled-task start/end reminders (`webapp/` 0.21.0).** An app-root
  watcher pops a prompt the moment a scheduled task's start time arrives —
  "Start it now?" moves the task to In progress (which auto-starts its
  timer) — and again when the scheduled end (`scheduledAt + estimate`)
  passes: extend the estimate by a chosen number of minutes (15/30/60
  presets or a custom value) or mark it done. Fires for leaf, one-off tasks
  only (parents derive status; routines have their own per-day model), one
  prompt at a time, and a dismissed edge is remembered until the task is
  rescheduled or extended. Toggle under Settings → Schedule → "Schedule
  reminders" (on by default).
- **Choose which view opens on launch (`webapp/` 0.21.0).** Settings →
  Plugins now carries a "Launch" radio beside each enable/disable toggle to
  pick the plugin a bare URL opens on; Todo — the one plugin with landing
  sub-views — adds a dropdown to land straight on Board · Kanban /
  Eisenhower / Gantt / List, Schedule or Calendar. Stored as
  `settings.landingView`; a disabled target falls back to the first enabled
  plugin.
- **Reorder notebooks and pages by dragging (`webapp/` 0.21.0).** The Notes
  sidebar tree is now drag-to-reorder: drag a notebook to reorder notebooks,
  or a page to reorder it within its sibling group (same notebook + parent),
  with a drop line marking the target. New `reorderFolder` / `reorderNote`
  reducer actions; order is the array order the tree renders in, persisted
  in the vault.
- **Multi-select + bulk-delete pages in Notes (`webapp/` 0.21.0).** A "Select"
  toggle in the Notes sidebar swaps each page's icon for a checkbox; pick
  several and delete them in one confirmed action (deleting a page removes its
  subtree, so a selected parent takes its descendants with it).
- **Tab indents in the Markdown editor (`webapp/` 0.21.0).** Pressing Tab in
  a note's raw Markdown view inserts two spaces (Shift+Tab, and Tab with a
  selection, indent/outdent every line the selection touches) instead of
  moving focus out of the textarea — matching the block editor's list Tab.
- **Dragging a task tree onto the Schedule packs it (`webapp/` 0.20.0).**
  Dropping a parent whose subtree has no times yet now estimate-packs the
  whole tree from the drop point (leaves back-to-back inside the work-hours
  window, parents spanning their children) — the md-import flow: import a
  Task>subtask>sub-subtask file, bulk-set estimates, drag the one unplanned
  card onto a morning and the plan unfolds. Previously only upsertTask
  (editor edits, estimate changes) packed, so the result depended on
  whether estimates were set before or after the first drag — a tree
  estimated first and dragged second stayed a single stuck card. Trees
  that already carry times keep the whole-tree drag-shift semantics.

### Fixed
- **Schedule cards only narrow for the cards they actually overlap (`webapp/`
  0.26.3).** A day column counted its side-by-side lanes **once for the whole
  day** and applied that count to every card in it, so a single collision —
  two routines bumping into each other at 21:00 — cut every card in that column
  in half from 06:00 onwards, each sitting beside an empty half-column. Placement
  is now computed per **overlap cluster**: a group of transitively overlapping
  cards is sized on its own, and a card that overlaps nothing takes the full
  width. Touching still counts as clear, so a 10:00 card following a 09:00–10:00
  one keeps its full width. Cards that genuinely collide split as before. Extracted
  to `lib/dayLanes.ts` with tests.
- **Edits no longer revert a few seconds after you make them (`webapp/`
  0.26.2).** With Google Calendar connected, rescheduling or editing a task
  would undo itself moments later, and the same change had to be made three or
  four times before it stuck. A sync runs for several seconds — listing the
  calendar, then a round trip per event, times the number of connected accounts
  — and it was returning each task **as captured when it started**. Whatever you
  changed while it was in flight was overwritten by that stale snapshot the
  moment it landed. The sync now reports **field-level patches** instead of
  whole tasks: a push writes back only the event link (the task's own content
  went *out*, so there was never a reason to write it back), and a pull writes
  only the fields Google actually owns, applied to whatever the task looks like
  at that moment. Local-only fields — status, priority, tags, logged time,
  parent, lock — are absent from the patch entirely and so can never be clobbered. Repeating tasks
  failed to sync with *"Missing time zone definition for start time"* while
  one-off tasks went through, because the event carried a bare UTC instant and
  Google requires an explicit IANA time zone on anything with an `RRULE` — a
  UTC instant cannot say which local 07:00 a series should follow across a DST
  change. Every event now carries the device's zone, recurring or not, so a task
  that later gains a repeat rule does not suddenly start failing. The failure was
  loud but partial by design: the sync reported the rejected event and carried
  on with the rest.
- **A failed Google sign-in explains itself (`webapp/` 0.26.1).** The reason
  Google gave was being rendered in place of the account address, producing
  "Sign in to Google again for Popup window closed". Reason and address are now
  separate, and the overwhelmingly common first-run failure — `access_denied`,
  which means the OAuth app is still in Testing and the address is not a
  registered tester — now names the console page that fixes it instead of
  repeating Google's own uninformative wording.
- **The day-start prompt is usable on a phone (`webapp/` 0.26.1).** It was a
  centred dialog with no overflow handling, so on a short viewport the task
  preview pushed **the answer buttons off-screen**. It now opens as a
  full-screen sheet on mobile (the same split the task editor uses) with a fixed
  header, a scrolling body and a pinned action row; the nested preview scroller
  is disabled there so it cannot trap the scroll gesture.
- **Google Calendar settings fit a narrow screen (`webapp/` 0.26.1).** Each
  account's calendar picker, sync status and two buttons shared one line, which
  does not fit a phone; on mobile they stack, with a full-width picker and
  finger-sized buttons. The lock badge on a schedule card was a 10-pixel tap
  target and now carries a padded hit area (the glyph does not move), so
  releasing a lock by touch actually works.
- **Devices no longer diverge while both report "Synced" (`webapp/` 0.24.0).**
  NAS sync compared the vault's `rev`, but every device increments its own copy
  on each local save, so two devices editing independently reach the **same rev
  with different content** — and the comparison read that as "same number, same
  content". One side pushed over the other; the other decided it was already in
  sync and never pulled again. Both kept showing a clean sync while permanently
  diverged, which is the "changes made on my phone never reach my desktop"
  report. Each save now carries a unique `stamp`, and sync decides on that:
  whichever side still holds the last agreed stamp is the one that has not
  moved. When neither does it is a real conflict, resolved last-write-wins on
  `savedAt` with the losing copy stashed and downloadable from Settings, as
  before. Vaults written before stamps fall back to a device-scoped
  `(device, rev, savedAt)` triple, which cannot collide across devices the way
  a bare rev does; `rev` survives as a save counter that no longer decides
  anything. **On the first sync after updating, two already-diverged devices
  will resolve as one conflict — the more recent save wins and the other copy
  is kept under Settings → Sync.**
- **A save made mid-sync is no longer dropped (`webapp/` 0.24.0).** An edit that
  landed while a sync was in flight was skipped and left waiting for the next
  25-second poll; it now queues a follow-up pass that runs as soon as the
  current one finishes.
- **Bulk-select in the list no longer looks like a row of completion toggles
  (`webapp/` 0.24.0).** The first column's checkbox did double duty as "mark
  done" and, once Select mode was on, as the selection box. Status moved to the
  status cell (click to cycle pending → in progress → done → skipped; parents
  stay read-only since their status is derived), the checkbox is now purely
  selection and always present, and the redundant "Select" button is gone.
- **Gantt opens on the Day scale (`webapp/` 0.24.0).** It defaulted to Week.
- **Mindmap links visible on phones (`webapp/` 0.19.1).** Every lens draws
  its connecting links inside the pan/zoom CSS transform with a fixed
  ~1.4px stroke, so at a phone's fit-to-view zoom (clamped as low as 0.3)
  they rendered as translucent sub-pixel hairlines — nodes floated with no
  visible links, in all five lenses. Stroke width (and the wikilink dash
  rhythm) now divides by the zoom factor, keeping edges at a constant
  on-screen weight at every zoom level on both the derived-lens canvas and
  the Freeform board. Desktop is unaffected visually (its fit zoom is
  near 1, where the compensation is a no-op).
- **Marking a routine no longer marks every future day (`webapp/` 0.19.0).**
  A repeat task's occurrences are computed on read from ONE task object, so
  setting today's card done/skipped/in-progress repainted every upcoming
  card of that routine. Statuses are now per-day (the desktop's
  `occurrenceStatus` model, ported as `webapp/src/lib/occurrence.ts`): each
  occurrence starts pending and a mark records a local-day override, leaving
  the template's own status untouched. Schedule and Calendar cards resolve
  their own day (ghost occurrence cards gain the one-click status square, so
  today is markable even when the anchor day is in the past); the Kanban
  board, Eisenhower, List and Dashboard read a routine as TODAY's occurrence
  — a routine done today drops back to Pending tomorrow morning. The task
  editor's status control edits today's occurrence for routines; timer
  auto-start/stop and the in-progress auto-promotion apply to today's
  occurrence only, and Dashboard streaks/done-counts include per-day routine
  completions (routines never set `completedAt`).
- **Mobile calendar shows routines (`webapp/` 0.19.0).** The phone month
  view built its day dots and day list from anchor-day tasks only, so a
  routine was invisible past its first day. Occurrence ghosts now appear in
  both (dashed, ↻-prefixed, desktop parity), each with its own day's status.
- **Mobile task editor can delete (`webapp/` 0.19.0).** The delete button
  lived only in the desktop footer; the sheet now has an inline-confirm
  delete beside "Start timer".

### Added
- **Gantt understands routines + auto-collapsed subtasks (`webapp/` 0.19.0).**
  A routine no longer renders as one template-colored bar (which sat
  "pending" forever): each occurrence day inside the visible span draws its
  own LED-style pill tinted by THAT day's status, and clicking a pill cycles
  that day (same order as Schedule cards). Routine bars don't drag — moving
  the anchor would silently reschedule the whole series. Parent rows now
  start collapsed so the chart opens as a tidy list of top-level bars; the
  existing chevron expands a branch (parents created mid-session stay open).
- **Touch drag everywhere (`webapp/` 0.19.0).** Every drag surface built on
  the HTML5 drag API — which mobile browsers never fire from touch — gains a
  long-press pointer-events path (`lib/touchDrag.ts`): hold ~⅓s and a chip
  attaches to the finger, move before that and scrolling wins. Kanban cards
  drop on columns (desktop) or the column tabs (mobile shows one column at a
  time); Schedule cards drop at minute resolution with the same notch line
  and edge day-stepping; Calendar chips and mobile day-list rows drop onto
  month cells; Gantt bars long-press-move on mobile (day-snapped, move-only —
  resize handles stay desktop); mindmap notes long-press-reparent (a second
  finger cancels into a pinch). Dependency dots stay desktop-only.
- **Timer deck redesign — dot-matrix clocks (`webapp/` 0.19.0).** The timer
  face is now a 5×7-per-glyph LED dot-matrix panel (`components/DotMatrix`)
  inside the existing progress ring (the ring still encodes fraction-of-
  target; overtime flips the panel to the pending color). Quick timers move
  out of the side panel onto the main deck as LED cards — each with its own
  matrix countdown, thin remaining-time bar, pause/resume/restart and
  dismiss — so every running timer is visible at once; the side panel keeps
  the session log. The launcher's custom-minutes field no longer clips its
  "min" placeholder (it was 26px tall inside a 36px-min-height input class).
- **24-hour clock by default, 12-hour opt-in (`webapp/` 0.19.0).** Every
  time display now goes through a Settings-driven clock style — Appearance
  gains a "Clock" toggle (24-hour default / 12-hour). Schedule cards, the
  hour axis ("14:00" vs "2 PM"), Calendar, Dashboard, task cards and the
  editor summaries all follow it. The native datetime-local/time pickers
  could NOT follow it (browsers render them in the device locale, full
  stop), so they're replaced app-wide by `components/TimeField`: a native
  date picker beside a typed time field that displays per the setting and
  parses either style ("14:30" or "2:30 pm"; invalid text reverts on
  blur). Swapped into the task editor's Scheduled/Deadline, the List
  bulk-edit deadline, and the work-hours window — which also retires the
  segmented datetime-local inputs whose typing garbled.
- **Mindmap mobile pass (`webapp/` 0.19.0).** The derived-lens canvas was
  desktop-only in practice: tapping a node opened a fixed 288px side panel
  that squeezed a phone canvas to a sliver, zoom was mouse-wheel only, and
  the minimap covered a third of the surface. The node panel is now a bottom
  sheet on mobile, the canvas supports two-finger pinch-zoom anchored to the
  fingers (capture-phase tracking, so a finger landing on a node still joins
  the pinch), the minimap hides on phones, and the filter toolbar becomes a
  single horizontally scrollable strip instead of a three-row wrap.
- **Tables in the Notes editor (`webapp/` 0.18.0).** The block editor's
  formatting bar gains a table button with a rows × columns size picker (the
  first row is the header). A table renders as an editable grid; focusing any
  cell reveals a toolbar to insert a row above/below, insert a column
  left/right, delete the focused row or column, or delete the whole table.
  Tables are stored as ordinary GitHub-flavored markdown and round-trip through
  the block engine (`noteBlocks` `parseTable`/`serializeTable`), so they export
  and sync like every other note content; cells strip raw pipes/newlines to
  keep the markdown valid.
- **iCalendar (.ics) import (`webapp/` 0.17.0).** The Todo import button and
  drop zone now accept `.ics`/`.ical` files (routed by extension, with a
  `BEGIN:VCALENDAR` content sniff as a fallback) alongside markdown. A new
  RFC 5545 parser (`webapp/src/lib/ical.ts`) reads both `VTODO` and `VEVENT`
  components and maps every field LetsGo tasks support: `SUMMARY→title`,
  `DESCRIPTION→description`, `DUE→deadline`, `DTSTART→scheduledAt`,
  `DTEND`/`DURATION→estimate`, `PRIORITY` (1–9) → P0–P3, `STATUS`/
  `PERCENT-COMPLETE`/`COMPLETED→status + completion time`, `CATEGORIES→tags`,
  and `RRULE` FREQ/INTERVAL → repeat. Handles UTC (`…Z`), floating/TZID
  (read as local wall-clock) and all-day (`VALUE=DATE`) forms, plus line
  folding and TEXT escaping. Because the mapped tasks carry dates, priority
  and status, they show up across every view — Kanban, Eisenhower, Gantt,
  List, Schedule and Calendar — with no per-view work. Re-importing the same
  file follows the markdown sync contract: entries upsert by (source, title)
  and any task from that calendar whose title left the file is removed.
- **Notification sounds (`webapp/` 0.17.0).** A short in-app chime now plays
  on three events — a pomodoro/countdown or quick-timer finishing, any task
  first reaching "done" (a bulk import rings once, not once per task), and a
  successful unlock/sign-in. Sounds are synthesized on the fly with the Web
  Audio API (`webapp/src/lib/sound.ts`) so there is no bundled asset and it
  works fully offline; failures (blocked autoplay, no audio device) are
  swallowed. A new **Notification sounds** toggle in Settings → Security
  (default on) gates them independently of the existing OS-banner toggle.
- **Gantt interaction pass, modeled on ServiceNow Horizon's now-gantt
  guidelines (`webapp/` 0.16.0).** The chart is now fully manipulable in
  the app's own design language: drag a bar to move it in whole-day steps
  (subtree rides along; a live date chip tracks the pointer), drag either
  edge to resize (right edge moves the deadline when one pins the bar,
  otherwise the estimate; left edge keeps the end anchored), and drag a
  milestone to move its deadline — locked tasks refuse, as everywhere.
  Task **dependencies** arrive as planning metadata (`dependsOn`): drag
  the dots at a bar's ends onto another row to link "starts after"
  (self/duplicate/cycle links rejected by a tested guard), lines render
  as accent elbows with arrowheads on the All-tasks preset, and clicking
  a line opens a remove popover; deleting tasks strips dangling links.
  The grid gains hover row menus (edit / new task same day / new subtask
  / duplicate / delete), parent collapse chevrons, a P0 "critical" chip,
  and a lock marker. Hovering any bar shows a details card (dates,
  duration, logged vs estimate, tags, badges). The toolbar adds "+ Task",
  a settings menu (dates column, dependency lines, milestones, progress
  fill, weekend shading, hide-done filter — persisted per device) and a
  legend/shortcuts menu. Esc dismisses every popover. Deliberate
  adaptations from the guide: details open in the app's task editor
  rather than a side panel, bulk selection stays in the List lens, and
  row drag-reordering / notifications / RTL are out of scope for the
  webapp today.

### Changed
- **Board/scheduler internals: one shared child index (`webapp/` 0.17.2).**
  No behavior change — a code-review pass replaced the per-call task-array
  rescans with a single `parentId → children` map (`taskTree.childIndex`).
  Kanban's split-card classification, the Schedule lineage breadcrumbs, and the
  `deriveParentStatus` / `scheduleTask` reducer paths now run in ~O(N) instead
  of O(N²); the duplicated `subtreeIds`/`descendantIds` helpers collapsed into
  one, and a few small dead-code/import tidies landed alongside.
- **In-progress cards always show live elapsed time (`webapp/` 0.15.2).**
  The Kanban card's elapsed row only appeared while the timer was running
  AND the task had an estimate; now any in-progress card with time on the
  clock (running, or banked from earlier sessions) shows a live
  "Xm elapsed". ETA still only ticks while actually running, the progress
  bar still needs an estimate, and done cards keep their "took Xm" total.
- **Schedule "now" line is always red and on top (`webapp/` 0.15.1).** The
  current-time rule was accent-colored at card z-level, so it vanished
  against accent-filled in-progress cards and would have shifted hue with
  the new accent choices. It is now a fixed red (#e5484d) in every theme
  and accent, slightly thicker (2px, 9px dot), and painted above the task
  cards (below the drag notch).

### Added
- **Accent colors in Appearance settings (`webapp/` 0.15.0).** A swatch row
  next to Theme offers five eye-friendly accents — Violet (default), Ocean
  blue, Teal, Ember and Rose — each a full light+dark token family
  (`[data-accent]` blocks in theme.css): light variants sit at 600/700
  depth for AA contrast under white button text, dark variants at 300
  tints for the dark on-accent, and the glow/pulse/wash layer follows the
  chosen hue. Persisted in settings like the theme; older vaults gap-fill
  to Violet.

### Fixed
- **Kanban cards show their details again (`webapp/` 0.17.2).** Standalone
  (parentless) cards had started collapsed on desktop — a decluttering meant
  only for the narrow mobile board — so a card showed just its title. Desktop
  cards now start expanded, and the expanded body surfaces every fact a task
  carries: start time and deadline while it is open, completion time once it is
  done, estimate, live elapsed, logged total, notes, tags, and priority
  (previously hidden on done cards). Mobile keeps its compact collapse-first
  board.
- **Schedule cards get a one-click status control and priority (`webapp/`
  0.17.2).** A card on the planner grid now shows a status square you can click
  to cycle in progress → done → skipped → pending without opening the editor,
  plus its priority badge. Repeat "ghost" occurrences stay read-only.
- **Resizing a Schedule card no longer re-packs its whole tree (`webapp/`
  0.17.2).** Dragging a task's bottom edge changes its estimate, which tripped
  the live estimate-packer and snapped every sibling in the tree back to the
  packed layout. Timeline resize is now direct — only the dragged task grows or
  shrinks — via a new opt-out `repack: false` on `upsertTask` that the resize
  handler passes.
- **NAS restore/sync failing with 401 on mobile (`webapp/` 0.16.1).** The
  WebDAV URL/username/password fields in the Unlock "Restore from NAS" form
  and Settings → Data & backup had no `autoCapitalize`/`autoCorrect`
  attributes, so mobile keyboards silently capitalized the first letter of
  a freshly typed username (PAM auth on the NAS is case-sensitive) —
  desktop keyboards don't do this, so the bug was mobile-only. Disabled
  autocapitalize/autocorrect/spellcheck on all three fields and trim
  whitespace on submit/blur (mobile predictive-text bars also inject a
  trailing space).
- **Metadata edits no longer reset manually placed tasks (`webapp/`
  0.14.1).** Every task save ran the live estimate re-pack, which re-laid
  the whole tree from its root anchor — so bulk-editing tags, cycling
  priority, toggling the scheduling lock, or any editor save silently
  snapped Schedule-view drag placements back to the packed layout. The
  re-pack now runs only when the edit actually changes a scheduling input
  (estimate, scheduled time, tree position) or creates the task; pure
  metadata edits preserve the latest date-times exactly. Regression-tested
  (tags-only edit, lock toggle, and estimate-change-still-repacks).

### Added
- **List view: bulk edit via a selection popup (`webapp/` 0.14.0).** Ticking
  tasks in Select mode now raises a floating bar over the list (count,
  Edit…, Mark done, Skip, Delete, clear) instead of the easy-to-miss inline
  toolbar. Edit… opens a bulk-edit dialog — status, priority, deadline
  (set or clear), estimate, and add-tags — where only the fields you touch
  are applied to every selected task; status runs through the normal
  transition path (timer banking, parent derivation) and estimates skip
  parents, whose value stays derived from subtasks.
- **Scheduling lock (`webapp/` 0.14.0).** The selection popup's padlock
  toggles `locked` on the chosen tasks: a locked task's scheduled time,
  deadline and estimate are frozen — Schedule/Calendar drags are disabled,
  the resize handle disappears, and the reducer bounces reschedules,
  editor date edits, estimate re-packs, tree shifts and squeezes off it —
  while status, priority and tags stay fully editable. Locked rows and
  events carry a small padlock; the bar shows an open padlock (unlock)
  when every selected task is already locked.
- **Quick timers: ad-hoc countdowns beside the focus timer (`webapp/`
  0.13.0).** The Timer screen grew a "Quick timers" deck — preset chips
  (5/7/10/25 min) or a custom minute count start an independent countdown,
  and any number can run at once without touching the pomodoro/stopwatch
  focus timer. Each row shows a live mm:ss, can pause/resume with the
  remainder banked, restarts in full after it rings, and fires the OS
  notification banner on finish. Timers live in the encrypted vault, so a
  reload or tab switch never loses one.
- **Calendar: "+n more" now opens the hidden tasks (`webapp/` 0.13.0).**
  Month cells clip at three chips; hovering (or clicking) the "+n more"
  line now expands the day into a floating panel over the cell listing
  every task — scrollable past ~12, chips stay clickable and draggable —
  which closes when the pointer leaves it.
- **Mindmap: search and filters auto-zoom onto the highlighted sub-graph
  (`webapp/` 0.13.0).** Typing in node search, toggling folder / "has open
  tasks" chips, or focusing a node now refits the canvas onto the nodes
  that survive the highlight instead of leaving them dimmed off-screen;
  clearing the highlight zooms back out to the whole graph.
- **Schedule: drag a task against the calendar's edge to reach out-of-view
  dates (`webapp/` 0.12.0).** In every span (Day/3-day/Week), holding a
  dragged card at the right edge of the grid auto-advances the visible window
  one day at a time (~0.6 s per step) until the target date scrolls into
  view; holding it over the time axis on the left steps backwards the same
  way. Works mid-drag with no extra gesture — the drop then lands at the
  hovered minute as usual.

### Changed
- **Gantt detailing pass, modeled on monday.com's Gantt view (`webapp/`
  0.11.0).** The chart grew the reference's fine grain: a two-tier sticky
  header (week-range bands over day numbers at Day scale, month bands over
  week starts at Week, a year band over month names at Month) with today's
  date in an accent pill feeding a dot-topped today rule; weekend column
  shading (Day/Week scales); a two-column left panel (task title + compact
  date range, with column headers); task titles rendered beside every bar;
  solid rounded group-colored bars with a darker progress veil; ring-style
  milestone diamonds with labels; per-group phase lines labeled
  "Name · Jul 3 – 14 · 12d"; parent→child elbow connectors on the All-tasks
  preset (forward-flowing only — a backward line would cross the child's own
  label); and row hover highlighting. Gantt styling moved from inline styles
  to `gv-*` classes in theme.css.

### Added
- **Gantt view presets: a dropdown of monday.com-style lenses (`webapp/`
  0.10.0).** A "Gantt view" select joins the toolbar: **All tasks** (the plain
  parent/child timeline), **Group: Status** (bug-tracker style — In progress /
  Pending / Done / Skipped sections in board-column order), **Group: Priority**
  (P0→P3 with the Eisenhower quadrant names), and **Group: Tag** (channel/phase
  style by each task's first tag, alphabetical, untagged last). Grouped presets
  flatten the tree, sort rows by start, and add a header row per group — name,
  count, and a slim phase-summary bar spanning the group's whole window. Bars
  take the app's existing color language for the grouping dimension (status
  squares, priority pills); tag groups stay accent since tags are unbounded.
  Bars with an estimate and logged minutes also show a progress fill with a
  "Xm of ~Y logged" tooltip. Grouping logic is pure and unit-tested
  (`groupGanttTasks` in `webapp/src/lib/gantt.ts`). Dependency arrows and
  assignee avatars from the monday examples are out of scope — tasks have no
  dependency or assignee fields.

### Fixed
- **Task editor sections no longer render half cut; strict accordion
  (`webapp/` 0.10.0).** Every editor section now starts collapsed and at most
  one is open at a time — opening a section auto-closes the previous one, and
  the freshly opened section scrolls fully into view instead of sitting
  clipped at the dialog's scroll edge. On mobile the Schedule & estimate grid
  drops to one column (two side-by-side `datetime-local` inputs overflow a
  phone viewport — the right one rendered half cut), and the full-screen
  sheet sizes with `100dvh` so the footer action row no longer hides behind
  the browser's dynamic URL bar.

### Changed
- **Gantt spans the whole task horizon and scrolls, with a Day/Week/Month
  scale (`webapp/` 0.9.0).** The Gantt board lens no longer shows a fixed
  single week: the axis now runs from the earliest task date-time to the
  farthest deadline (padded a day each side, always including today, minimum
  two weeks), rendered at a fixed width per day inside a horizontally
  scrollable track — task labels and the date header stay pinned while
  scrolling. A Day/Week/Month segmented control picks the zoom, a Today
  button (and the initial mount) scrolls to the current-time rule, and bars
  gain real semantics: a scheduled task's bar runs from its start to its
  deadline (or its estimate when the deadline is missing or earlier), and a
  deadline-only task shows as a diamond milestone at its deadline. The span
  and bar-window math is pure and unit-tested in `webapp/src/lib/gantt.ts`.

### Added
- **Team mode in the webapp: sign in, shared projects, roles (`webapp/`
  0.8.0).** The app now boots through a mode gate — the private local vault (the
  default, unchanged) or a signed-in team server — chosen from the Unlock screen
  or Settings and remembered in `letsgo.mode`. Team mode adds a Login/sign-up
  screen (server URL, cookie session), a Project switcher to open, create, and
  manage projects and spin up new isolated workspaces, and a `TeamStoreProvider`
  that runs the same reducer over an authenticated per-project document with the
  rev/conflict sync flow (stale write → adopt the newer server copy; 12s poll for
  teammates' edits). Roles are honored end to end: viewers get a read-only
  session (mutations are dropped, the Add/Save/Delete affordances hide, and a
  "Read only" marker shows in a new team status bar), while owners/co-admins get
  an inline member panel to change roles, remove members, and mint invite codes.
  Settings gains an "Account & team" section (identity, project/role, sync state,
  switch project, sign out, drop back to local); the local-only Security pane is
  hidden while signed in. A new project can be seeded from this device's local
  data when the vault is passwordless. The typed API client already shipped in
  `webapp/src/lib/api.ts`; this wires it into the UI.

### Changed
- **Schedule drag lands on the exact minute, with a live drop notch
  (`webapp/` 0.7.0).** Dragging a task on the Schedule grid no longer snaps to a
  fixed 30-minute slot: `dropTime` now rounds to the nearest minute, so a drop
  at 19:03 schedules 19:03. While a card is dragged over a day column, a dashed
  accent line tracks the cursor with an "HH:MM" readout showing exactly where
  the task will land; it clears on drop or when the drag ends. Click-to-create
  on empty grid space inherits the same minute precision.

### Added
- **Passwordless open + Settings on mobile (`webapp/` 0.6.0).** The Unlock
  screen gains a "Skip — open without a passphrase" option; a passwordless vault
  is still AES-GCM encrypted at rest but opens automatically on launch (the mode
  lives in `letsgo.unlockMode`, outside the vault). Settings → Security is now
  mode-aware: set a passphrase when passwordless, or change/remove it when
  protected. The mobile bottom tab bar now includes **Settings**, which was
  previously unreachable on phones.

### Fixed
- **Task editor scrolls and collapses into sections (`webapp/` 0.5.0).** A tall
  add/edit task card no longer overflowed the viewport with its top and footer
  clipped and no way to scroll: the scroll region was missing `min-height: 0`
  (so a flex child could not shrink) and the modal capped at `max-height: 100%`
  against a grid-auto row that never bounded it. The body now scrolls, the modal
  caps at `calc(100vh - 48px)`, and the fields are grouped into auto-collapsible
  sections (Description, Status & priority, Schedule & estimate, Repeat, Tags,
  Subtasks) that open only when they already hold data, so a new task stays
  compact and each section shows a one-line summary while collapsed.

### Added
- **Optional team backend: accounts, workspaces, roles (`server/` 0.1.0).** A new
  Node/TypeScript service (Node built-ins only — `node:sqlite`, `node:crypto`,
  `http` — run via `tsx`, no native modules) turns LetsGo into a multi-user,
  multi-workspace app while the webapp keeps its local-first solo mode. Users →
  workspaces (the tenant boundary) → projects → one `AppState` document per
  project, revved for optimistic sync. Project roles `viewer/editor/co_admin/
  owner` (plus a workspace-admin override) are enforced by a single access
  middleware; a project you can't see returns `404` (no existence leak).
  `GET/PUT /projects/:id/doc` carries `baseRev` and returns `409` + the current
  doc on a stale write — the rev-based blob sync, per project, server-side.
  Ships with a Dockerfile + `packaging/docker-compose.yml` (persistent SQLite
  volume) so it self-hosts on a NAS or anywhere Node 22 runs, and a typed webapp
  client (`webapp/src/lib/api.ts`). Tested end-to-end (auth, RBAC matrix, tenant
  isolation, sync conflict). Webapp team-mode UI (sign-in, project switcher,
  per-project sync, role-aware read-only) is the next phase.
- **Mindmap built from your notes, plus four lenses (`webapp/` 0.4.0).** The
  Mindmap plugin gains a "from notes" mode that derives an interactive graph
  from your own data, alongside the original **Freeform** build-your-own board.
  Four lenses share one pan/zoom/search/focus canvas: **Notes** (folder → note →
  subpage hierarchy with dashed `[[wikilink]]` cross-edges), **Tasks**
  (status-coloured task tree with completion rings), **Web** (the wikilink graph
  with hubs pulled to the centre), and **Outline** (one note's headings and
  bullets as a radial map). Nodes carry insight encodings: rolled-up open-task
  badges, completion rings, recency heat, and orphan/hub/stale/due flags. `/`
  focuses search, filter chips scope by folder or "has open tasks", a node's
  neighbourhood can be isolated with Focus, and a selection panel shows a
  preview, backlinks and linked tasks with quick actions (open in Notes, add a
  subpage, create a linked task). Notes can be dragged onto another note or
  folder to re-parent them. Graph building is pure and unit-tested in
  `webapp/src/lib/notesGraph.ts`.
- **Kanban parent cards split by subtask status + collapsible cards
  (`webapp/` 0.3.0).** A parent no longer sits whole in one column because a
  single subtask moved: it appears in every column its subtree has a leaf for,
  each copy pruned to the branches that reach a task of that status, nested
  hierarchy intact, and a matching leaf can be dragged to another column. Each
  card also collapses (per-card chevron + board-level "Collapse all") to just
  its title/status. Split logic is unit-tested in `webapp/src/lib/taskTree.ts`.
- **Notes: real markdown + a discoverable editor (`webapp/` 0.3.0).** The
  renderer now handles nested/indented lists, fenced code, `- [ ]` task
  checkboxes, `#`-`######` headings, horizontal rules, merged blockquotes,
  underscore emphasis, inline images and bare-URL autolinks, in both the note
  editor and the task-card preview. The block editor gains an always-visible
  formatting bar, a `?` cheatsheet, per-block placeholders, `Tab`/`Shift+Tab`
  list nesting, and an auto-opening slash menu on empty blocks.
- **Work-hours auto-scheduling + divide-and-conquer reflow (`webapp/` 0.2.0).**
  A new Settings → **Schedule** section confines auto-scheduling to a daily
  work-hours window (default on, 6:00–21:00). When an estimate-packed subtask
  would run past the closing time it rolls whole to the next day's opening
  time and the rest of the tree flows on from there (every calendar day is
  fair game — weekends included). Dragging a single leaf subtask on the
  Schedule now reflows *it and every task after it* from the drop point within
  the window, while earlier and completed subtasks stay put — so you can do
  five today and push the other five to another day in one gesture. Roots and
  parent bars keep the existing whole-subtree shift. Packing math lives in
  `webapp/src/lib/estimate.ts` (`snapIntoWindow`, work-hours-aware
  `packSubtree`, `reflowFrom`, `rollUpParents`); the desktop plugin copy is
  unchanged.
- **Web app (`webapp/`, its own version 0.1.0).** The full LetsGo surface
  reimagined as a responsive browser app for desktop and mobile, implementing
  the "Industry" wireframe design language
  (steel-blue on a technical ground, Barlow/Barlow Condensed, square corners,
  registration-mark frames, four-color status code, light + dark). Unlock gate
  with an AES-256-GCM-encrypted localStorage vault (PBKDF2), Todo
  (Kanban/Eisenhower/Gantt/List + Schedule + Calendar with drag interactions),
  full-schema task editor, Timer with dark focus mode and service-worker
  notifications, markdown Notes with wikilinks/backlinks, pan-zoom Mindmap,
  Dashboard (status donut + weekly focus bars, CVD-validated), Settings
  (plugins drive the nav, theme, security, JSON export/import). Standalone
  Vite + React app; desktop app untouched, so the root version stays put.

## [0.51.0] - 2026-07-16

Schedule rename, Gantt drag-to-reschedule, markdown deletion sync, and
blocked-time placeholders.

### Added
- **Gantt drag-to-reschedule with a live time notch.** Dragging a childless
  bar horizontally moves its schedule — minute-resolution (any hh:mm, not
  the Schedule view's 15-minute grid), duration preserved. While dragging, a
  vertical notch with a "Jul 16 · 13:25" readout tracks exactly where the
  bar will land; zoom in for finer per-pixel adjustment. Dropping a bar onto
  another task still re-parents it (that gesture wins, and the notch hides
  while hovering a re-parent target).
- **Blocked-time placeholders.** A task titled
  `[block]lunch [1200:1300][1D]` becomes a blocked-time placeholder: `lunch`
  from 12:00 to 13:00, repeating every 1 day (`[nX]` — n number, X `D`ays /
  `W`eeks / `M`onths; omit it for a one-off block today). Works from the
  add-task editor and markdown import alike. It renders as a very
  translucent purple card in every view; in the Schedule view it's a
  full-width background band behind the grid — other tasks sit beside or on
  top of it freely (no overlap lane, no conflict prompt): gently notifying,
  never obstructing.

### Changed
- **The Planner is now called "Schedule"** — tab, and the sidebar's
  "Default view" option. (Internal ids are unchanged, so the persisted
  default-view setting keeps working.)
- **Re-importing a markdown file now also DELETES tasks** whose lines were
  removed from the file (matched by source + title, exactly like the
  existing update-on-reimport dedupe). Applies to md drops, file-path drops,
  and Notes' "send checkboxes to Todo" (per note section). Manually created
  tasks and tasks from other files are never touched; anonymous text drops
  (no source identity) never delete anything.

## [0.50.0] - 2026-07-16

Estimate-driven scheduling, plus fixes for the new Planner card-in-card view.

### Added
- **Estimate-driven auto-scheduling.** Give tasks a time estimate and set one
  anchor start on the top task, and the whole subtree lays itself out
  back-to-back on the clock — no hand-scheduling. Any task can carry an
  estimate; a task with children derives its window from the span of its
  children (its own estimate is ignored), a leaf uses its own estimate
  (default 60 min). Editing an estimate (or the anchor start) re-lays-out the
  subtree live. New pure `packSubtree` core (`estimateSchedule.ts`) does a
  depth-first, sort-order, back-to-back pack (e.g. leaves of 45/30/20/25 min
  from 10:00 → 10:00 / 10:45 / 11:15 / 11:35). Dragging the parent block on the
  Planner already shifts the whole subtree together.
- **List view: an inline Estimate field** (minutes), editable per row like the
  existing Priority / Deadline / Scheduled cells; editing it re-lays-out.

### Fixed
- **Planner nested subtask cards were clipped** — an expanded scheduled block
  grew past the timeline grid's `overflow: hidden` and lost its lower cards.
  The nested-card list is now capped with a scroll, so every subtask stays
  reachable.
- **Status menus (done / in progress / skip) rendered behind the next card.**
  Each board card sets its own `z-index` (a stacking context) which trapped
  the pop-up; the menus now portal to the page root and sit above everything,
  in every view (shared StatusBadge + the Planner subtask control).
- **The task editor silently wiped a task's estimate to null on every save**
  (its form never seeded `estimateMinutes` from the task being edited) — found
  and fixed while wiring the estimate feature.

### Changed
- The Planner "Unscheduled" tray hides **completed-and-unscheduled** tasks —
  a done, never-scheduled task is clutter that needs no planning.

## [0.49.0] - 2026-07-16

Stability + simplification pass: kill the task-action freeze, strip the two
outbound network integrations that made the AppImage flaky, and polish the
planner / tree-guide UI.

### Fixed
- **The app froze on every task action (drag, status change, edit) — most
  visibly on the AppImage.** Root cause: `add_task`/`update_task` awaited the
  Discord/Telegram "task changed" notification INLINE with a no-timeout
  `reqwest` client. Inside an AppImage, a stalled glibc NSS DNS lookup to the
  notification host hung the whole save until the OS TCP timeout — the `.deb`
  resolves DNS through system libraries and never hit it, which is why it
  "worked on the .deb and broke on the AppImage." Notifications are now truly
  fire-and-forget (spawned, detached) with a 10s timeout on every outbound
  call, so a task save returns to the UI instantly regardless of network.
- **Tree guide lines** were missing in the Eisenhower board and the Planner
  "Unscheduled" tray (both used plain indentation) and misaligned with the
  collapse chevrons in the Notes tree. Every view now renders the shared
  `TreeGuides` columns consistently (the Notes misalignment was a stray flex
  `gap` breaking the guide chain), and the rails use a readable colour.
- CHANGELOG had shipped with unresolved git merge-conflict markers from the
  0.48.x merge; resolved.

### Added
- **Gantt manual zoom**: a −/%/+/Fit control expands or shrinks the time axis
  (0.5×–4×), overflowing to horizontal scroll when zoomed in for finer ticks;
  1× reproduces the existing auto-adaptive axis exactly.
- **Planner subtasks as nested cards**: a scheduled block now expands in place
  to hold its subtasks as cards inside the parent card (with tree guides),
  instead of opening a detached pop-up list.
- **DateTimePicker opens at the current time** when a field has no value yet,
  so there is no long scroll from a fixed 9:00.

### Removed
- **NAS/WebDAV backup sync** — removed entirely (the `remote_sync` backend +
  its three IPC commands, the unlock-screen compare-then-restore flow, and the
  Data panel's push section/settings). Local rotating backup to
  `~/Documents/letsGoBackup` is unchanged.
- **OTA self-update** — removed entirely (the `tauri-plugin-updater`/`-process`
  plugins, the Settings → Updates panel, the opt-in startup check, and the
  `tauri.conf.json` updater config). Update by reinstalling the `.deb`.

### Changed
- The **Telegram** integration ships **disabled by default**.

## [0.48.1] - 2026-07-15

### Fixed
- **Android booted without any plugins** — the APK's bundled "resources"
  live inside the app package as assets, which ordinary filesystem
  discovery cannot traverse, so the plugin registry came up empty and the
  app was blank. All eight plugin manifests are now embedded in the binary
  at compile time and serve as the discovery fallback on every platform
  (the plugins' frontend code was always in the app bundle — only the
  manifests were missing). On-disk plugins still win whenever present, so
  desktop installs and the LETSGO_PLUGINS_DIRECTORY dev override behave
  exactly as before. Verified: the AppImage and .deb bundle plugins on
  disk correctly; Windows uses the same resource mechanism and is covered
  by the fallback either way.

### Added
- **Android build lane** (`android-build.yml`): a `v*` tag or manual dispatch
  now also produces a signed arm64 APK (CI runs `tauri android init`, wires
  a keystore into the Gradle signing config — the repo secrets
  `ANDROID_KEYSTORE_B64`/`ANDROID_KEYSTORE_PASSWORD` give upgrades a stable
  key; without them each build self-signs with a one-off key). The backend
  now compiles for mobile: tray code is desktop-gated behind one wrapper,
  and the database/log directories route through Tauri's app-data path on
  Android instead of XDG/HOME.

## [0.48.0] - 2026-07-15

### Added
- **OTA self-update** (Tauri updater plugin). The app can check a signed
  GitHub Releases feed, download the new signed build, install it, and
  relaunch — no manual reinstall. Windows updates via the NSIS installer;
  Linux via **AppImage** (the `.deb` stays for apt/manual users but can't
  self-update — that's the package manager's job).
  - New Settings → **Updates** panel: shows the running version, a "Check for
    updates" button, the available version + notes, a download progress bar,
    and an opt-in "check on startup" toggle (off by default — a check is an
    outbound call to github.com, disclosed in the panel).
  - When the opt-in startup check finds an update, a non-blocking "Update
    available" badge appears by the version wordmark and opens the panel.
  - Updates are minisign-signed; the app verifies every artifact against the
    embedded public key before installing.
  - Release CI (`.github/workflows/release.yml`) builds signed NSIS + AppImage
    (+ `.deb`) on a `v*` tag and publishes a draft GitHub Release with
    `latest.json` (the updater feed). Requires repo secrets
    `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

### Notes
- Installs older than 0.48.0 must be updated once manually to gain
  self-update (they predate the updater). `.deb` installs never self-update.
- Windows installers are not yet Authenticode-signed, so SmartScreen still
  warns on first install (the updater signature is separate from code signing).
## [0.47.0] - 2026-07-15

NAS sync over Tailscale: the NAS keeps every backup and seeds new devices.

### Added
- **Push to NAS**: backups now optionally upload to a WebDAV share (basic
  auth, e.g. `http://<your-host>:<port>` on your own network) — each push
  writes the encrypted database trio plus a `meta.json` manifest
  (timestamp, source device, app version, size) to `letsgo/latest/` AND a
  timestamped `letsgo/archive/<label>/`, so the NAS keeps history. Data
  panel → "Remote sync (NAS)": endpoint, username, password, an "also
  push after each backup" toggle, and "Push to NAS now". The automatic
  post-unlock backup pushes too when enabled; a push failure never masks
  the local backup result.
- **Compare-then-choose restore on the unlock screen** (new device / new
  laptop / fresh APK): enter the NAS address and credentials → "Check
  NAS" shows both copies side by side — NAS copy vs this device, each
  with its timestamp and size, the newer one badged "Latest" — and the
  user explicitly picks "Use NAS copy" or "Keep local". Restoring
  snapshots any existing local files into `pre-restore-<label>/` before
  overwriting, and installs via atomic rename. Works entirely pre-unlock;
  the SQLCipher passphrase/PIN never leaves the device and all data is
  encrypted in transit and at rest on the NAS.


## [0.46.0] - 2026-07-15

Automatic backups + a CI data-safety gate, born from the day's data-loss
incident.

### Added
- **Automatic rotating backups**: after every successful unlock, the app
  exports the encrypted database, key salt, and unlock-mode sidecar into a
  timestamped `letsgo-backup-<YYYYMMDD-HHMMSS>/` folder and prunes old ones.
  Settings live in the Data panel: on/off (default ON), destination
  directory (default `~/Documents/letsGoBackup`), keep-last-N (default 7),
  plus a "Back up now" button with a result line. Backend command
  `run_rotating_backup` builds on the directory-parameterized export
  helpers and extends their tests-stay-in-temp-dirs safety contract.
- **CI test gate with a data-safety canary** (`letsgo-tests.yml`): every
  push/PR now runs tsc, the full Vitest suite, and the full Rust suite on
  GitHub, with sentinel files planted at the runner's real
  `~/.local/share/letsgo` before the suites and byte/metadata-verified
  after — any future test that touches the real data directory fails CI
  loudly instead of eating someone's database.

## [0.45.0] - 2026-07-15

The mindmap grows from a picture into a working surface (ships in the same
PR as 0.44.0).

### Added
- **Mindmap search**: toolbar input (`/` focuses, Esc clears) with ranked
  matching (prefix > word boundary > substring); matches highlight, the
  rest of the map dims, Enter cycles matches and centers the viewport,
  with a live match counter.
- **Filter chips**: per-project subtree toggles, tag chips (top 8 by
  frequency), and "Has open tasks" — composable (AND across groups, OR
  within), hiding nodes/edges without re-running layout.
- **Task-status overlay**: nodes show pending / in-progress / done count
  pills (standard status colors), aggregated over each node's whole
  subtree. The counts join tasks to sections through the persisted
  task-note mirror anchors — fully independent of the (deliberately
  disabled) auto-generate-tasks-on-save pipeline.
- **Focus mode**: select a node and focus its 1/2/3-hop neighborhood
  (hierarchy, bridge, and wiki-link edges all count), with a "Show all"
  escape.
- **Backlinks panel**: the selected node lists every section/bridge
  linking to it; clicking an entry centers and selects the source.
- **Section wiki-links**: `[[Section Title]]` in a note body now draws a
  distinct link edge to that section (project links keep precedence and
  their existing bridge styling).

### Changed
- Mindmap click model: single-click selects a node (focus + backlinks);
  double-click opens it in Notes. (The shell unmounts the plugin on
  navigation, so single-click could not do both.)


## [0.44.0] - 2026-07-15

Feedback round 14 — one tree-guide language app-wide, plain status labels,
adaptive Gantt axis, native-menu suppression, collapsible task editor,
unified scrollbars.

### Added
- **Shared TreeGuides component** (`src/shared/TreeGuides.tsx`): terminal
  `tree`-style hierarchy guides — continuous vertical rails per continuing
  ancestor plus proper `pipe`/`elbow` connectors — computed by one pure rails
  algorithm and rendered pixel-identically wherever hierarchy shows: List
  view, Kanban board, Gantt rows and tray, the Planner subtask popup, the
  task editor's subtask list, and the notes tree (notebooks/sections; the
  old plain rail had no elbows). All six hand-rolled per-view guide
  implementations were deleted, and rows in a group now touch so rails run
  unbroken.
- **Gantt X-axis adapts to width**: tick granularity is chosen from a
  15-minute-to-month ladder as the finest step keeping at least 72px
  between ticks at the measured track width (live via ResizeObserver) —
  shrink the window for a coarse macro view, widen it for micro time
  detail. Sub-day ticks carry HH:mm labels (midnight major); month rungs
  fall on true calendar boundaries.

### Changed
- **Status actions say just the state**: "Move to in progress" / "Mark
  done" / "Skip" became "In progress" / "Done" / "Skipped" (and "Pending"
  in the planner popup) everywhere — clicking a state IS the action, no
  verb needed.
- **Task editor de-lengthened** into collapsed-by-default sections:
  Subtasks, Timeline (deadline, scheduled window, routine, estimate) and
  Organize (priority, parent task). Collapsed headers show a compact
  summary of their set values, so nothing is invisible; validation errors
  auto-expand the section they belong to. Title stays on top; Notes and
  Tags stay flat.
- **Planner subtask popup**: parent rows dropped the non-interactive
  status "dot" (it read as broken since it never did anything) — the
  derived status now tints the row background instead; leaf rows keep the
  interactive colored control.
- **One scrollbar language everywhere**: a global thin classic scrollbar
  (transparent track, rounded thumb) replaces WebKitGTK's mix of overlay
  indicator + default bars that stacked two scrollbars on one edge of
  popups/dropdowns/panels.

### Fixed
- Right-click no longer pops WebKitGTK's browser page menu
  (back/stop/forward/reload — only "reload" was ever active, none belong
  in a desktop app). Suppressed app-wide except over text fields, where
  the native cut/copy/paste menu still appears; the app's own context
  menus are unaffected.


## [0.43.0] - 2026-07-15

Feedback round 13 — eleven UX items across List/Board/Planner/Gantt, Notes,
and Dashboard.

### Added
- **List view inline editing**: the Priority, Tags, Deadline, Scheduled start
  and Scheduled end cells are now click-to-edit in place via small popovers —
  no need to open the full editor for a single-field change. Scheduled cells
  on a parent task stay read-only (derived from its subtasks).
- **Task editor subtasks**: each subtask's title now opens that subtask's own
  editor; the done-checkbox is replaced by the same colored status badge used
  everywhere (click → move to in progress / done / skip); and a new "Attach
  existing" dropdown parents any eligible existing task (cycle-safe: excludes
  self, ancestors, current children). Add Task supports subtasks too — new
  titles and attach picks queue locally and are created/parented right after
  the task saves.
- **Notes custom sort**: projects, notebooks (within a project) and sections
  (within a notebook) can be drag-reordered; order persists per parent via
  plugin config. Cross-parent moves remain on the "Move to project/notebook"
  menu entries.
- **Gantt axis**: adaptive datetime tick marks (3-hourly ≤2 days, daily
  ≤60 days, weekly beyond; month starts emphasized) with subtle full-height
  gridlines behind the bars, distinct from the today line.
- **Dashboard**: view filters — This week / This month / This year / All time
  plus a tag filter — now scope the stats (creation-type metrics gate on
  creation date, completion-type on completion date). Five new insights:
  completion rate, average time-to-complete, estimate accuracy, top open
  tags, and upcoming deadlines (next 7 days, never range-gated).

### Changed
- **Tree guide lines everywhere**: subtask hierarchies now render
  terminal-style ├/└ hairline guides (not bare indents) in the List view,
  Kanban board (children group under their in-column parent), Gantt row
  titles and tray, the task editor's subtask list, and the Planner subtask
  popup.
- **Planner subtask popup**: rows are a properly indented tree; each row
  carries a "⋯" action button colored by its status (click → move to
  pending / in progress / skip / done; read-only dot on derived parent
  rows); the popup widens (280–560px) to fit long task titles.
- Selecting a parent task's checkbox in the List view now also selects all
  of its descendant subtasks (and deselecting cascades the same way).
- A parent task's Gantt bar is derived from its children: it spans the
  earliest child start to the latest child end, counting deadline-only
  children as points on the timeline.
- Trailing "…" stripped from every button/menu/label across the app (kept
  inside input placeholders) — it only cost horizontal space.

### Fixed
- **Dashboard priority insight was inverted**: it bucketed by the raw stored
  priority while the app displays P0 as highest, so Urgent tasks were counted
  under P3 and Low under P0/P1. Buckets now map through the shared
  `priorityBadgeRank`, matching every other view.
- Dashboard "Total" tile read the unfiltered task count directly, so it
  would have ignored the new filters; it now comes from the same filtered
  statistics as everything else.
- Expanding a Planner block's subtasks no longer also opens the task's edit
  form (event now stops at the toggle — WebKitGTK bubbled it into the
  block's edit handler).

## [0.42.3] - 2026-07-14

### Fixed
- Emoji inserted from the GTK "Insert Emoji" picker could render as two tofu
  boxes (□□) — not a font problem. The picker appends a **duplicate variation
  selector** (e.g. man-swimming as `1F3CA 200D 2642 FE0F FE0F` instead of the
  valid `…FE0F`), which breaks the emoji's grapheme cluster so it can't shape.
  Confirmed by rendering both forms through the real WebKit2GTK 4.1 engine.
  The task editor now normalizes titles (`normalizeEmojiSequence`), collapsing
  runs of the same variation selector back to one on paste, on save, and when
  an existing malformed title is opened — so re-saving the task repairs it.
  (Reverts the earlier 0.42.1 font-stack change's premise; that was a
  misdiagnosis — the fonts were fine all along.)

### Fixed
- Task editor alignment: the "Add subtask" field rode above its button because
  the base input's stacked-field `margin-bottom` leaked into the inline row —
  zeroed it there (matching `.taskEditorRoutineIntervalInput`) and stretched
  the button to the input's height so their tops and bottoms line up.
- The editor's **Save** button rendered 2px shorter than the Cancel/Delete
  beside it because it used `border: none` while they use a 1px border; gave
  Save a transparent 1px border so all three actions share one baseline.
  (Audit confirmed the shared Dropdown/DateTimePicker/input controls already
  share a common height, so form rows elsewhere stay aligned.)

## [0.42.1] - 2026-07-13

### Fixed
- Emoji in task titles (and anywhere else) rendered as tofu boxes (□) because
  the `--font-ui` stack listed the colour-emoji fonts *after* the generic
  `sans-serif`, which terminates per-glyph font fallback. Moved `sans-serif`
  to the end so a codepoint missing from Geist falls through to Noto Color
  Emoji / Apple Color Emoji / Segoe UI Emoji before the generic last resort.

## [0.42.0] - 2026-07-13

### Added
- Task cards now show the estimated time-to-complete (when set) as a subtle
  pill, distinct from the stopwatch that shows recorded/elapsed time.
- The task editor has an inline **Subtasks** checklist: a collapsible section
  listing each child task with a done checkbox and its estimate, plus an
  "Add subtask" field — so subtasks are viewable and addable without leaving
  the editor. (The Google Calendar block in the mockup needs a Google account
  integration that doesn't exist yet, so it's intentionally omitted.)
- Planner empty hour slots reveal a dashed "＋ click to create task"
  affordance on hover, making the click-to-add gesture discoverable.
- Calendar day cells with many tasks now scroll within the cell instead of
  stretching the whole month row taller and pushing later weeks off-screen.
- Markdown → Todo import understands **outlines**: every bullet (`-`/`*`/`+`,
  with or without a `[ ]`/`[x]` checkbox) becomes a task, and a line indented
  under another (4 spaces per level; a tab counts as 4) becomes its sub-task
  (`task_repository::insert_tasks_with_hierarchy`). Non-bullet prose lines are
  still ignored, so dropping a note never explodes into a task per line.

### Fixed
- Planner drag no longer prompts to merge/keep-separate for two tasks on the
  same day at genuinely different times — the conflict check is now clamped to
  the same calendar day, so a routine/multi-day task's wide window stops
  reading as a clash on every day it spans.
- Planner drag near the left/right edge of the day grid now auto-pages the
  visible range (one day per ~650 ms held at the edge), so a task can be
  rescheduled a week or more away without releasing the drag to click the nav
  arrows.

## [0.41.0] - 2026-07-13

### Fixed
- Recurring tasks (routines) now carry a status *per occurrence* instead of
  one shared status. Marking a day skipped/done (e.g. "I didn't swim today")
  applies only to that day; every other past and future occurrence stays
  independent. Backed by a new `task_occurrence_status` table (migration
  0013) keyed by task + local calendar day; Planner and Calendar resolve each
  occurrence's badge from those per-day overrides, and the Calendar's ghost
  (repeat-preview) chips gained a status control to match.

### Added
- List view: a Notes/comments column (after Status). A task's note doubles
  as its running comment log — it renders as Markdown inline (click to
  edit; empty shows "+ comment"), and saving mirrors it into the auto-
  organized Notes record, the same as the task editor's note field.

### Changed
- Kanban Done column is now LIFO: the most-recently-finished task appears
  at the top, so a task you just completed shows up first.

## [0.39.0] - 2026-07-13

### Added
- Plugins can be reordered by dragging the grip (⠿) in the sidebar's Plugin
  control list; the new order applies to the top tab bar too and persists
  across restarts. A plugin missing from a saved order (e.g. newly
  installed) keeps its original position at the end.

### Changed
- Task status no longer tints the whole card/row/chip surface — the full
  background was too loud across a board (user feedback). Status now reads
  from the colored status badge plus a thin left-edge stripe (a colored
  border on Calendar chips); Gantt bars are unchanged since the bar itself
  is the status visualization.

### Fixed
- Expand/collapse alignment: the guide rail under an expanded parent now
  drops directly beneath its disclosure arrow in both the Todo List view
  and the Notes tree (the rail previously sat to the left of the arrow).

### Fixed
- List view: Search titles and Sort by were visually offset — the sort
  selects carried a stray `margin-bottom` meant for stacked form layouts,
  making that field taller than Search and throwing off a bottom-anchored
  row alignment. Both fields now align at the top consistently.
- Planner: a multi-day task's subtask quick-peek toggle only worked on its
  own start day — every continuation day now gets the same toggle and
  popover. The popover is now portal-rendered to `document.body` (like
  `DragOverlay` already is elsewhere in this app), fixing a stacking-order
  bug where another day's card could render on top of the popover despite
  its higher z-index.

### Changed
- Task status colors recolored: in-progress is now saffron/amber (was
  blue), pending is now pink/rose (was neutral gray), skipped is now
  indigo (was neutral gray); done stays green. Applies everywhere status
  drives a card/row/bar's color.
- Dashboard's content width cap raised from 900px to 1400px — the tighter
  cap was leaving substantial unused space on a normal desktop window.

## [0.37.0] - 2026-07-13

### Added
- Dashboard: a "Work pattern" card with a completion-score gauge (% of all
  tasks actually finished), a skip-rate gauge, and average completion
  delay (how early/late done tasks finish relative to their deadline, with
  an on-time/late split). Reschedule-count is deliberately NOT included —
  the schema has no history of a task's prior schedule to compute it from.
- Dashboard: goal tracking, authored entirely in Notes rather than through
  any Dashboard UI — write goal lines (`- [Google]:[DSA,job-hunt]:8h:1d`)
  into a Notes section titled "LetsGoal," and the Dashboard shows a
  themed progress bar per goal, computed from tagged tasks' own tracked
  time (ANY-tag match, so single- and multi-tag tasks both count). No
  add/edit controls live in the Dashboard by design.

## [0.36.0] - 2026-07-13

### Added
- A task's note now renders as formatted Markdown wherever it's shown
  (the Board card's note popover), matching how the Notes plugin's own
  preview already renders — lists, bold, links, etc. instead of raw
  dashes and asterisks.
- A task's note doubles as its "comment": every save now auto-syncs it
  into the Notes plugin under `LetsGo_<year>` > `working_<month>` >
  `tasks_<tag>`, grouped by the task's own tag set so a multi-tag task
  lands in one combined section instead of being duplicated per tag.
  Re-saving the same task updates its existing entry in place rather than
  appending a duplicate.

## [0.35.0] - 2026-07-13

### Added
- List view: every column can now be resized by dragging its right edge
  (widths persist per-column via a new `useResizableColumnWidths` hook).
- List view: Priority, Tags, and Status columns are now click-to-filter
  from their own header — a checkbox multi-select popover, with the
  active selection echoed below the column name as small pills. Deadline
  and Created keep the existing date-range picker, now anchored under
  their own header instead of a shared side panel.
- List view: a "Bulk edit…" button beside the selection count opens a
  dedicated bulk-edit card (priority, tags, deadline, scheduled start/end,
  set parent, all in one place) instead of a tabbed side popover.

### Changed
- List view: Search and Sort now live in a persistent bar alongside the
  bulk-action controls (selection count, bulk edit, delete) instead of a
  separate "Filters" popover toggle that had to be opened to reach them.

## [0.34.0] - 2026-07-13

### Changed
- Priority is now text-only (the "P0"-"P3" badge) — the small color-coded
  priority dot is removed everywhere (Board, Eisenhower, List) now that
  status owns each card's full background color.
- The "..." options menu (which only ever held status actions) is replaced
  by a clickable status badge showing the task's actual status word
  ("Pending"/"In progress"/"Done"/"Skipped") across every view — Board,
  Eisenhower, Planner, Calendar, Gantt, and List. Clicking it opens the
  same status-change dropdown the "..." menu used to. A parent task's
  derived status renders as plain read-only text (its status isn't
  independently settable).
- Eisenhower cards show status for the first time (previously had no
  status indicator at all) with the same full-background treatment as
  every other view.

## [0.33.0] - 2026-07-13

### Fixed
- Todo commands surfaced raw `sqlx` error text to the user (e.g. "error
  returned from database: (code: 787) FOREIGN KEY constraint failed")
  instead of a plain message. A shared `friendly_database_error` helper
  now translates known cases (missing row, foreign-key/unique violations)
  into plain language everywhere `src-tauri/src/todo/mod.rs` previously
  mapped a `sqlx::Error` straight through `.to_string()`.

### Changed
- Notes editor toolbar: Format, Color, and Markdown help move into a
  single "⋯" overflow menu, leaving Preview/Export/Save section as the
  toolbar's only direct buttons — six same-weight buttons in a row down
  to three.

## [0.32.0] - 2026-07-13

### Added
- Planner: dropping a task onto a slot another top-level task already
  occupies now asks whether to make the dragged task a subtask of it, or
  keep both as independent tasks rendered side by side — previously this
  silently just scheduled both into the same slot with no prompt.
- A shared `TagInput` chip editor replaces the "comma separated" raw-text
  tags field in the task editor — editing tags now looks like the pill
  chips they render as everywhere else.

### Changed
- One shared primary-button treatment (`--accent-molded`) now applies to
  every "save/confirm" button app-wide — Notes' "Save section", Telegram/
  Discord "Save", and the Security passphrase "Save" previously used a
  plain neutral style while the task editor's "Save task" used the accent
  treatment.
- Dashboard, Telegram, and Discord settings panels are now centered with
  a max-width instead of sitting flush top-left on a wide window.
- Gantt's task-name column widened (160px to 220px) and its bar minimum
  width increased (4px to 10px) so short-duration tasks are still visible
  and clickable.
- The task editor groups its fields into Title / Scheduling & organization
  / Notes & tags with subtle dividers instead of one flat list.
- Notes' tree-row bulk-select checkbox is now hidden until hover/focus (or
  already checked), decluttering the default view.

## [0.31.0] - 2026-07-13

### Fixed
- DateTimePicker's hour/minute rollers stole page scroll: React's synthetic
  onWheel is passive, so preventDefault() silently did nothing — scrolling
  bubbled to the page until it hit its own boundary before the roller
  responded. RollerPicker now attaches a native, explicitly non-passive
  wheel listener.
- Two popovers never closed on outside click or Escape: the Todo card's
  inline note popover, and Notes' "Other extension" export form. Both now
  use the shared useSingleOpenPopover hook already used everywhere else.
- Markdown-imported task titles pasted as `[label](url)` showed the raw
  link syntax verbatim on every card/row. The parser now renders just the
  label; already-imported tasks keep their existing titles.
- Multi-day scheduled ranges (e.g. a parent task's derived window) showed
  only a clock-time end with no date, reading as backwards ("3:00 PM -
  9:00 AM"). The end date now shows whenever it differs from the start.
- Gantt's unscheduled-task tray had a redundant standalone "Edit" button
  beside the shared options menu; the title itself is now the edit
  trigger, matching every other card style in the app.
- Priority dropdown showed word labels ("Urgent") with no visible mapping
  to the "P0"/"P1" badges used everywhere else; options now show both.
- Empty Kanban columns and empty Eisenhower quadrants showed nothing;
  each now shows a one-line hint instead of looking broken/unloaded.

## [0.30.2] - 2026-07-13

### Fixed
- Planner: a task/parent whose derived schedule spans multiple calendar
  days still rendered as one giant block on its OWN start day, bleeding
  through every hour to midnight and burying whatever else was scheduled
  that evening — the 0.30.0 fix only covered later (continuation) days,
  never the start day itself. The start-day block is now bounded by the
  same daily clock-time window as every other day it spans (e.g. a
  15:00-start task with an end 18 hours later now shows its correct
  1-hour daily window on day one too, not a ~9-hour block). Recurrence
  ghost blocks got the identical fix.

## [0.30.1] - 2026-07-13

### Fixed
- Planner: dragging a parent task to a new time only moved the parent's OWN
  (subtask-derived) window and left every subtask behind at its original
  time — the parent's window would then just snap back to cover the
  unmoved subtasks. Dragging a parent now shifts every subtask by the same
  time delta, preserving each subtask's own start time and duration
  relative to the group; the parent's derived window naturally re-widens
  to match. Applies wherever the shared reschedule mutation is used
  (Planner drag, Calendar drag).

## [0.30.0] - 2026-07-13

### Fixed
- Planner: a task (independent or a parent whose window auto-widens from
  its subtasks) whose schedule spans multiple days rendered as one giant
  block occupying every hour, day and night, on every day in between —
  implying 24/7 work that was never scheduled, and burying every other
  task underneath it. It now repeats the SAME daily clock-time window
  (e.g. 10am-12pm) as its own small card on every day it spans, matching
  what was actually scheduled. Every day's card is now a real mini card
  (status-tinted, with the options menu) instead of a bare title strip.

## [0.29.1] - 2026-07-13

### Changed
- Todo: a parent task's derived status is now three-tiered instead of
  binary — "done" only once every subtask is done, "in_progress" only
  while at least one subtask is ACTUALLY in progress, otherwise "pending".
  Previously any non-done mix of subtasks (even all still untouched and
  pending) locked the parent at "in_progress", which read as active work
  happening when nothing had actually been started yet.

## [0.29.0] - 2026-07-13

### Added
- Todo: a parent task's status and schedule are now DERIVED from its
  subtasks instead of independently settable. Status auto-marks done only
  once every subtask is literally done (a skipped subtask blocks
  auto-completion, keeping the parent at in_progress); otherwise it's
  in_progress. The schedule window always widens/shrinks to
  [earliest subtask start, latest subtask end], recalculated on every
  subtask add/remove/reparent/reschedule, and cascades through multi-level
  nesting (a change several levels down ripples to the root). Manual
  status/schedule changes on a parent are ignored server-side and the
  "⋯" options menu / editor schedule fields hide themselves once a task has
  subtasks, replaced by a read-only derived-window summary in the editor.
- Todo/Planner: a subtask with a fixed daily time window across many days
  (e.g. 10am-12pm daily for 10 days) now renders each day's occurrence as
  an interactive block — the options menu marks the whole run done from
  any single day, and every other day's block reflects that same status
  live, since they all read the same underlying task. Reuses the existing
  recurrence data purely as scheduling info; still not draggable/resizable
  (a ghost has no schedule of its own to move).
- Telegram: every bot reply (help, task list, add/done/delete/edit
  confirmations, errors, the tagged-task push notification) is reformatted
  as a card — bold headers, monospaced ids/chat-id, status emoji, and an
  aligned `/help` command table — instead of a run-on paragraph. User text
  (titles, tags) is now HTML-escaped before being embedded, since replies
  send in Telegram's HTML parse mode.

## [0.28.0] - 2026-07-13

### Fixed
- Todo: dragging a card/block to reschedule/re-column/re-quadrant/re-day
  could silently snap back to its origin instead of moving, once the card
  grew tall/wide enough to have a subtask chevron. Every draggable
  card/block/bar doubles as its own drop target (`task-drop-{id}`, for the
  "drag onto another task to set its parent" gesture); dnd-kit's default
  collision detection had no awareness that a droppable belongs to the
  item being dragged, so a big-enough card's own drop zone could
  out-compete the real target underneath the pointer. Added a shared
  collision-detection override (`excludeSelfDropTarget`) to every board
  view's `DndContext` that excludes the dragged item's own drop zone from
  consideration.
- Eisenhower: dragging a parent task with subtasks to another quadrant
  moved only the parent — a quadrant is a pure function of `task.priority`
  alone, and subtasks were never linked to their parent's quadrant; they
  just happened to share its original priority, which is why they looked
  like they "came back" when the parent was dragged back. The quadrant
  drop now cascades the same priority change onto every descendant.

### Added
- Todo/Notes: the import-confirmation ("Imported N tasks..."), export-
  confirmation ("Exported to..."), format-normalize, and send-checkboxes-
  to-Todo info lines now auto-dismiss a few seconds after they appear,
  instead of lingering until the next action or an explicit dismiss.

## [0.27.1] - 2026-07-13

### Added
- Todo: the "⋯" options menu now offers "Move to in progress" and "Skip"
  alongside "Mark done" on every card/row, everywhere it appears — each
  entry hides itself when the task is already in that status, so the menu
  always shows exactly the statuses a task isn't currently in.

## [0.27.0] - 2026-07-13

### Added
- Todo: a "⋯" options menu on every task card/row across Board, Eisenhower,
  Calendar, Gantt (row titles and the tray), Planner (the tray and
  scheduled blocks), and List, with a "Mark done" action — no more needing
  to drag a card to a Done column/quadrant or open the full editor just to
  close out a task. Hidden on cards already marked done.

### Fixed
- Planner: the subtask quick-peek popover (0.26.0) never actually
  appeared — its parent block's `.plannerBlockGlass` treatment applied
  `backdrop-filter`, which creates a new CSS containing block for the
  popover's `position: fixed`, clipping it to the block's own tiny
  `overflow: hidden` rect instead of positioning it against the viewport.
  Dropped the blur, kept the translucent background.
- Todo: Kanban card titles were drifting toward the center — same
  `justify-content: space-between` layout bug as Eisenhower's (0.25.1),
  introduced when the subtask chevron became a new sibling in the card
  header. Titles are left-aligned again.

## [0.26.0] - 2026-07-13

### Added
- Todo: Planner subtask quick-peek — a scheduled block's subtask chevron
  now opens a click-outside-to-close popover listing every descendant
  (scheduled or not), instead of revealing subtask blocks on the time grid
  (which rendered them "side by side" via the overlap-lane algorithm).
  Clicking a subtask in the popover opens its editor directly. The
  unscheduled tray's own in-place accordion expand is unchanged.

### Fixed
- Todo: selecting a different task while the task editor was already open
  no longer requires closing it first — the editor previously seeded its
  form fields once on mount and silently kept showing the first task's
  data on every subsequent selection (no remount, since nothing keyed it
  per target task); it now swaps in place.

## [0.25.1] - 2026-07-13

### Fixed
- Planner: an expanded parent task's own block now goes semi-transparent
  ("glass") so its subtask blocks sharing the grid read clearly instead of
  the opaque parent visually dominating.
- Eisenhower: card title text was drifting off the left edge — the card's
  `space-between` layout was distributing gaps between the chevron, title,
  and priority badge instead of hugging the title next to the chevron.
  Cards now read left-aligned as "▸ 3  Title" with the badge pinned right.
- Gantt: the prev/next window arrows were spread away from the range label
  (same `auto-fit` grid bug Calendar had already been fixed for). Toolbar
  now clusters the arrows around the label and adds a Today button that
  jumps straight to whichever window currently contains today's date.

## [0.25.0] - 2026-07-13

### Added
- Todo: collapsible subtask tree in Kanban, Eisenhower, Gantt, and Planner —
  a parent task with subtasks shows a chevron and subtask count (e.g. "▸ 3"),
  collapsed by default. Only one parent's branch is expanded at a time per
  view; expanding another auto-collapses whichever was open, and the whole
  branch (to arbitrary depth) shows once its root is expanded. Gantt applies
  this to both timeline bars and the unscheduled tray; Planner applies it to
  both the unscheduled tray and scheduled grid blocks, including hiding a
  collapsed subtask's recurrence-ghost previews.

## [0.24.0] - 2026-07-13

### Changed
- Design system: full GitHub Primer rewrite. Removed the 6 decorative accent
  themes and neumorphism entirely — dark/light now use GitHub's own dark/
  light palettes end to end (surfaces, hairlines, text, accent, status
  colors), and every chrome control (buttons, inputs, selects, the
  segmented control, the pill switch track excepted) uses GitHub's 6px
  rounded-rect radius instead of a fully-round pill. Small text/count
  badges (tags, priority badges, "today" markers) keep their pill shape —
  that's GitHub's own Label convention, not leftover neumorphism.
- Todo: sub-tasks — dragging any task card onto another, in any view
  (Board, Eisenhower, Gantt, Planner, Calendar), sets the dropped task as
  the target's child, with a live accent-ring drop-target indicator. List
  view's multi-select now has a "Set parent…" bulk action covering the
  same intent for flat/tree browsing. List view's subtask nesting is
  restyled as a GitHub-style file tree (per-depth vertical guide lines
  instead of bare indentation).
- Notes: bulk-select checkboxes now cascade — checking a project selects
  every notebook and section beneath it (and a notebook cascades to its
  sections); unchecking cascades the same way. Double-clicking any
  project's checkbox selects (or, if everything's already selected,
  clears) every project/notebook/section in the tree at once.

## [0.23.0] - 2026-07-13

### Added
- Todo: sub-tasks — tasks can now have a parent task (`task.parent_task_id`,
  present in the schema since migration 0002 but never wired up until now).
  A "Parent task" picker in the shared task editor (reachable from every
  board) sets/clears the link, with cycle prevention (a task can't become
  its own ancestor's parent). List view renders sub-tasks nested under
  their parent as a collapsible tree, to arbitrary depth. Deleting a parent
  orphans its direct children instead of deleting them.
- Notes: bulk deletion — multi-select checkboxes on projects/notebooks/
  sections in the tree, with a "Delete selected" bar and inline confirm.
  Selecting both a parent and its own child is deduplicated before
  deleting (cascade already removes the child).
- Settings: 6 decorative accent themes (Lavender Teal, Moss, Coral Mint,
  Ocean, Sunset, Terracotta) recoloring buttons, focused text fields,
  popups, and the Gantt hover ring — picked from a new Theme panel.
  Surfaces and task-status colors are untouched by every theme.
- Sidebar: drag-to-resize (same mechanism as the Notes tree panel), so the
  Theme panel's swatch grid has room to breathe.

### Changed
- Sidebar section selection (Plugin control/Settings, and the nested
  Security/Archive/Data/Theme choice) now uses a vertical sliding
  SegmentedControl — the same mechanism as the top plugin-tab bar, oriented
  vertically — instead of individually-styled accordion toggle buttons.
  Spacing between sidebar sections is now one consistent gap instead of
  each panel managing its own margin.
- Planner: the live time readout shown while dragging a task now also
  appears when dragging a fresh task off the Unscheduled tray (previously
  only shown when repositioning an already-scheduled block).
- Notes export now opens a native Save dialog (`tauri-plugin-dialog`) so you
  choose the destination folder and filename instead of always writing to
  `$HOME/Downloads`; cancelling the dialog aborts the export.
- Notes: file-path-looking text in a section body (e.g. `/home/user/docs`
  or `C:\Users\me\docs`) renders as a clickable link in the preview panel
  that opens with the OS's `file://` handler (`tauri-plugin-opener`) —
  skips text already inside a real link, inline code, or a fenced code
  block.
- Notes: "Import folder…" maps a folder tree onto the notes hierarchy —
  each level-1 subdirectory becomes a project, each of its subdirectories
  becomes a notebook, and the `.md` files inside those become sections.
- Settings → Data: "Export all data…" / "Import data…" copy the encrypted
  database file, its key-derivation salt, and the unlock-mode sidecar to/
  from a chosen folder — moving the whole app (tasks, notes, timers,
  settings) to a different machine. Import takes effect on next restart and
  still requires the same passphrase/PIN to unlock.
- Long item names (notes tree entries, Gantt unscheduled-tray cards,
  Eisenhower card titles) now wrap onto multiple lines instead of
  truncating with an ellipsis when the sidebar/window is narrow.

### Fixed
- Gantt: the "done" and "skipped" status bar colors were below the 3:1 WCAG
  contrast minimum against the light-theme surface (2.97:1 and 2.37:1) —
  darkened both.
- Planner: the drag-time readout was rendered but silently clipped
  invisible the whole time — `.plannerCardDragging`'s `overflow: visible`
  lost to `.plannerBlock`'s later-declared `overflow: hidden` on equal
  CSS specificity (source order). Fixed with a higher-specificity compound
  selector.

## [0.22.0] - 2026-07-13

### Added
- Notes export now opens a native Save dialog (`tauri-plugin-dialog`) so you
  choose the destination folder and filename instead of always writing to
  `$HOME/Downloads`; cancelling the dialog aborts the export.
- Notes: file-path-looking text in a section body (e.g. `/home/user/docs`
  or `C:\Users\me\docs`) renders as a clickable link in the preview panel
  that opens with the OS's `file://` handler (`tauri-plugin-opener`) —
  skips text already inside a real link, inline code, or a fenced code
  block.
- Notes: "Import folder…" maps a folder tree onto the notes hierarchy —
  each level-1 subdirectory becomes a project, each of its subdirectories
  becomes a notebook, and the `.md` files inside those become sections.
- Settings → Data: "Export all data…" / "Import data…" copy the encrypted
  database file, its key-derivation salt, and the unlock-mode sidecar to/
  from a chosen folder — moving the whole app (tasks, notes, timers,
  settings) to a different machine. Import takes effect on next restart and
  still requires the same passphrase/PIN to unlock.
- Long item names (notes tree entries, Gantt unscheduled-tray cards,
  Eisenhower card titles) now wrap onto multiple lines instead of
  truncating with an ellipsis when the sidebar/window is narrow.

## [0.21.19] - 2026-07-12

### Fixed
- Todo Gantt view: task bars now fill with the same solid
  `--status-*-edge` colors used by the todo cards and dashboard status bar
  (pending/in-progress/done/skipped), replacing the previous gray
  `color-mix()` blends that made bars blend into the track and left
  "pending" bars with no color rule at all — status now reads at a glance
  instead of as gray-on-gray luminance steps.

## [0.21.18] - 2026-07-11

### Fixed
- Planner "Week" range now starts on the configured week-start day (Settings
  → Week starts on) instead of always starting on today's weekday. 0.21.17
  only reordered the Calendar month grid; the Planner week view (the one
  that showed e.g. Saturday–Friday) now respects the setting too, live.

## [0.21.17] - 2026-07-11

### Added
- Settings: a "Week starts on" control (Sunday / Monday / Saturday). The
  Calendar's month grid reorders its weekday headers and day alignment
  accordingly, and updates live when the setting changes (no app restart).

## [0.21.16] - 2026-07-11

### Changed
- Sidebar: added a "Settings" section and moved Security and Archive under
  it (as a nested single-open accordion), so the sidebar now has just
  "Plugin control" and "Settings".

## [0.21.15] - 2026-07-11

### Fixed
- Planner: the drag time badge was clipped to a small notch by the block's
  `overflow: hidden`; the dragging block now sets `overflow: visible` so the
  badge shows fully above it.

## [0.21.14] - 2026-07-11

### Changed
- Planner: dragging a scheduled block now snaps to a 15-minute grid
  (:00/:15/:30/:45) from the drag distance instead of only landing on the
  hour, and a small time badge floats above the block while dragging so you
  can see the target time (e.g. "9:15") before releasing.
- Planner: opens scrolled to the current time when today is in view, so
  tasks around now are visible without scrolling up/down.

## [0.21.13] - 2026-07-11

### Added
- Planner and Calendar: hovering an empty cell now highlights it, and a
  single click opens the add-task editor prefilled with that slot's time
  (the clicked hour in Planner, 09:00 that day in Calendar). Clicks on an
  existing task block/chip still open its own editor.

### Fixed
- Notes "Set icon" picker: wide emoji (🛠️/🗂️) no longer overflow the popup's
  right edge — the grid dropped from 8 to 6 columns and cells clip instead
  of forcing the grid wider (`min-width: 0`).

## [0.21.12] - 2026-07-11

### Changed
- Todo: the "Add task" button is now in the workspace header, visible from
  every view (Board, Planner, Calendar, Eisenhower, Gantt, List) instead of
  only the Board tab.

## [0.21.11] - 2026-07-11

### Changed
- RollerPicker (used by DateTimePicker hour/minute, Archive Custom days,
  Timer minutes) reworked app-wide: it now shows only the selected value in
  a single-row window instead of ~5 rows, wheel/Arrow stepping wraps around
  infinitely (last→first and back), and it's sized/bordered like the app's
  other field controls (hairline border, `--radius-sm`, `--text-sm`) to
  blend in.

## [0.21.10] - 2026-07-11

### Added
- Planner: recurring/routine tasks that have a scheduled time-of-day now
  show a computed-on-read "ghost" block on every repeat day in the visible
  range (not just their start day), positioned at the template's time and
  styled like the calendar's ghost occurrences — non-draggable, click opens
  the template task's editor.

## [0.21.9] - 2026-07-11

### Changed
- Archive "Custom days" and the Timer custom-minutes field now use the
  scroll-snap count roller (`RollerPicker`, same component as the time
  selector) instead of a plain number input.

## [0.21.8] - 2026-07-11

### Fixed
- Archive: changing the archive window (including Custom days) now live-
  refreshes the open Todo views (Board/Planner/Calendar) instead of
  requiring an app restart. The Archive panel dispatches a
  `letsgo:archive-window-changed` event on save and TodoWorkspace re-reads
  the setting into its filter state.

## [0.21.7] - 2026-07-11

### Changed
- Notes: auto-save no longer auto-creates Todo tasks from checkbox lines. A
  half-typed `- [ ]` line used to become a stray task on every idle
  auto-save; saving now persists the note body only. Sending checkboxes to
  Todo is explicit — the section context menu's "Send checkboxes to Todo"
  action (unchanged). Removed the now-unused auto-import machinery and its
  per-section localStorage idempotency guard.

## [0.21.6] - 2026-07-11

### Fixed
- Emoji (📅🛫🏁, note tree icons, etc.) rendered blank on Linux/WebKitGTK
  because the UI font stack had no emoji fallback: appended Noto Color
  Emoji / Apple Color Emoji / Segoe UI Emoji to `--font-ui`. (The OS also
  needs the `fonts-noto-color-emoji` package installed.)
- Calendar: the month grid was clipped at the bottom in short/minimized
  windows — it now scrolls (`overflow-y: auto`) instead of `hidden`.
- Calendar: recurring-task ghost chips no longer append an uppercased
  "REPEAT" label after the title; the distinct ghost styling already marks
  them, so only the task name shows.
- Plugin Control: a long plugin name (e.g. "Example Hello Plugin") no
  longer bumps its home radio onto a second line — the name/switch block
  now uses a `flex-basis: 0` so the radio stays on the first line while
  the name wraps within the leftover width.

## [0.21.5] - 2026-07-11

### Added
- Title bar: the app version now renders as a small muted subtitle directly
  under the "LET'S GO ▸▸" wordmark. It reads from `package.json`'s version
  (kept in sync with `Cargo.toml` via `pnpm version:sync`) injected as the
  compile-time `__APP_VERSION__` constant, so the UI never hardcodes or
  drifts from the released version.

## [0.21.4] - 2026-07-11

### Added
- Todo Planner and Calendar: a "Today" button in each toolbar that jumps
  the view back to the current date range / month after navigating away.

### Changed
- Todo Planner toolbar: the Day/3-days/Week range buttons now pin left and
  the date-range nav sits dead-centre (a 3-column grid), instead of the
  earlier `auto-fit`/`minmax` grid that offset the range buttons and shoved
  the date range to the far edge on wide views.
- Todo Calendar toolbar: the ‹ / › month arrows now hug the month label in
  a centred nav group instead of being spread apart across stretched
  columns.
- Todo: the add/edit Task Editor side panel is narrower (320px, was 420px)
  so the board views keep more room when it is open.
- Plugin Control sidebar: a plugin row's home radio no longer drops onto a
  second line when the plugin name is long — the name/switch block now
  shrinks and the name wraps, keeping the radio aligned on the first line
  like every other row.

## [0.21.3] - 2026-07-11

### Fixed
- Notes: the actual root cause of the line-number gutter misalignment,
  invisible to jsdom tests. The hidden measurement mirror carries both
  `.notesEditorBody` (which sets `inset: 0`) and `.notesLineMirror` (which
  only overrode `top`/`left`/`height`) — with `top: 0` AND the inherited
  `bottom: 0` both pinned, CSS resolves `height: auto` on an absolutely
  positioned box to FILL its containing block, so on a real layout engine
  every mirror measurement returned the full editor-panel height instead of
  the measured text's height. Both the per-line wrap counts and the
  gutter's total height were therefore panel-sized, spreading the line
  numbers evenly across the whole panel. The mirror now un-pins
  `bottom`/`right` so `height: auto` tracks content. Also subtracts the
  mirror's vertical padding from per-line measurements (a ~20px line
  measured ~36px with padding, rounding to 2 rows per line).

## [0.21.2] - 2026-07-11

### Fixed
- Notes: the line-number gutter was still badly desynced for short,
  unwrapped notes even after 0.21.1's padding fix — the real cause is that
  `.notesEditorRow`/`.notesEditorSurface` are both `flex: 1`, so the
  textarea fills the whole editor panel's available height. When a short
  note doesn't overflow that box, `textarea.scrollHeight` reports the
  box's own (often much taller) `clientHeight`, not the note's actual
  content height — every gutter row's `flex-grow` then stretched across
  that inflated total, producing growing gaps between line numbers even
  for a handful of short lines. The gutter's height is now derived by
  measuring the whole note body in the existing hidden mirror element
  (same font/wrap metrics as the textarea) instead of reading
  `textarea.scrollHeight`, giving the note's true content height whether
  or not the textarea is currently scrollable.

## [0.21.1] - 2026-07-11

### Fixed
- Notes: the line-number gutter still drifted from the text on short,
  unwrapped notes even after 0.21.0's scroll-desync fix — `.notesLineGutter`
  carried its own vertical padding *outside* the height-pinned
  `.notesLineGutterContent` box, while the textarea's equivalent padding
  was already counted inside its own `scrollHeight`. The mismatch (two
  `var(--space-2)` worth of extra height) got redistributed as growing
  gaps between line numbers via `flex-grow`. The padding now lives inside
  `.notesLineGutterContent`, matching how the textarea accounts for it.

## [0.21.0] - 2026-07-11

### Added
- Notes: markdown-all-in-one-style shortcuts — Ctrl/Cmd+B and Ctrl/Cmd+I
  toggle bold/italic on the current selection, and pressing Enter inside a
  `- `/`1. `/`- [ ] ` list line auto-continues the list (incrementing
  ordered-list numbers), exiting the list instead when the current line is
  an empty list item.

### Changed
- Todo: every popover in the app (Dropdown, ContextMenu, EmojiPicker,
  ColorSwatchPicker, DateTimePicker, and the List view's filter/bulk-edit
  panel) now shares one `useSingleOpenPopover` coordination hook — opening
  any one closes whichever other popover was open app-wide, and a popover
  now correctly reopens on a second click of its own trigger (previously
  required clicking a different field first).
- Todo List view: the separate filter panel and bulk-edit panel are merged
  into one popover behind a single "Filters" / "Filters & edit selected"
  trigger, with a segmented-control tab switching between "Filter" and
  "Edit selected" sections once a selection is active; bulk priority now
  uses the shared `Dropdown` control instead of a native `<select>`.
- Todo List view: Deadline/Scheduled start/Scheduled end/Created table
  headers and filter/bulk-edit field labels now carry contextual emoji
  (📅/🛫/🏁/🕓) to match the Task Editor's existing convention.
- Todo: the add/edit Task Editor now renders as a fixed-width left panel
  beside the active board view (Kanban/Eisenhower/Gantt/Planner/
  Calendar/List) at viewport widths ≥900px, instead of stacking above it
  and pushing the board down; narrower windows keep the stacked layout.
- Todo Eisenhower view: the actively-dragged card now renders in a
  `@dnd-kit` `DragOverlay` portalled to `document.body`, so it floats above
  every quadrant during a drag instead of being clipped by the destination
  quadrant's own scroll container.
- Todo Planner/Gantt/Calendar toolbars: fixed-width range/month labels
  replaced with a responsive `repeat(auto-fit, minmax(Npx, 1fr))` grid
  track, matching the pattern already used by the Kanban board columns.

### Fixed
- Notes: the line-number gutter still drifted out of sync on long, scrolled
  notes because the invisible wrap-measurement mirror and the real textarea
  didn't reserve the same content width once a scrollbar appeared — both
  now set `scrollbar-gutter: stable` so their wrap points always match.
- Todo: the roller-based time picker showed a native scrollbar despite
  being wheel/scroll-snap driven; the scrollbar chrome is now hidden.

## [0.20.0] - 2026-07-11

### Added
- Todo: tasks now carry an optional `estimateMinutes` field (migration
  0012), set via preset 15/30/45/60-minute buttons or free entry in the
  Task Editor; the Planner sizes scheduled blocks proportionally to it,
  falling back to 60 minutes when unset.
- Todo: date/time popovers now use a 3D roller time selector
  (`RollerPicker`) — twin hour/minute scroll tracks split by a colon, with
  edge fade masks and `scroll-snap-type: y mandatory` /
  `scroll-snap-align: center` for tactile alignment.
- Todo: only one date/time picker popover can be open at a time
  (`useSingleOpenPicker`) — opening a new one now closes any other.

### Changed
- Todo board: the "Add Task" button moved to the left of the toolbar, and
  board columns now use a responsive
  `grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))` track
  instead of a fixed 5-column layout.
- Todo list view: Deadline/Scheduled start/Scheduled end labels now carry
  contextual emoji (📅/🛫/🏁) for faster visual scanning.
- Task Editor: the routine "until" end condition now reuses the task's own
  `scheduledEnd` field instead of a separate duplicate date input.

### Fixed
- Notes: the line-number gutter no longer drifts out of sync with the
  editor's scroll position on a fast/coalesced scroll — the gutter's row
  stack now lives in a height-pinned `.notesLineGutterContent` wrapper
  matched to the textarea's own `scrollHeight`, instead of hanging the
  height hint off the first row directly (which measured nothing).

## [0.19.0] - 2026-07-10

### Added
- Design system: a new `--accent-molded` token pair (teal, distinct from the
  reserved launch-ember `--accent`) with its own dual-shadow raised/inset
  pair, for controls that need a "primary molded action" read without
  spending the reserved glyph accent.

### Changed
- Todo Planner: the grid now covers the full day (00:00–24:00) instead of
  06:00–22:00.
- Text inputs, textareas, and selects (`.taskEditorInput`) now rest raised
  and sink to an inset well only on focus/focus-within, instead of staying
  permanently sunken.
- "Save task" (TaskEditor) and the selected day in the deadline/schedule
  picker now use the new molded-accent styling instead of a near-white
  `--text-primary` surface.
- Priority badges (`.todoCardPriorityBadge`) and List-view filter/tag chips
  (`.listViewChip`) now use `--text-primary` at rest for WCAG AA contrast.
- The Bulk Action bar's three date pickers (Deadline / Scheduled start /
  Scheduled end) now show a visible label above each field instead of
  relying solely on their (identical-looking) "Pick a date…" placeholder.
- The Plugin Control sidebar's home-view radio now renders as a themed
  neumorphic dot instead of the browser's native (visually noisy) radio
  control.

### Fixed
- List view: the "Filters" toggle button had no CSS rule at all and was
  falling through to the browser's native button chrome — a flat, low-
  contrast pill against the dark theme. It now uses the same raised/inset
  chrome-tier recipe as the rest of the toolbar.

## [0.18.0] - 2026-07-10

### Added
- Notes editor: debounced auto-save (flushes on section switch and unmount, so
  navigating away never loses unsaved content), a "Markdown help" reference
  panel (headers, bold/italic, lists, todo checkboxes, links, code fences,
  blockquotes, tables), and moving a whole notebook (with its sections) to a
  different project via a new "Move to project…" entry.
- Todo Planner view: drag the bottom edge of a scheduled task block to resize
  its duration in 15-minute increments (Superproductivity-style
  resize-to-reschedule).
- Todo List view: default sort (pending tasks first, then soonest deadline)
  plus a user-facing sort control (field + direction).
- Board view task cards now show the task's planned/scheduled time when set,
  not just its deadline.
- A shared scrollable "roller" time picker (`RollerPicker`) replaces the
  Hour/Minute dropdowns in the deadline/schedule picker, eliminating popover
  clipping and scrolling the current selection into view on open.
- Per-plugin "Default view" (and, for the Todo plugin's Board tab, "Default
  sub-view") setting in the plugin control sidebar, persisted per plugin and
  applied on next launch.
- Archive panel gains a "Custom" window preset with a "last N days" number
  input.

### Changed
- Markdown re-import now updates an already-imported task's status in place
  (matched by source file + title) instead of creating a duplicate task.
- The Kanban board's "Rescheduled" column/status is retired; rescheduled
  tasks now land in "Pending" (existing rows are backfilled by migration).
- Todo List view's filter bar and bulk-edit bar are each consolidated into a
  single popover ("Filters", "Edit selected") instead of several separate
  inline field/button pairs; no filter or bulk-edit capability was removed.
- Notes editor: fixed a caret/gutter-line-number drift bug where a wrapped
  long line desynced the gutter's line numbers from the caret's true visual
  row; the gutter now tracks visual (wrapped) rows instead of raw logical
  lines.
- The sidebar-collapsed title bar no longer clips/overlaps the "LET'S GO"
  wordmark under the plugin tab bar.

### Removed
- The notes editor's "Insert link" toolbar button (`[]()`  markdown syntax
  is sufficient on its own).

## [0.17.0] - 2026-07-10

### Changed
- Renamed the board sub-view "Board" to "Kanban" for disambiguation from the
  top-level Board/Planner/Calendar switcher.
- Sidebar (Plugin Control/Security/Archive) redesigned as a pill-style accordion
  with mutually exclusive expansion and standardized typography (--text-sm,
  weight 600, natural case).
- Top plugin tab bar's left edge now aligns to the sidebar's right edge via
  shared CSS custom properties (no drift possible in collapsed/expanded states).
- DateTimePicker's Hour and Minute controls replaced with the `Dropdown`
  component (fixes invisible white-on-white on WebKitGTK dark theme).
- Planner view now renders multi-day/spanning tasks (was using strict start-day
  containment; now uses interval overlap detection, and continuation days show
  a `ContinuationTaskBlock` with a leading glyph).
- Planner view splits overlapping tasks into side-by-side lanes instead of
  stacking them invisibly (uses a sweep-based overlap-lane algorithm per day).
- Eisenhower quadrant assignment is now a pure function of task `priority` only
  (urgent→Important&Urgent, high→Urgent-not-important, medium→Important-not-urgent,
  low→Neither); deadline-driven urgency has been removed. Quadrant drops now set
  `priority` only, leaving `deadline` untouched.
- Tasks now show a non-accent priority-color dot (6px, urgent→red, high→amber,
  medium→green, low→blue) distinct from the status tint/stripe.
- Planner view gains a live "now" indicator line (1-2px horizontal rule,
  `--accent-red`) positioned at the current time-of-day in today's column only
  (updates every 60 seconds; absent when the visible range excludes today).
- Planner's unscheduled-tasks tray is now hidden when empty, reclaiming timeline
  space; `.plannerBody` reflows to a single full-width column (`.plannerBodyNoTray`).

### Added
- Task recurrence/routines: daily/weekly/monthly/yearly/specific-days/count-or-until
  end condition. Set/clear via TaskEditor; persists via new `task_recurrence`
  table (migration 0010). CalendarView renders ghost occurrence chips (distinct
  from `DueTaskChip`) on each computed occurrence day inside the visible month,
  excluding the template task's own start day. Double-Option update model ensures
  unrelated task edits never silently clear a routine.

## [0.16.0] - 2026-07-09

### Changed
- Full design-system replace: the committed macOS-glass system (blur,
  translucent glass surfaces) is retired app-wide in favor of a neumorphic
  (Soft UI) system sourced from the `ui-ux-pro-max` design skill
  (`src/designSystem/tokens.css`). A two-tier shadow model now governs every
  surface: a dual-shadow embossed/inset "chrome" tier (`--shadow-raised`,
  `--shadow-raised-sm`, `--shadow-inset`, `--shadow-inset-sm`) for titlebar,
  sidebar, buttons, pill switch, segmented control, and dropdown trigger; and
  a softer, non-embossed WCAG-AA+ "Soft UI Evolution" data-surface tier
  (`--shadow-surface`) for task cards, board columns, calendar/gantt cells,
  notes editor, dashboard stat cards, timer deck, mindmap nodes, and settings
  panels — plus a floating-layer `--shadow-overlay` tier for popovers, menus,
  pickers, and the unlock card. Clay surface tokens (`--surface-base`,
  `--surface-raised`, `--surface-sunken`) and a new radius scale
  (`--radius-sm`/`--radius-md`/`--radius-lg`) replace the old glass surfaces
  and ad hoc per-component radii; inputs and pressed states use inset wells;
  interactive chrome gains `transform: scale(var(--press-scale))` press
  feedback (≤200ms, reduced-motion respected). Dark mode is reworked with a
  new `--surface-highlight` "lightened base" step used as the dual-shadow
  light source instead of white, so dark shadows never read as a light-mode
  leak. Every app/shell surface and all six plugin frontends (todo, timer,
  notes, mindmap, dashboard, discord/telegram) are converted; the accent
  ("launch ember") reservation is unchanged — glyph-only on the `▸▸` wordmark
  plus the existing scoped `Dropdown` exception. `--surface-glass` and
  `--glass-blur` tokens are removed now that no consumer references them.

## [0.15.1] - 2026-07-09

### Changed
- Replaced native `<select>` dropdowns — invisible white-on-white on
  WebKitGTK dark mode — with a custom accessible `Dropdown`
  (`src/shared/Dropdown.tsx`, `src/designSystem/dropdown.css`): a listbox
  button popover with full keyboard support (arrow/Home/End navigation,
  Enter/Space/Escape) and roving DOM focus, styled entirely from
  `tokens.css` custom properties so both themes stay legible.

### Fixed
- Archive (`ArchivePanel.tsx`) and Timer Kind (`TimerDeck.tsx`) dropdowns are
  now legible and redesigned in both themes, migrated onto the new
  `Dropdown` component; the app-wide `999px` pill button radius no longer
  overrides the dropdown's own trigger/option radii (`dropdown.css` now wins
  by specificity for both, since the popover isn't portaled).
- Telegram/Discord settings panels: the config view now serializes camelCase
  (`chatId`/`channelId`/`hasToken`) so the panel actually shows the saved Chat
  ID / Channel ID and token state on reopen. Previously they loaded as
  `undefined` — the field looked empty after saving and a re-save could clear
  it, which made outbound sends fail (e.g. a Telegram 403 when the wrong id was
  re-entered). This was the root cause of Discord never working, too.

### Added
- Telegram bot: `/start`, `/help`, and `/chatid` now reply with the sender's own
  chat id plus the command list, so you can discover the value to paste into the
  Telegram settings (Telegram offers no easy way to find your chat id, and it's
  easy to paste the bot's id by mistake). Clearer setup help text in the panel.
- Telegram poll loop: INFO logging (`telegram_poll_loop_started`,
  `telegram_poll_state` with enabled/has_token/chat_id_set, `telegram_updates_received`,
  `telegram_command_applied`) so an idle/misconfigured loop is no longer a black box.

## [0.15.0] - 2026-07-08

### Changed
- Repository housekeeping (no app-behavior change): restored a root `.gitignore`
  (lost in the earlier flatten of `letsGo/letsgo/` → `letsGo/`) so build output
  is no longer tracked, stopped tracking `src-tauri/target/`, `dist/`,
  `src-tauri/gen/`, and `graphify-out/` (~10.7k files), moved all loose markdown
  into `docs/` (spec now at `docs/spec/`), and rewrote the README with `.deb`
  and Flatpak build commands plus a "where plugins live at build time" section.
  Added `docs/PROJECT_STRUCTURE.md`.
- Dashboard: priority (P0–P3) and status-distribution bars now use
  per-priority/per-status accent tokens instead of flat grey, and animate
  (width/height/flex-grow transition) when Refresh returns changed values.
- The top app-bar plugin tabs and the Todo top switcher now render via the
  new `SegmentedControl` (sliding highlight) instead of a plain button row.
- Notes editor toolbar consolidated to exactly three groups: Format, Export,
  Save. The standalone "Export custom" button and its bare extension input
  are gone; the custom-extension capability now lives inside the Export menu
  as an "Other extension…" entry that reveals an inline extension field and
  reuses the existing export handler.

### Added
- New Telegram user plugin (`plugins/userPlugins/telegramPlugin` +
  `src-tauri/src/telegram/`) mirroring the Discord plugin: a settings panel
  with an enable toggle, chat id, write-only bot token field, and a "Send
  test message" button, backed by `get_telegram_config`/`set_telegram_config`/
  `send_telegram_test_message` (the bot token is stored in the encrypted
  `setting` table and never returned to the UI).
- Telegram two-way command loop: a long-poll `getUpdates` loop parses
  `/add <title>`, `/list`, `/done <id>`, `/delete <id>`, and
  `/edit <id> <title>` bot commands and applies them directly against the
  todo repository, acking back into the chat; task creation and edits also
  push a task-change notification to Telegram (tagged tasks only, mirroring
  the Discord push). The parser, response formatter, and repository-apply
  layer are unit-tested against a temp DB; the live `getUpdates`/`sendMessage`
  round-trip needs a real bot token and is a manual verification gate — the
  loop compiles and is spawned at startup.
- Notes: projects, notebooks, and sections can now be given a custom emoji
  icon via a "Set icon…" tree-menu entry and a curated 40-emoji picker
  (`EmojiPicker.tsx`, no external emoji-library dependency); the chosen emoji
  renders in the tree row in place of the default kind icon, and persists via
  migration `0009_add_note_icon_and_color.sql` (`icon` column on
  `note_project`/`note_notebook`/`note_section`, plus a `bg_color` column on
  `note_section` reserved for a later slice) and the new
  `set_note_item_icon(kind, id, icon)` command.
- Flatpak packaging: `packaging/flatpak/com.rubixcoder.letsgo.yml` manifest
  (unpacks the Tauri `.deb` into the GNOME 47 runtime) and a `build-flatpak.sh`
  helper.
- New `SegmentedControl` (`src/shared/SegmentedControl.tsx`): a sliding
  `role="tablist"` control whose highlight translates (transform-only,
  180 ms, reduced-motion respected) to the active segment; a sibling of
  `PillSwitch`, not a replacement.
- Todo: Eisenhower, Gantt, and List collapsed into a secondary Board·
  Eisenhower·Gantt·List switcher shown only inside the Board tab
  (`BOARD_SUBVIEW_REGISTRY` in `boardViewRegistry.ts`), keeping the
  top-level Todo switcher to Board · Planner · Calendar.
- A short chime now plays once when a countdown timer finishes and once when
  a task moves to Done (`src/shared/notificationSound.ts`, a generated
  two-note WAV played via the webview `Audio` API — deterministic and
  unit-mockable, since `tauri-plugin-notification`'s `sound` option is
  unreliable on Linux/WebKitGTK).
- Sidebar "Plugin control" and a new "Archive" group are now independently
  collapsible, the same toggle-button/chevron pattern the "Security" group
  already used; each group's expand/collapse choice persists to
  `localStorage` separately (`src/shared/useLocalStorageCollapse.ts`).
  Archive (`src/app/ArchivePanel.tsx`) offers a created-date window selector
  (All · 7 days · 4 weeks · 6 months · 1 year, default **All** so no task
  silently vanishes) persisted via the `archiveWindow` setting; it filters
  the Board-tab family's visible tasks only (Board/Eisenhower/Gantt/List,
  via `src/shared/archiveWindow.ts`) — Planner and Calendar always show
  every task, since they're date-scheduled views, not created-date lists.
- Notes: an "Import file…" button (tree panel toolbar) reads a picked file's
  text and, once a destination notebook is chosen from the same notebook
  list "Move to notebook…" uses, creates a new section there via the
  existing `create_note_section` + `save_note_section_body` commands, then
  reloads the tree and opens the imported section.
- Notes: a per-section sticky-note background color, an "Insert link"
  action, and a live Markdown preview panel. The editor toolbar's new
  "Color" button opens a curated 5-swatch picker (`ColorSwatchPicker.tsx`)
  derived from the existing accent tokens at sticky-tint opacity
  (`--notes-sticky-amber/blue/green/rose/violet`, both themes); the pick
  persists via the new `set_note_section_color(section_id, bg_color)`
  command onto the `bg_color` column already added by migration `0009`, and
  tints the `.notesEditorSurface` background. "Insert link" wraps the
  caret's current selection as `[selection](url)` (pure helper
  `insertMarkdownLink.ts`, unit-tested). A "Preview" toggle shows a side
  `.notesPreviewPanel` that live-renders the body as sanitized HTML via the
  new `marked` + `dompurify` dependencies (`renderNoteMarkdown.ts` —
  `marked.parse` then `DOMPurify.sanitize`, unit-tested against a
  `<script>` tag, a `javascript:` link, and an `onerror` handler).

### Fixed
- Notes "Move to notebook…": investigated per the reported "shows no
  destinations" complaint — a repro test with two notebooks proved the
  existing move logic and `move_note_section` invocation already worked, so
  the real defect was a missing empty-state affordance when a section's
  project has only one notebook (the filtered destination list is correctly
  empty, but nothing told the user why). The context menu now shows "No
  other notebooks yet" instead of a blank/broken-looking menu in that case.
- Todo date-time picker: the Hour/Minute time selects and their options now
  use readable `--text-primary`/`--input-bg` tokens so they are no longer
  white-on-white (invisible) in dark theme (across all Todo sub-views).
- Mindmap nodes no longer blur after hovering away or zooming: the hover
  affordance moved off a compositor-promoting `transform` to a
  `box-shadow`/`border-color` change.
- Timer "Kind" select is now pill-shaped and uses readable token colors in
  dark theme.
- Notes "Format" no longer silently does nothing: it still normalizes the
  body (`formatMarkdown`), and now also reports how many fenced/`@code`
  regions the highlight layer recognized ("Highlighted N block(s)" or "No
  code blocks to format"), never a silent no-op. `highlightNoteMarkdown` was
  extended to recognize an inline `` `@<lang> code` `` tag and an `@<lang>`
  fenced hint (```` ```@py ````) in addition to plain ``` fences.
- 0.14.1: the installed .deb showed no plugin tabs when launched from the app
  icon. The frontend plugin code is bundled at build time, but the backend
  discovers plugin `manifest.json` files from disk at runtime and the package
  didn't ship them — so `list_plugins` returned nothing unless
  `LETSGO_PLUGINS_DIRECTORY` pointed at a checkout. The `plugins/` tree is now
  bundled into the package as a Tauri resource, and the runtime resolves the
  plugins directory from the app's resource dir (env override → bundled
  resources → `../plugins` dev fallback). The installed app now loads all
  plugins on a normal launch.

### Added
- 0.14.0 (feedback round 6): dark theme recolored for legibility — cooler
  blue-charcoal surface ladder with a clearer base→raised step and brighter
  secondary text, so labels and metadata stay readable (value-only token
  change). Desktop timer notifications: a finishing countdown now fires an OS
  notification (tauri-plugin-notification), independent of the in-app banner.
  New Todo "List" sub-view: filter by title / tags / priority / due-date range
  / creation-date range, multi-select, and bulk-edit priority, tags (union),
  deadline, and scheduled start/end, plus bulk delete. New Discord user plugin
  (`plugins/userPlugins/discordPlugin`): posts to a channel via a bot token +
  channel id (stored encrypted, never returned to the UI) whenever a tagged
  task is created or updated; settings panel with a "Send test" button.

- 0.13.0 (feedback round 5): visible priority numbering inverted so the highest
  priority reads P0 and the lowest P3 (display only — stored scale unchanged —
  and the editor lists highest first); a form-field colour scheme (dedicated
  input tokens in both themes) so text inputs and native selects stop blending
  into the panel (WebKitGTK select washout fixed); task cards restructured into
  aligned title / time-date / tag / detail sections with a status-based tint and
  left stripe carried consistently across board, planner and calendar; delete a
  task from any view via the shared editor, guarded by an inline confirm; notes
  tree redesign (kind icons, indent guide rails, tidier rhythm); unchecked
  markdown checkboxes in a note auto-import as tasks on save (idempotent);
  active-tab highlight in the plugin nav.

### Fixed
- 0.13.0: mindmap → notes deep-link opened the Notes view but not the target
  note. Root cause: the shell mounts only the active plugin, so the navigation
  event fired before NotesWorkspace mounted (and its tree was still loading).
  The bus now retains the last intent for a freshly-mounted plugin to consume,
  applied once the tree has loaded.

- 0.12.0 (feedback round 4): md drop made multi-path and never-silent (HTML5
  files → content import; WebKitGTK text/uri-list → path import; empty drops
  report their payload types); any notes section usable as a tasks file
  ("Send checkboxes to Todo" context action); scheduled start/end on tasks
  (custom picker) with multi-day calendar spanning + deadline "due" chips;
  task priorities (Low→Urgent) with badges and urgent-first columns; note
  hover/popover on cards; security panel (change passphrase, 4-6 digit PIN
  mode, optional no-lock auto-unlock with rekey); tray shows the running
  timer with a "Show in tray" selector for concurrent timers; statistics
  Dashboard plugin (status/priority/7-day completions/tracked time);
  code-highlighted notes editor (c/c++/python fences, Tab indentation,
  visible Format feedback, export to any extension); Eisenhower matrix and
  Gantt timeline as registry-driven board sub-views; pill-style controls
  with green/red theme-aware switches; contrast pass (sunken surfaces +
  strong borders); collapsible plugin-control sidebar.

### Removed
- 0.12.0: the per-card status dropdown on the Board (drag between columns
  and the editor cover status changes, per user request).
- 0.11.0 (feedback round 3): home-view radio in Plugin Control (persisted;
  app opens into the chosen plugin); custom date-time picker (calendar grid
  with in-popover Set/Clear/Cancel, hour/minute + AM/PM, 12h/24h toggle);
  Nothing-style timer UI (5x7 dot-matrix digits, 24-dot depletion ring,
  pulsing colon, dark focus screen); notes redesign (context menus on
  right-click/⋯, inline rename + delete confirm, resizable tree panel,
  word wrap + line numbers + markdown Format, export md/txt/pdf to
  ~/Downloads); mindmap redesign (kind-styled nodes, dotted background,
  click a node to open it in Notes via the new cross-plugin navigation bus).

### Fixed
- 0.11.0: Board/Planner/Calendar now share one task state — changes in any
  view appear in all views instantly (previously each view fetched its own
  copy). Task editing is reachable from every view. Interleaving parser now
  accepts generic phrasings ("X for 3 hours and Y for 20 min", "each",
  "&"/"+", hrs/mins variants) — previously only the comma+"every" demo
  phrase worked. Notes tree no longer wraps names one character per line.
- 0.10.0 (Phase 1 feature-complete): Notes plugin (Project>Notebook>Section
  CRUD + markdown editor), Timer plugin (concurrent focus/break/away/custom
  timers, pause/resume/skip, break reminders, full-screen focus mode),
  Planner + Calendar views with drag scheduling and task-in-task
  interleaving ("X for 1 hour, Y every 20 min" → interval markers), Mindmap
  plugin (graphify notes with wiki-link cross-project bridges), Linux tray
  (task Start/Pause/Done), WebdriverIO e2e harness (tauri-driver; needs
  webkit2gtk-driver installed to run), multi-size icons. Migrations
  0005–0007.
- 0.9.0: drag task cards between status columns (@dnd-kit); task timers —
  entering In-progress records a start time, leaving it records end +
  elapsed (timer table, migration 0004); cards show elapsed and an ETA
  clock computed from the average elapsed of completed tasks; deadline
  field gained a Set button that confirms and closes the calendar popup.

### Changed
- 0.9.0: md import reworked to HTML5 drops — the webview reads the dropped
  file's text and sends content to `import_tasks_from_markdown_text`
  (replaces the path-based command; Tauri's native drop interception is
  disabled — it never fired on the user's WebKitGTK).
- 0.8.0: board usability round from user feedback — plugin-control sidebar
  (checkbox per plugin, persisted to `plugin_state`, disabled plugins lose
  their tab), Add-task button + task editor (deadline picker, notes, tags)
  for create and edit, migration 0003 (deadline/note_md/tags columns).

### Fixed
- 0.8.0: dropping a .md file navigated the webview to the file instead of
  importing — `dragDropEnabled` is now explicit on the window and the
  webview's default drag/drop navigation is blocked globally.
- 0.7.0: todo plugin vertical slice — Markdown checkbox drag-in (Tauri file
  drop → parser → encrypted `task` table), five status columns with
  accessible per-card status select (optimistic, rolled back on error),
  plugin frontend entry points wired (todoPlugin lazy-mounts from its own
  directory).
- 0.6.0: encrypted-database unlock gate — create-passphrase on first run
  (confirmation + 8-char minimum + no-recovery warning), unlock on later
  runs; `get_database_status` + `unlock_database` IPC; pool held in app
  state after unlock; passphrase never stored or logged.
- 0.5.0: application shell + design system — macOS-glass titlebar, Clash
  Display wordmark with one-time ▸▸ launch nudge, dark/light theme tokens
  (`data-theme`, OS preference on first run, persisted choice), plugin tab
  bar fed by `list_plugins` IPC, `window.__latencyMarks` instrumentation.
  Fonts (Geist, Clash Display) bundled locally.
- CI pipeline (`.github/workflows/letsgo-ci.yml` at the monorepo root,
  path-filtered to this app): system deps → Vitest → typecheck → cargo test
  → `tauri build --bundles deb` → dpkg sanity check → .deb artifact upload.
  Local .deb verified: 5.8 MB (budget <15 MB), correct Depends and contents.
- 0.4.0: plugin runtime skeleton — manifest discovery/validation over
  `plugins/corePlugins` + `plugins/userPlugins` (id-matches-directory and
  duplicate-id rules), in-memory `PluginRegistry`, `list_plugins` IPC
  command, `exampleHelloPlugin` reference manifest, docs/pluginApi.md
  written for real.
- 0.3.0: encrypted database layer — SQLCipher (AES-256 at rest) opened via
  passphrase → Argon2id → raw-key `PRAGMA key`; salt sidecar next to the DB;
  first embedded migration (`setting`, `plugin_state`). Verified: DB file has
  no SQLite header, wrong key fails to open.
- 0.2.0: structured logging subsystem — JSON-lines `{ts, level, module,
  event, durationMs?, err?}` to `$XDG_DATA_HOME/letsgo/logs/`, size-based
  rotation (5 files x 5 MB, gzip), INFO+ filter, wired into app startup
  (`application_started` event verified end-to-end under Xvfb).
- Repository scaffold matching the master-prompt structure: pnpm workspace,
  React 18 + TypeScript + Vite frontend shell, Tauri 2.x Rust core, plugin
  directories (`plugins/corePlugins`, `plugins/userPlugins`), docs skeleton.
- Bundle identity `com.rubixcoder.letsgo` (ADR 0001) guarded by smoke tests on
  both sides: `src-tauri/tests/tauri_configuration_test.rs` and
  `src/shared/applicationVersionConsistency.test.ts`.
