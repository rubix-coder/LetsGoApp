import type { AlertSound } from "./sound";
import type { PanelSpan } from "./panelLayout";

export type TaskStatus = "pending" | "in_progress" | "paused" | "done" | "skipped";
export type { AlertSound };
export type Priority = 0 | 1 | 2 | 3; // P0 = highest (display order)

export interface Repeat {
  interval: number;
  /** "yearly" exists for all-day events — a birthday or anniversary is the
      one routine that only makes sense on a 12-month stride. */
  unit: "daily" | "weekly" | "monthly" | "yearly";
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: Priority;
  tags: string[];
  /** Epoch ms. Hard due date. */
  deadline?: number;
  /** Epoch ms. Placement on the schedule/calendar. */
  scheduledAt?: number;
  estimateMin?: number;
  parentId?: string;
  createdAt: number;
  completedAt?: number;
  /** Minutes already logged against this task (finished sessions). */
  loggedMin: number;
  /** Epoch ms this task most recently entered `in_progress`. Cleared when it
      leaves that state. Drives the status check-in nudge (screens/StatusNudge). */
  startedAt?: number;
  /** Markdown file / note this task was imported from — re-imports update and
      delete by (source, title), mirroring the desktop's md sync. */
  source?: string;
  /** Routine: repeats from its scheduledAt anchor. */
  repeat?: Repeat;
  /** All-day event (birthday, anniversary, holiday, bill): the task marks a
      whole DAY instead of occupying a time slot, so every dated view hangs it
      off the date as a notch rather than drawing it as a scheduled block.
      Its day comes from the usual anchor — `scheduledAt`, else `deadline`.

      Deliberately non-destructive: turning a task into an event does NOT
      clear `scheduledAt`, it only makes the views ignore the clock part. That
      keeps the switch lossless in both directions. */
  allDay?: boolean;
  /** The event's identity in the collapsed notch, which shows only this glyph
      until hovered — required whenever `allDay` is set (see EVENT_KINDS). */
  emoji?: string;
  /** Which EVENT_KINDS bucket an event belongs to ("birthday", "bill", …) —
      the section it lands in on the Events screen. Optional and written only
      when a kind is picked: events predating this field are sorted by their
      emoji instead (lib/eventList.eventKindOf), which is what identified a
      kind before there was anywhere to record it. */
  eventKind?: string;
  /** Routine only: per-day status overrides keyed by local "YYYY-MM-DD"
      (lib/occurrence.ts). Each occurrence starts pending; marking a day
      writes here — `status` stays the untouched template. */
  occurrenceStatus?: Record<string, TaskStatus>;
  /** Scheduling lock: scheduledAt/deadline/estimate are frozen — drags,
      reschedules and auto-packs bounce off; status/priority/tags stay live. */
  locked?: boolean;
  /** Gantt order-of-operations links: ids of tasks this one starts after.
      Planning metadata only — the estimate packer does not enforce them. */
  dependsOn?: string[];
  /** Quick jotting, editable inline in the list view. Deliberately separate
      from `description`: that is the task's write-up in the editor, this is a
      running scratch line ("waiting on Priya", "blocked by the API key"). */
  comment?: string;
  /** Google Calendar link, written by the sync — never by hand. */
  googleEvent?: GoogleEventLink;
  /** How long before this task's event Google should pop its reminder,
      overriding the account-wide default. Absent = use that default. */
  reminderMinutes?: ReminderChoice;
  /** Habits this task feeds (lib/habitLink.ts). Many-to-many by design: one
      "Get ready" task feeds brush teeth, shampoo and clean the floor, while a
      single habit can equally be fed by several tasks. Completing the task
      fills every habit's day, and the task closes once ALL of them are kept —
      a checklist is not finished by its first item. Absent, not `[]`, when the
      task feeds nothing, so an untouched task stays byte-identical.

      Migrated from the older single `habitId` by `hydrateState`. */
  habitIds?: string[];
  /** Short stable alias for the markdown format's `@id(...)` token, minted on
      first send or export. Separate from `id` so a note stays readable, and the
      reason renaming a task line no longer destroys and recreates the task. */
  mdKey?: string;
}

/** Popup reminder lead time for a task's Google Calendar event.

    Three states, not two, because "say nothing" and "say nothing on purpose"
    are different instructions to Google: a NUMBER is minutes before the start
    (0 = when it starts), `"default"` leaves the calendar's own default alone
    (30 minutes, unless the user changed it in Google), and `"none"` silences
    the event entirely. */
export type ReminderChoice = number | "default" | "none";

/** The lead times offered in the picker, in minutes. Anything else can still
    be typed in — these are the one-tap answers. */
export const REMINDER_PRESETS: readonly number[] = [0, 5, 10, 15, 30, 60, 120, 1440];

/** Which Google Calendar event a task mirrors, and how fresh each side was at
    the last sync. The event also carries the task id in its private extended
    properties, so the pairing survives a vault restore from either direction. */
export interface GoogleEventLink {
  accountId: string;
  calendarId: string;
  eventId: string;
  /** Google's RFC-3339 `updated` stamp as of the last sync — a newer one on the
      remote means the event was edited in Google and should pull back. */
  updated?: string;
  /** Epoch ms when this task was last pushed out. */
  pushedAt?: number;
}

/** One signed-in Google account and the calendar it syncs with. Tokens are
    deliberately NOT here: they expire in an hour and live in session storage,
    so the synced vault never carries a credential. */
export interface GoogleAccount {
  /** Google's stable subject (`sub`) claim, falling back to the address. */
  id: string;
  email: string;
  /** The calendar tasks sync with — "primary" unless another is picked. */
  calendarId: string;
  calendarName?: string;
  /** Pause an account's sync without signing it out. */
  enabled: boolean;
  lastSyncAt?: number;
}

export interface GoogleSettings {
  /** OAuth 2.0 Web client id from Google Cloud. Empty = integration off. */
  clientId: string;
  accounts: GoogleAccount[];
  /** Sync on unlock and on a timer, rather than only when asked. */
  autoSync: boolean;
  /** Default popup reminder for every event this app pushes. A task's own
      `reminderMinutes` overrides it. Absent = Google's calendar default. */
  reminderMinutes?: ReminderChoice;
}

/** Reserved slot on the schedule that is not a task ("Lunch — blocked"). */
export interface TimeBlock {
  id: string;
  title: string;
  start: number;
  durationMin: number;
  repeat?: Repeat;
  source?: string;
}

export interface NoteFolder {
  id: string;
  name: string;
}

export interface Note {
  id: string;
  folderId: string;
  title: string;
  body: string;
  updatedAt: number;
  /** Nested pages: the parent note this page lives under. Undefined = a
      top-level page in its folder. Deleting a page deletes its subtree. */
  parentId?: string;
  /** Free-form labels. The reserved "GOAL" tag (see lib/goals.ts) promotes a
      page to a tracked goal with a progress bar on the dashboard. */
  tags?: string[];
}

/** "wishlist" is the one status that does NOT mean you own the book — it is
    the list you consult standing in a shop. Everything else describes a book
    already on a shelf, which is why `readingStats` counts the four owned
    states and excludes this one. */
export type BookStatus = "wishlist" | "unread" | "reading" | "read" | "dnf";

/** A physical book on a shelf. Catalogued by scanning its ISBN barcode, by
    importing a Goodreads/StoryGraph/LibraryThing export, or by hand.

    Cover images are deliberately NOT stored: Open Library derives them from
    the ISBN (see lib/books.ts `coverUrlFor`), so keeping a URL per book would
    be pure redundancy — and the whole vault lives in localStorage, so bytes
    matter here the same way they do for DrawPad strokes. */
export interface Book {
  id: string;
  title: string;
  /** Required array like `Task.tags`, so no call site needs `?? []`. An empty
      array means the author is unknown, not that the field is missing. */
  authors: string[];
  /** The dedupe key whenever it is known — imports and re-scans match on it. */
  isbn13?: string;
  /** Older exports carry ISBN-10, and it is what a user may type in. */
  isbn10?: string;
  publisher?: string;
  publishedYear?: number;
  pageCount?: number;
  /** The page you are on — what a physical bookmark would be marking.
      `undefined` means no bookmark is placed, which is not the same as page 0.
      Independent of `pageCount`, which is often unknown for the small-press
      books this has to cope with. */
  currentPage?: number;
  /** Set ONLY when the cover cannot be derived from the ISBN (a Google Books
      thumbnail, or a hand-set URL). Never a `data:` URI. */
  coverUrl?: string;
  status: BookStatus;
  /** 1-5 whole stars. `undefined` is "unrated" and is NOT the same as 0 —
      Goodreads exports 0 for unrated, and conflating them would sort every
      unrated book below the ones you actively disliked. */
  rating?: number;
  startedAt?: number;
  finishedAt?: number;
  /** Where it physically is — "Living room, shelf 2". */
  shelf?: string;
  tags: string[];
  notes?: string;
  /** Epoch ms. The default sort key, mirroring `Task.createdAt`. */
  addedAt: number;
  /** How it got here: "scan", "csv:<filename>", "manual". Mirrors
      `Task.source`, and lets a bad import be found again later. */
  source?: string;
  /** Where the record came from on the web — the Amazon/Flipkart/publisher
      page a wishlist entry was created from. Kept so the book can be reopened
      where it was found, and so a duplicate paste is recognisable. */
  sourceUrl?: string;
  /** When a wishlist book was actually bought. Distinct from `addedAt`, which
      records when you first wanted it — the gap between the two is the whole
      point of keeping a wishlist. */
  acquiredAt?: number;
  /** Which provider filled the metadata, so a re-fetch can skip records a
      human has already curated. */
  lookup?: { provider: "openlibrary" | "google" | "vision" | "web"; at: number };
}

export interface MindNode {
  id: string;
  label: string;
  x: number;
  y: number;
  parentId?: string;
  /** Nodes promoted to tasks carry that task's status color. */
  status?: TaskStatus;
}

export interface Session {
  id: string;
  taskId?: string;
  label: string;
  /** Epoch ms, day the session ran. */
  startedAt: number;
  minutes: number;
  /** "focus" is worked time (banked from a running timer); "pause" is a logged
      break — a manual pause or an auto-pause after stepping away. Absent means
      "focus", so sessions written before this field read unchanged, and only
      focus minutes count towards the dashboard's tracked time. */
  kind?: "focus" | "pause";
}

export type TimerMode = "pomodoro" | "countdown" | "stopwatch";

export interface TimerState {
  mode: TimerMode;
  taskId?: string;
  /** Epoch ms when the current run (re)started; undefined = not running. */
  runningSince?: number;
  /** Seconds accumulated before runningSince (pause support). */
  baseSec: number;
  /** Target seconds for pomodoro/countdown. In countdown mode with a task
      focused this is the task's remaining estimate; otherwise a fixed default. */
  targetSec: number;
  pomodorosDone: number;
  /** Epoch ms the current pause began — a manual pause or an auto-pause after
      stepping away. Undefined when running or freshly reset. On resume the span
      since this instant is banked as a `kind: "pause"` session. */
  pausedSince?: number;
}

/** Ad-hoc countdown ("7 min") — any number can run beside the focus timer. */
export interface QuickTimer {
  id: string;
  label: string;
  totalSec: number;
  /** Epoch ms when it rings; undefined = paused. */
  endsAt?: number;
  /** Seconds left at the moment it was paused. */
  remainSec?: number;
}

/** "eink" is the e-paper theme — high-contrast gray ink on paper white, no
    color, no shadows, no motion, exactly as an e-reader renders. Like
    "thermal" it has no OS analogue, so "system" never resolves to it.

    "thermal" is the receipt-printer theme — one ink on paper, monospaced,
    square, motionless. It has no OS analogue, so "system" never resolves to
    it; it is only ever an explicit choice. */
export type ThemeChoice = "light" | "dark" | "system" | "thermal" | "eink";
/** Accent palette (Settings → Appearance). Each id maps to a `[data-accent]`
    token block in theme.css; "violet" is the base `:root` family. */
export type AccentChoice = "violet" | "blue" | "teal" | "ember" | "rose";
/** Timer readout style (Settings → Appearance). "matrix" is the app default. */
export type ClockFace = "matrix" | "segment" | "flip" | "minimal" | "analog";
/** Starting layout for a newly created note (Settings → Plugins → Notes).
    "blank" is the classic empty page; "daily" seeds the "Today" planner. */
export type NoteTemplate = "blank" | "daily" | "habits" | "journal" | "scrapbook" | "draw" | "custom";

/** A layout the user wrote themselves (Settings → Plugins → Notes). Stored as
    the literal starting title and body, so it round-trips through export and
    sync like any other note content. */
export interface CustomNoteTemplate {
  title: string;
  body: string;
}
export type PluginId = "todo" | "timer" | "notes" | "mindmap" | "dashboard" | "library" | "habits";

/** A recurring practice tracked per local day — "wake at 6", "drink water ×8".
    Deliberately independent of tasks: no scheduling, no status machine, just a
    per-day tick count against a target, from which streaks and consistency
    derive (lib/habits.ts). */
export interface Habit {
  id: string;
  name: string;
  /** Identity glyph, shown wherever the full name is too long. */
  emoji?: string;
  /** Weekdays the habit is due (0 Sun … 6 Sat). Absent or empty = every day. */
  days?: number[];
  /** Ticks needed for a day to count as done ("drink water" ×8). Default 1. */
  timesPerDay?: number;
  createdAt: number;
  /** Archived habits keep their history but leave the daily list. */
  archivedAt?: number;
  /** Markdown file this habit was imported from — re-imports reconcile by name. */
  source?: string;
  /** Local "YYYY-MM-DD" → ticks recorded that day. */
  log: Record<string, number>;
}

/** Daily window the auto-scheduler confines tasks to. A packed task that would
    cross `endMin` rolls whole to the next day's `startMin`. Minutes from local
    midnight (e.g. 6:00–21:00 = 360–1260). */
export interface WorkHours {
  enabled: boolean;
  startMin: number;
  endMin: number;
}

export interface Settings {
  theme: ThemeChoice;
  accent: AccentChoice;
  /** Timer readout face; defaults to "matrix" for vaults saved before it existed. */
  clockFace?: ClockFace;
  /** Starting layout for new notes; defaults to "blank" for vaults saved before
      it existed. "daily" seeds the "Today" planner scaffold. */
  noteTemplate?: NoteTemplate;
  /** Ask which layout to use on EVERY new page, instead of silently applying
      the default above. Off by default — the default is the fast path. */
  askNoteTemplate?: boolean;
  /** The user's own layout, offered alongside the built-in ones and settable
      as the default. Absent until they write one. */
  customNoteTemplate?: CustomNoteTemplate;
  density: "compact" | "cozy" | "roomy";
  statusColors: boolean;
  reduceMotion: boolean;
  /** OS banner when a pomodoro/countdown finishes (needs browser permission). */
  notifications: boolean;
  /** Short chime on timer finish, task completion and unlock. No browser
      permission needed — synthesized in-page, gated independently of the
      OS banner above. */
  sounds: boolean;
  /** Which sound a timer / check-in notification plays (lib/sound). Absent =
      "chime", the original three-tone alert. */
  alertSound?: AlertSound;
  /** First day of the calendar week: 0 Sunday, 1 Monday, 6 Saturday. */
  weekStart: 0 | 1 | 6;
  /** Clock style for every time display; "24" is the app default. Native
      datetime-local pickers follow the DEVICE locale — not controllable. */
  hourFormat: "24" | "12";
  /** Auto-scheduling only places tasks inside this window; overflow rolls to
      the next day's opening time. */
  workHours: WorkHours;
  /** Breathing room the auto-packer leaves between any two consecutive tasks,
      dependent or not. Defaults to 5 for vaults saved before it existed; 0
      restores the old edge-to-edge packing. */
  breakMin?: number;
  /** NAS hub sync (WebDAV). Credentials live inside the encrypted vault. */
  sync: { enabled: boolean; url: string; username: string; password: string };
  plugins: Record<PluginId, boolean>;
  /** Sidebar / tab-bar order, most-wanted first. Optional and self-repairing:
      absent means the built-in order, and anything missing from it is
      appended (lib/plugins.ts) so a new plugin never goes invisible. */
  pluginOrder?: PluginId[];
  /** Per-surface panel arrangements, keyed by surface ("dashboard",
      "events"): the order panels are laid out in and how many grid columns
      and rows each covers. Optional and self-repairing the same way
      pluginOrder is — absent means the surface's own default, unknown panels
      are dropped and new ones appended (lib/panelLayout.resolveLayout), so a
      saved layout can never hide a panel that did not exist when it was
      saved. */
  panelLayouts?: Record<string, PanelSpan[]>;
  sidebarCollapsed: boolean;
  /** Route the app opens on from a bare URL (empty hash). A plugin id
      ("notes") or a fuller path for Todo's sub-views ("todo/schedule",
      "todo/board/gantt"). Falls back to the first enabled plugin if the
      target plugin is disabled. */
  landingView: string;
  /** Which Todo view a plain "/todo" navigation opens — the sidebar tab, the
      mobile tab bar, and the landing route all go there. A landing route from
      TODO_VIEWS ("todo/schedule", "todo/board/gantt") pins one view; "last"
      (the default) restores whichever view was last used on this device.
      See lib/todoView.ts. */
  todoDefaultView: string;
  /** Pop a reminder when a scheduled task's start time arrives (offer to start
      it) and when its scheduled end passes (offer to extend or finish). */
  scheduleReminders: boolean;
  /** Auto-pause the focus timer after this many minutes with no interaction
      (and the tab hidden), banking the idle span as a break instead of worked
      time. Absent = 10; `0` disables. (shell/AppShell useAwayGuard.) */
  autoPauseMin?: number;
  /** Recurring "still on this?" nudge while any task is in progress, so its
      status stays honest. Absent = { enabled: true, everyMin: 25 }. */
  statusNudge?: { enabled: boolean; everyMin: number };
  /** Ask, on the first open of each day, what time the day really starts, and
      re-pack the day's unlocked tasks from there. Defaults to on. */
  dayStartPrompt?: boolean;
  /** Local "YYYY-MM-DD" of the last day the start prompt was answered or
      skipped — the gate that keeps it to once a day. */
  lastDayStartDay?: string;
  /** Google Calendar accounts and their sync settings (lib/gcal.ts). */
  google?: GoogleSettings;
  /** How much of the plan the date-axis-less board views show (lib/taskWindow.ts).
      Absent = everything, which is how the app behaved before it existed. */
  taskWindow?: { pastDays: number | null; futureDays: number | null };
  /** Default card order for the Kanban board. Absent = "manual" (array order),
      which is how the board behaved before it existed. Each device's own
      in-board sort control overrides this locally. */
  boardSort?: BoardSort;
}

export type BoardSort = "manual" | "priority" | "deadline" | "start";

/** A one-off explanation of something the app did on the user's behalf (so far:
    auto-rescheduling a late task). Transient by contract — `persistableState`
    strips it before the vault is encrypted or a team doc is pushed, so a stale
    banner can never come back on reload or land on someone else's screen. */
export interface Notice {
  id: string;
  kind: "info" | "warn";
  text: string;
}

export interface AppState {
  tasks: Task[];
  blocks: TimeBlock[];
  folders: NoteFolder[];
  notes: Note[];
  mind: MindNode[];
  mindTitle: string;
  sessions: Session[];
  books: Book[];
  habits: Habit[];
  timer: TimerState;
  quickTimers: QuickTimer[];
  settings: Settings;
  /** Transient — see `Notice`. Never persisted. */
  notice?: Notice;
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "Pending",
  in_progress: "In progress",
  paused: "Paused",
  done: "Done",
  skipped: "Skipped",
};

export const STATUS_VAR: Record<TaskStatus, string> = {
  pending: "var(--st-pending)",
  in_progress: "var(--st-progress)",
  paused: "var(--st-paused)",
  done: "var(--st-done)",
  skipped: "var(--st-skipped)",
};

export const BOOK_STATUS_LABEL: Record<BookStatus, string> = {
  wishlist: "Wishlist",
  unread: "Unread",
  reading: "Reading",
  read: "Read",
  dnf: "Did not finish",
};

/** Book status → the task status whose colour token it borrows, so `StatusSq`
    is reusable verbatim. The mapping is not arbitrary: "skipped" already
    renders as a hatched square, which reads exactly right for did-not-finish. */
export const BOOK_STATUS_AS_TASK: Record<BookStatus, TaskStatus> = {
  // Deliberately NOT "pending" like unread: a wanted book and an owned-but-
  // unread one must be tellable apart at a glance in a mixed list, and
  // "paused" is the one remaining token that is neither started nor done.
  wishlist: "paused",
  unread: "pending",
  reading: "in_progress",
  read: "done",
  dnf: "skipped",
};

export const PLUGIN_META: { id: PluginId; name: string; desc: string; core?: boolean }[] = [
  { id: "todo", name: "Todo", desc: "Board, schedule & calendar", core: true },
  { id: "timer", name: "Timer", desc: "Pomodoro, countdown & focus mode" },
  { id: "notes", name: "Notes", desc: "Nested markdown notebooks" },
  { id: "mindmap", name: "Mindmap", desc: "Pan / zoom board of linked nodes" },
  { id: "dashboard", name: "Dashboard", desc: "The day at a glance" },
  { id: "library", name: "Library", desc: "Scan, shelve & track your books" },
  { id: "habits", name: "Habits", desc: "Daily habits, streaks & consistency" },
];
