import { createContext, useContext, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import type { AppState, Book, Habit, Note, Notice, PluginId, Settings, Task, TaskStatus, TimeBlock, TimerMode, MindNode } from "./types";
import { tickHabit } from "./habits";
import { applyHabitDayToTasks, applyTaskStatusToHabits, taskHabitDayKey } from "./habitLink";
import { mergeImportedHabits } from "./habitsMd";
import { decryptJson, deriveKey, encryptJson, payloadSalt, randomBytes, type VaultPayload } from "./crypto";
import { seedState } from "./seed";
import { hydrateState } from "./migrate";
import { mergeImportedBooks } from "./bookCsv";
import { dedupeBooks, indexOfDuplicate, mergeDuplicate } from "./books";
import { movePlugin } from "./plugins";
import { parseMarkdownTasks, parseTimeBlock, parsedBlockToTimeBlock, reconcileNoteBody, type ParsedMdTask } from "./mdTasks";
import { newMdKey } from "./taskMeta";
import { canDepend } from "./gantt";
import { occurrenceDateKey } from "./occurrence";
import { fmtTime, setHourFormat, startOfDay } from "./dates";
import { sessionKind } from "./sessionLog";
import { parseIcal } from "./ical";
import { applyEstimatePack, packSubtree, planDayStartOutcome, planLateStart, reflowFrom, rootAncestorId, type WorkWindow } from "./estimate";
import type { TaskPatch } from "./gcal";
import { childIndex, subtreeIds, treeUnscheduled } from "./taskTree";
import { decideSync, deviceName, newStamp, payloadStamp, pullRemote, pushRemote, type SyncedPayload } from "./sync";
import { api, ConflictError, type ApiDoc, type ApiProject, type ApiUser, type ProjectRole } from "./api";

const VAULT_KEY = "letsgo.vault";
/** Stamp (not rev — see sync.ts) both sides agreed on at the last sync. */
const SYNCED_STAMP_KEY = "letsgo.syncedStamp";
/** Superseded by SYNCED_STAMP_KEY; still cleared so old vaults leave nothing behind. */
const LEGACY_SYNCED_REV_KEY = "letsgo.syncedRev";
const CONFLICT_KEY = "letsgo.conflict";
const UNLOCK_MODE_KEY = "letsgo.unlockMode";

/** Passwordless vaults use this fixed passphrase — the data is still AES-GCM
    encrypted at rest, but the key is derived from a known constant so the app
    opens without prompting. Convenience over security, by the user's choice. */
export const NO_PASSPHRASE = "";

/** "none" = open without a passphrase (auto-unlock); "passphrase" = prompt. The
    mode lives OUTSIDE the encrypted vault (we must know it before unlocking). */
export function unlockMode(): "none" | "passphrase" {
  return localStorage.getItem(UNLOCK_MODE_KEY) === "none" ? "none" : "passphrase";
}
function setUnlockMode(passphrase: string): void {
  localStorage.setItem(UNLOCK_MODE_KEY, passphrase === NO_PASSPHRASE ? "none" : "passphrase");
}

/* ————— vault lifecycle ————— */

export interface VaultHandle {
  key: CryptoKey;
  salt: Uint8Array;
  state: AppState;
  /** Held in memory while unlocked — lets sync adopt blobs whose salt was
      minted on another device. Dropped on lock. */
  passphrase: string;
}

export function hasVault(): boolean {
  return localStorage.getItem(VAULT_KEY) !== null;
}

function localPayload(): SyncedPayload | null {
  const raw = localStorage.getItem(VAULT_KEY);
  if (!raw) return null;
  // Pre-sync vaults lack the lineage fields; default them to rev 0.
  const p = JSON.parse(raw) as VaultPayload & Partial<SyncedPayload>;
  return { rev: 0, savedAt: 0, device: deviceName(), ...p };
}

function writeLocalPayload(p: SyncedPayload): void {
  localStorage.setItem(VAULT_KEY, JSON.stringify(p));
}

/** Envelope for a fresh local save: a brand-new stamp (this save's identity),
    the next rev for human reading, and the wall clock conflicts are broken on. */
function stampEnvelope(prevRev: number): Pick<SyncedPayload, "rev" | "savedAt" | "device" | "stamp"> {
  const device = deviceName();
  return { rev: prevRev + 1, savedAt: Date.now(), device, stamp: newStamp(device) };
}

export async function createVault(passphrase: string): Promise<VaultHandle> {
  const salt = randomBytes(16);
  const key = await deriveKey(passphrase, salt);
  const state = seedState();
  writeLocalPayload({ ...(await encryptJson(key, salt, state)), ...stampEnvelope(0) });
  setUnlockMode(passphrase);
  return { key, salt, state, passphrase };
}

/** Throws on a wrong passphrase. */
export async function openVault(passphrase: string): Promise<VaultHandle> {
  const payload = localPayload()!;
  const salt = payloadSalt(payload);
  const key = await deriveKey(passphrase, salt);
  const raw = await decryptJson<AppState>(key, payload);
  // Fields and plugins gain members over time; older vaults fill the gaps
  // from the seed (lib/migrate.ts).
  return { key, salt, state: hydrateState(raw), passphrase };
}

/** New device: adopt the NAS copy wholesale. Throws on network/auth/passphrase. */
export async function restoreVaultFromNas(cfg: AppState["settings"]["sync"], passphrase: string): Promise<VaultHandle> {
  const remote = await pullRemote(cfg);
  if (!remote) throw new Error("No vault on the NAS yet — create one on a device and enable sync there first.");
  const salt = payloadSalt(remote);
  const key = await deriveKey(passphrase, salt);
  const raw = await decryptJson<AppState>(key, remote);
  const hydrated = hydrateState(raw);
  // Adopting the NAS copy means adopting its sync config, enabled.
  const state: AppState = {
    ...hydrated,
    settings: { ...hydrated.settings, sync: { ...cfg, enabled: true } },
  };
  writeLocalPayload(remote);
  // Adopted wholesale: our copy IS the remote save, so that stamp is the
  // agreed lineage point — the next local edit is what makes us diverge.
  localStorage.setItem(SYNCED_STAMP_KEY, payloadStamp(remote));
  return { key, salt, state, passphrase };
}

export async function rekeyVault(state: AppState, passphrase: string): Promise<VaultHandle> {
  const salt = randomBytes(16);
  const key = await deriveKey(passphrase, salt);
  const prev = localPayload();
  writeLocalPayload({ ...(await encryptJson(key, salt, state)), ...stampEnvelope(prev?.rev ?? 0) });
  setUnlockMode(passphrase);
  return { key, salt, state, passphrase };
}

export function destroyVault(): void {
  localStorage.removeItem(VAULT_KEY);
  localStorage.removeItem(UNLOCK_MODE_KEY);
  localStorage.removeItem(SYNCED_STAMP_KEY);
  localStorage.removeItem(LEGACY_SYNCED_REV_KEY);
  localStorage.removeItem(CONFLICT_KEY);
}

/* ————— actions + reducer ————— */

export type Action =
  | { type: "upsertTask"; task: Task; repack?: boolean }
  | { type: "reorderTask"; id: string; targetId: string; place: "before" | "after" }
  | { type: "deleteTask"; id: string }
  | { type: "setStatus"; id: string; status: TaskStatus; occurrenceDay?: number }
  | { type: "scheduleTask"; id: string; at: number | undefined }
  | { type: "importMarkdown"; text: string; sourceName?: string; linkBack?: boolean; noteId?: string }
  | { type: "importIcal"; text: string; sourceName?: string }
  | { type: "addBlock"; block: TimeBlock }
  | { type: "deleteBlock"; id: string }
  | { type: "upsertNote"; note: Note }
  | { type: "deleteNote"; id: string }
  | { type: "addFolder"; name: string }
  | { type: "renameFolder"; id: string; name: string }
  | { type: "deleteFolder"; id: string }
  | { type: "moveNoteToFolder"; id: string; folderId: string }
  | { type: "reorderFolder"; id: string; targetId: string }
  | { type: "reorderNote"; id: string; targetId: string }
  | { type: "addMindNode"; node: MindNode }
  | { type: "moveMindNode"; id: string; x: number; y: number }
  | { type: "renameMindNode"; id: string; label: string }
  | { type: "upsertBook"; book: Book }
  | { type: "deleteBook"; id: string }
  | { type: "deleteBooks"; ids: string[] }
  | { type: "updateBooks"; ids: string[]; patch: Partial<Book> }
  | { type: "importBooks"; books: Book[] }
  | { type: "dedupeBooks" }
  | { type: "upsertHabit"; habit: Habit }
  | { type: "deleteHabit"; id: string }
  | { type: "tickHabit"; id: string; day: string; delta: number }
  | { type: "importHabits"; habits: Habit[]; source?: string }
  | { type: "reorderPlugin"; id: PluginId; targetId: PluginId }
  | { type: "timerStart"; taskId?: string }
  | { type: "timerPause" }
  | { type: "timerAutoPause"; since: number }
  | { type: "timerReset" }
  | { type: "timerComplete" }
  | { type: "timerMode"; mode: TimerMode }
  | { type: "sessionDelete"; id: string }
  | { type: "quickTimerAdd"; minutes: number; label?: string }
  | { type: "quickTimerToggle"; id: string }
  | { type: "quickTimerRemove"; id: string }
  | { type: "setSettings"; patch: Partial<Settings> }
  | { type: "togglePlugin"; id: keyof Settings["plugins"] }
  | { type: "dayStart"; from: number }
  | { type: "skipDayStart"; day: number }
  | { type: "googleSyncApplied"; accountId: string; imports: Task[]; patches: TaskPatch[]; deletes: string[]; at: number }
  | { type: "dismissNotice" }
  | { type: "importState"; state: AppState };

export function elapsedSec(t: AppState["timer"], now = Date.now()): number {
  return t.baseSec + (t.runningSince ? (now - t.runningSince) / 1000 : 0);
}

/** Minutes worked on one task: everything banked into `loggedMin` plus what
    the timer is still holding for it.

    The held part counts whether the clock is RUNNING or PAUSED. A pause — hit
    by hand or by the away-guard — freezes the count, it does not throw it
    away, so a screen that only added the held time while `runningSince` was
    set showed the elapsed figure collapsing to the banked total (usually zero)
    the moment you stepped away, then jumping back on resume. Elapsed is the
    sum of every micro-session across the task's life; nothing about a pause
    subtracts from it. */
export function taskElapsedMin(state: AppState, task: Task, now = Date.now()): number {
  return task.loggedMin + (state.timer.taskId === task.id ? elapsedSec(state.timer, now) / 60 : 0);
}

export { sessionKind };

/** Fixed pomodoro length; also the countdown fallback when no task is focused. */
const DEFAULT_COUNTDOWN_SEC = 60 * 60;

/** Target seconds for the timer dial. Pomodoro is always 25 min and stopwatch
    counts up (0); a countdown with a task focused aims at that task's remaining
    estimate (never below 5 min), else the hour default. */
export function timerTargetSec(mode: TimerMode, task: Task | undefined): number {
  if (mode === "pomodoro") return 25 * 60;
  if (mode === "stopwatch") return 0;
  if (task?.estimateMin) return Math.round(Math.max(5, task.estimateMin - task.loggedMin) * 60);
  return DEFAULT_COUNTDOWN_SEC;
}

/** Bank the pending pause (if the gap is worth recording) and clear the marker.
    Called from every path that resumes, banks, or completes a timer run. */
function bankPause(state: AppState, now: number): AppState {
  const since = state.timer.pausedSince;
  if (since === undefined) return state;
  const timer = { ...state.timer, pausedSince: undefined };
  const minutes = Math.round((now - since) / 60_000);
  if (minutes < 1) return { ...state, timer };
  const task = state.tasks.find((t) => t.id === state.timer.taskId);
  return {
    ...state,
    timer,
    sessions: [
      ...state.sessions,
      { id: `s-${since}-p`, taskId: task?.id, label: task?.title ?? "Untimed focus", startedAt: since, minutes, kind: "pause" },
    ],
  };
}

/** The active auto-scheduling window, or undefined when work hours are off or
    the range is degenerate (so scheduling packs edge-to-edge as before). */
function activeWindow(state: AppState): WorkWindow | undefined {
  const w = state.settings.workHours;
  return w.enabled && w.endMin > w.startMin ? { startMin: w.startMin, endMin: w.endMin } : undefined;
}

/** Gap the packer leaves between consecutive tasks. Vaults written before the
    setting existed adopt the 5-minute default rather than packing edge-to-edge. */
export const DEFAULT_BREAK_MINUTES = 5;
function breakMinutes(state: AppState): number {
  const m = state.settings.breakMin;
  return typeof m === "number" && m >= 0 ? m : DEFAULT_BREAK_MINUTES;
}

/** Strip transient-only fields before the state is encrypted, stored or pushed
    to a team doc. Keeps `Notice` from resurfacing on reload or leaking to a
    teammate's screen. */
export function persistableState(state: AppState): AppState {
  if (state.notice === undefined) return state;
  const copy = { ...state };
  delete copy.notice;
  return copy;
}

/** Fold the current timer run into a logged session and clear the clock. Any
    pending pause is banked first so a "complete" while paused still records the
    break. */
function logTimer(stateIn: AppState, now: number): AppState {
  const state = bankPause(stateIn, now);
  const sec = elapsedSec(state.timer, now);
  const minutes = Math.round(sec / 60);
  const task = state.tasks.find((t) => t.id === state.timer.taskId);
  const timer = { ...state.timer, runningSince: undefined, baseSec: 0, pausedSince: undefined };
  if (minutes < 1) return { ...state, timer };
  return {
    ...state,
    timer: { ...timer, pomodorosDone: timer.mode === "pomodoro" ? timer.pomodorosDone + 1 : timer.pomodorosDone },
    sessions: [
      ...state.sessions,
      { id: `s-${now}`, taskId: task?.id, label: task?.title ?? "Untimed focus", startedAt: now - sec * 1000, minutes, kind: "focus" },
    ],
    tasks: task ? state.tasks.map((t) => (t.id === task.id ? { ...t, loggedMin: t.loggedMin + minutes } : t)) : state.tasks,
  };
}

/** Desktop 0.29 semantics: a parent's status is DERIVED from its subtasks
    (task_repository.rs::resync_derived_fields) — done only when every child is
    literally done (a skipped child blocks auto-completion); in_progress ONLY if
    at least one child is in_progress; otherwise pending, so a freshly imported
    subtree nobody has started stays pending instead of jumping to in_progress. */
export function deriveParentStatus(tasks: Task[]): Task[] {
  const idx = childIndex(tasks);
  return tasks.map((t) => {
    const children = idx.get(t.id);
    if (!children) return t;
    const allDone = children.every((c) => c.status === "done");
    const anyInProgress = children.some((c) => c.status === "in_progress");
    const anyPaused = children.some((c) => c.status === "paused");
    const status: TaskStatus = allDone
      ? "done"
      : anyInProgress
        ? "in_progress"
        : anyPaused
          ? "paused"
          : "pending";
    if (status === t.status) return t;
    return {
      ...t,
      status,
      completedAt: status === "done" ? Math.max(...children.map((c) => c.completedAt ?? 0)) || Date.now() : undefined,
    };
  });
}

/** Locked tasks are scheduling anchors: whatever an edit, pack or reflow did
    to them, their date-times snap back to the pre-action values. */
function restoreLockedTimes(prev: readonly Task[], next: Task[]): Task[] {
  return next.map((t) => {
    if (!t.locked) return t;
    const was = prev.find((p) => p.id === t.id);
    if (!was || (t.scheduledAt === was.scheduledAt && t.deadline === was.deadline && t.estimateMin === was.estimateMin)) return t;
    return { ...t, scheduledAt: was.scheduledAt, deadline: was.deadline, estimateMin: was.estimateMin };
  });
}

/** Markdown import with the desktop's sync semantics: bullets upsert keyed on
    (source, title); `[block]` bullets become time blocks keyed on (source,
    label); with a named source, entries whose lines left the file are
    DELETED. Source-less imports never delete. */
export function importMarkdown(state: AppState, text: string, sourceName?: string, linkBack = false, noteId?: string): AppState {
  const parsed = parseMarkdownTasks(text);
  let tasks = [...state.tasks];
  let blocks = [...state.blocks];
  const seenTaskTitles = new Set<string>();
  const seenKeys = new Set<string>();
  const seenBlockLabels = new Set<string>();
  const indexToId = new Map<number, string>();
  const now = Date.now();
  const takenKeys = new Set(state.tasks.map((t) => t.mdKey).filter(Boolean) as string[]);
  /** Titles seen in THIS file → task id, for resolving `@after(...)` refs. */
  const titleToId = new Map<string, string>();

  parsed.forEach((entry, i) => {
    const asBlock = parseTimeBlock(entry.title);
    if (asBlock) {
      seenBlockLabels.add(asBlock.label);
      const fresh = parsedBlockToTimeBlock(asBlock, sourceName);
      const existing = blocks.find((b) => b.source === sourceName && b.title === asBlock.label);
      if (existing) {
        blocks = blocks.map((b) => (b.id === existing.id ? { ...fresh, id: existing.id } : b));
      } else {
        blocks.push(fresh);
      }
      return;
    }
    seenTaskTitles.add(entry.title);
    const parentId = entry.parentIndex !== undefined ? indexToId.get(entry.parentIndex) : undefined;

    // Identity: the stable key first, so renaming a line no longer destroys and
    // recreates the task (with its logged time, calendar link and dependency
    // edges). A key already claimed earlier in THIS file is a copy-paste, not
    // the same task, so it falls through to the title rule and is re-keyed.
    const statedKey = entry.meta.id;
    const byKey = statedKey && !seenKeys.has(statedKey)
      ? tasks.find((t) => t.mdKey === statedKey)
      : undefined;
    const existing = byKey
      ?? tasks.find((t) => t.source === sourceName && sourceName !== undefined && t.title === entry.title);

    // Only what the markdown actually STATES is written; anything the line is
    // silent about keeps whatever the task already has, so a note can adopt the
    // format one field at a time without flattening edits made in the app.
    const stated: Partial<Task> = {};
    const m = entry.meta;
    if (m.priority !== undefined) stated.priority = m.priority;
    if (m.tags) stated.tags = m.tags;
    if (m.estimateMin !== undefined) stated.estimateMin = m.estimateMin;
    if (m.scheduledAt !== undefined) stated.scheduledAt = m.scheduledAt;
    if (m.deadline !== undefined) stated.deadline = m.deadline;
    if (m.repeat) stated.repeat = m.repeat;
    if (m.locked !== undefined) stated.locked = m.locked || undefined;
    if (m.comment !== undefined) stated.comment = m.comment;
    if (entry.description !== undefined) stated.description = entry.description;

    if (existing) {
      if (statedKey) seenKeys.add(statedKey);
      indexToId.set(i, existing.id);
      titleToId.set(entry.title, existing.id);
      // NOTE: restoreLockedTimes is deliberately NOT applied on this path. The
      // file is the source of truth, so a locked task's times DO move when the
      // markdown says so — that is the whole point of stating them there.
      tasks = tasks.map((t) => (t.id === existing.id ? applyMdEntry(t, entry, stated, parentId, now) : t));
    } else {
      const key = statedKey && !takenKeys.has(statedKey) ? statedKey : newMdKey(takenKeys);
      takenKeys.add(key);
      seenKeys.add(key);
      const status = entry.status ?? "pending";
      const task = newTask({
        title: entry.title,
        parentId,
        source: sourceName,
        mdKey: key,
        status,
        completedAt: status === "done" ? now : undefined,
        // Sent from a note: wire the backlink so note ⇄ task navigate in-app —
        // but never over a description the markdown itself states.
        description: stated.description ?? (linkBack && sourceName ? `From [[${sourceName}]]` : undefined),
        ...stated,
        // A repeat needs an anchor to count occurrences from.
        scheduledAt: m.repeat && m.scheduledAt === undefined ? startOfDay(now) : stated.scheduledAt,
      });
      tasks.push(task);
      indexToId.set(i, task.id);
      titleToId.set(entry.title, task.id);
    }
  });

  // `@after` can name a task defined later in the file, so links are resolved
  // once everything exists. References are TEXT, matched exactly then by
  // case-insensitive prefix, and every edge is gated through canDepend so a
  // note can never write a cycle.
  const wanted = new Map<string, Set<string>>();
  parsed.forEach((entry, i) => {
    const id = indexToId.get(i);
    if (!id || !entry.meta.after?.length) return;
    for (const ref of entry.meta.after) {
      const target = titleToId.get(ref)
        ?? [...titleToId.keys()].find((t) => t.toLowerCase().startsWith(ref.toLowerCase()));
      const fromId = target ? (titleToId.get(target) ?? target) : undefined;
      if (!fromId || fromId === id) continue;
      const set = wanted.get(id) ?? new Set<string>();
      set.add(fromId);
      wanted.set(id, set);
    }
  });
  for (const [id, froms] of wanted) {
    for (const from of froms) {
      if (canDepend(tasks, from, id)) {
        tasks = tasks.map((t) => (t.id === id ? { ...t, dependsOn: [...(t.dependsOn ?? []), from] } : t));
      }
    }
  }

  if (sourceName !== undefined) {
    // Both survival rules, not one: a stamped line that was RENAMED is still in
    // the file (by key), and an unstamped legacy line is still matched by title.
    tasks = tasks.filter((t) =>
      t.source !== sourceName
      || (t.mdKey !== undefined && seenKeys.has(t.mdKey))
      || seenTaskTitles.has(t.title));
    blocks = blocks.filter((b) => b.source !== sourceName || seenBlockLabels.has(b.title));
  }

  const settled = deriveParentStatus(tasks);
  const next: AppState = { ...state, tasks: settled, blocks };
  // Stamp the note this came from: every line gains its `@id` and is rewritten
  // into canonical form, which is what makes renaming safe from here on. Keyed
  // off the line→task map built above, since the lines have no ids yet.
  if (noteId === undefined) return next;
  const byLine = new Map<number, Task>();
  parsed.forEach((entry, i) => {
    const id = indexToId.get(i);
    const task = id ? settled.find((t) => t.id === id) : undefined;
    if (task) byLine.set(entry.line, task);
  });
  return writeNoteBody(next, noteId, (body) =>
    reconcileNoteBody(body, (entry) => {
      const task = byLine.get(entry.line);
      return task?.mdKey ? { task, key: task.mdKey, after: afterTitles(settled, task) } : undefined;
    }, now));
}

/** Titles of the tasks a task depends on — dependencies are named by text in
    the markdown, never by key. */
function afterTitles(tasks: readonly Task[], task: Task): string[] {
  if (!task.dependsOn?.length) return [];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return task.dependsOn.map((id) => byId.get(id)?.title).filter(Boolean) as string[];
}

/** Replace one note's body, leaving the state untouched when nothing changed. */
function writeNoteBody(state: AppState, noteId: string, rewrite: (body: string) => string): AppState {
  const note = state.notes.find((n) => n.id === noteId);
  if (!note) return state;
  const body = rewrite(note.body);
  if (body === note.body) return state;
  return { ...state, notes: state.notes.map((n) => (n.id === noteId ? { ...n, body, updatedAt: Date.now() } : n)) };
}

/** The app → note direction. After anything that changed the tasks, rewrite the
    matching line in whichever note carries that task's `@id`, so an edit made on
    the board, in the list, by dragging the schedule or in the editor shows up in
    the markdown too.

    Notes are searched by key rather than trusted from `task.source`, because
    `source` is the note's TITLE and that changes whenever the H1 is edited. A
    task whose line no longer exists anywhere is simply left alone. */
export function writeTasksBackToNotes(state: AppState, now = Date.now()): AppState {
  if (!state.notes.length || !state.tasks.length) return state;
  const byKey = new Map<string, Task>();
  for (const task of state.tasks) if (task.mdKey) byKey.set(task.mdKey, task);
  if (!byKey.size) return state;

  let notes = state.notes;
  let changed = false;
  for (const note of state.notes) {
    const body = reconcileNoteBody(note.body, (entry) => {
      const key = entry.meta.id;
      const task = key ? byKey.get(key) : undefined;
      return task ? { task, key: key!, after: afterTitles(state.tasks, task) } : undefined;
    }, now);
    if (body !== note.body) {
      notes = notes.map((n) => (n.id === note.id ? { ...n, body, updatedAt: now } : n));
      changed = true;
    }
  }
  return changed ? { ...state, notes } : state;
}

/** Fold one markdown entry onto an existing task. The checkbox is authoritative
    in both directions now — unticking really does un-complete — except on a
    routine, where a box states TODAY's occurrence and the template's own status
    must stay untouched. */
function applyMdEntry(task: Task, entry: ParsedMdTask, stated: Partial<Task>, parentId: string | undefined, now: number): Task {
  const next: Task = { ...task, ...stated, parentId, mdKey: task.mdKey ?? entry.meta.id, title: entry.title };
  if (entry.status === undefined) return next;              // a bare bullet states nothing

  if (next.repeat) {
    const key = occurrenceDateKey(now);
    const occurrenceStatus = { ...next.occurrenceStatus };
    if (entry.status === "pending") delete occurrenceStatus[key];
    else occurrenceStatus[key] = entry.status;
    return { ...next, occurrenceStatus };
  }
  return {
    ...next,
    status: entry.status,
    completedAt: entry.status === "done" ? (task.completedAt ?? now) : undefined,
  };
}

/** iCal (.ics) import. Every VTODO/VEVENT becomes a task carrying its dates,
    priority, tags, status and recurrence, so imports appear across every view.
    Same sync contract as markdown: with a named source, entries upsert keyed on
    (source, title) and any task from that source whose title left the file is
    DELETED. Unlike the markdown upsert (which preserves user edits and only
    touches status), the calendar owns all its mapped fields and rewrites them
    on re-import. Two components sharing a title collapse to one — Task has no
    external-id field, and (source, title) mirrors the markdown importer. */
export function importIcal(state: AppState, text: string, sourceName?: string): AppState {
  const parsed = parseIcal(text);
  let tasks = [...state.tasks];
  const seenTitles = new Set<string>();

  for (const entry of parsed) {
    seenTitles.add(entry.title);
    const fields = {
      title: entry.title,
      description: entry.description,
      status: entry.status,
      priority: entry.priority,
      tags: entry.tags,
      deadline: entry.deadline,
      scheduledAt: entry.scheduledAt,
      estimateMin: entry.estimateMin,
      completedAt: entry.completedAt,
      repeat: entry.repeat,
    };
    const existing = sourceName !== undefined ? tasks.find((t) => t.source === sourceName && t.title === entry.title) : undefined;
    if (existing) {
      tasks = tasks.map((t) => (t.id === existing.id ? { ...t, ...fields } : t));
    } else {
      tasks.push(newTask({ ...fields, source: sourceName }));
    }
  }

  if (sourceName !== undefined) {
    tasks = tasks.filter((t) => t.source !== sourceName || seenTitles.has(t.title));
  }
  return { ...state, tasks: deriveParentStatus(tasks) };
}

/** Every action runs through here, then the notes are brought back into step.

    Keeping the write-back in ONE place is the point: a task can be changed from
    the board, the list, a drag on the schedule, the task editor, the day-start
    re-plan or a Google Calendar pull, and all of them land in the markdown
    without each needing to remember to. */
export function reducer(state: AppState, action: Action): AppState {
  const next = applyAction(state, action);
  if (next.tasks === state.tasks) return next;
  // importMarkdown already reconciled the note it read from, and adopting a
  // remote document must not rewrite that document's own notes.
  if (action.type === "importMarkdown" || action.type === "importState") return next;
  return writeTasksBackToNotes(next);
}

function applyAction(state: AppState, action: Action): AppState {
  const now = Date.now();
  switch (action.type) {
    case "upsertTask": {
      const prev = state.tasks.find((t) => t.id === action.task.id);
      let tasks = prev ? state.tasks.map((t) => (t.id === action.task.id ? action.task : t)) : [...state.tasks, action.task];
      // Live estimate re-pack, confined to the work-hours window when one is
      // set — but ONLY when the edit touches a scheduling input (estimate,
      // scheduled time, tree position) or the task is new. Metadata edits
      // (tags, priority, lock, title…) must never move anything: re-packing
      // on every save silently reset manual drag placements to the packed
      // layout. Callers doing direct timeline manipulation (Schedule resize)
      // pass repack:false so a single task grows in place without re-flowing
      // its siblings.
      const schedTouched = !prev
        || prev.estimateMin !== action.task.estimateMin
        || prev.scheduledAt !== action.task.scheduledAt
        || prev.parentId !== action.task.parentId;
      if (schedTouched && action.repack !== false) {
        // Giving the FIRST unscheduled leaf of an all-unscheduled tree a start
        // time unfolds the whole tree from there: the leaf keeps its literal
        // time and every task after it in the tree packs behind it, inside the
        // work window, with the parents' spans rolled up. Without this,
        // applyEstimatePack below is a no-op until the tree's ROOT has a time,
        // so a plan imported from a note stayed inert until dragged.
        const t = action.task;
        const idxPrev = childIndex(state.tasks);
        const byIdPrev = new Map(state.tasks.map((x) => [x.id, x]));
        const unfoldsTree =
          (!prev || prev.scheduledAt === undefined)
          && t.scheduledAt !== undefined
          && t.parentId !== undefined
          && !idxPrev.has(t.id)
          && treeUnscheduled(idxPrev, byIdPrev, rootAncestorId(tasks, t.id));
        const flowed = unfoldsTree
          ? reflowFrom(tasks, t.id, t.scheduledAt!, activeWindow(state), breakMinutes(state))
          : null;
        tasks = flowed ?? applyEstimatePack(tasks, t.id, activeWindow(state), breakMinutes(state));
      }
      const finalTasks = deriveParentStatus(restoreLockedTimes(state.tasks, tasks));
      // Editing the focused task's estimate refreshes the countdown target, but
      // only while the clock is idle — a live run keeps the target it started with.
      const timer =
        state.timer.taskId === action.task.id && !state.timer.runningSince
          ? { ...state.timer, targetSec: timerTargetSec(state.timer.mode, finalTasks.find((t) => t.id === action.task.id)) }
          : state.timer;
      return { ...state, tasks: finalTasks, timer };
    }
    case "reorderTask": {
      // Move a task among its siblings only (same parent) — the order the list
      // and the estimate packer walk children in. Dropping onto a task with a
      // different parent is a no-op.
      if (action.id === action.targetId) return state;
      const item = state.tasks.find((t) => t.id === action.id);
      const target = state.tasks.find((t) => t.id === action.targetId);
      if (!item || !target || (item.parentId ?? "") !== (target.parentId ?? "")) return state;
      const list = [...state.tasks];
      list.splice(list.findIndex((t) => t.id === action.id), 1);
      const at = list.findIndex((t) => t.id === action.targetId);
      list.splice(action.place === "after" ? at + 1 : at, 0, item);
      // A scheduled tree re-packs so its times follow the new order; an
      // unscheduled one just changes order.
      const idx = childIndex(list);
      const rootId = rootAncestorId(list, action.id);
      const tasks = treeUnscheduled(idx, new Map(list.map((t) => [t.id, t])), rootId)
        ? list
        : applyEstimatePack(list, action.id, activeWindow(state), breakMinutes(state));
      return { ...state, tasks: deriveParentStatus(restoreLockedTimes(state.tasks, tasks)) };
    }
    case "deleteTask": {
      const doomed = subtreeIds(childIndex(state.tasks), action.id);
      // Also strip dangling dependency links pointing at the deleted subtree.
      const kept = state.tasks
        .filter((t) => !doomed.has(t.id))
        .map((t) => (t.dependsOn?.some((d) => doomed.has(d)) ? { ...t, dependsOn: t.dependsOn.filter((d) => !doomed.has(d)) } : t));
      return { ...state, tasks: deriveParentStatus(kept) };
    }
    case "setStatus": {
      const target = state.tasks.find((t) => t.id === action.id);
      if (!target) return state;
      // Parents derive their status from children — not independently settable.
      if (state.tasks.some((t) => t.parentId === action.id)) return state;
      // Routines: a status change applies to ONE day's occurrence (the given
      // day, else today), recorded as a per-day override — the template's
      // `status` never moves, so other days stay independently pending.
      const occurrenceKey = target.repeat ? occurrenceDateKey(action.occurrenceDay ?? now) : undefined;
      // Timer side-effects only make sense for the occurrence being lived
      // right now — marking tomorrow's run must not start/stop today's clock.
      const affectsNow = occurrenceKey === undefined || occurrenceKey === occurrenceDateKey(now);

      // Starting a task you were late for drags its plan to the present: the
      // task moves to now and the rest of its tree reflows behind it, so a
      // 10:00 task begun at 13:00 no longer sits in the past pushing every
      // downstream estimate out of date. Routines are exempt — their
      // scheduledAt is a recurrence anchor, not a one-off appointment.
      // Resuming from a pause is NOT a late start: the task kept running on its
      // original slot while held, so a 10:00 task paused at 10:25 and resumed
      // at 10:45 must still span from 10:00 — don't drag it to the present.
      const resumingFromPause = target.status === "paused";
      let base = state;
      let notice: Notice | undefined;
      if (action.status === "in_progress" && affectsNow && !target.repeat && !resumingFromPause) {
        const plan = planLateStart(state.tasks, action.id, now, breakMinutes(state), activeWindow(state));
        if (plan) {
          // Reuse scheduleTask so the move gets the very same reflow/shift and
          // locked-anchor handling a manual drag to that slot would get.
          base = reducer(state, { type: "scheduleTask", id: action.id, at: plan.startAt });
          notice = plan.blockedBy
            ? {
                id: `n-${now}`,
                kind: "warn",
                text: `“${plan.blockedBy.title}” is locked until ${fmtTime(plan.blockedUntil ?? now)}, so “${target.title}” starts at ${fmtTime(plan.startAt)} instead of now. Work on the locked task first.`,
              }
            : { id: `n-${now}`, kind: "info", text: `“${target.title}” was overdue — moved to ${fmtTime(plan.startAt)} and the rest of its plan shifted along.` };
        }
      }

      let next = base;
      const runningHere = base.timer.taskId === action.id && base.timer.runningSince !== undefined;
      // Leaving in_progress banks the running session (desktop auto-stop) — but
      // NOT for a pause: pausing freezes the clock and keeps the elapsed time,
      // which is banked later on completion or when the timer is switched away.
      if (runningHere && action.status !== "in_progress" && action.status !== "paused" && affectsNow) {
        next = logTimer(base, now);
      }
      let tasks = next.tasks.map((t) =>
        t.id === action.id
          ? occurrenceKey !== undefined
            ? { ...t, occurrenceStatus: { ...t.occurrenceStatus, [occurrenceKey]: action.status } }
            : {
                ...t,
                status: action.status,
                completedAt: action.status === "done" ? now : undefined,
                // `startedAt` tracks the last entry into in_progress for the
                // status check-in nudge; anything else clears it.
                startedAt: action.status === "in_progress" ? now : undefined,
              }
          : t,
      );
      let timer = next.timer;
      let sessions = next.sessions;
      // Pausing this task freezes its clock without banking — the elapsed count
      // is held so a resume continues from it, and `pausedSince` starts the
      // break clock so the away span is logged on resume.
      if (action.status === "paused" && runningHere && affectsNow) {
        timer = { ...timer, baseSec: elapsedSec(timer, now), runningSince: undefined, pausedSince: now };
      }
      // Entering in_progress auto-starts the timer on this task (desktop 1.6).
      // Resuming a task the timer already holds keeps its held elapsed count;
      // starting a fresh one zeroes it.
      if (action.status === "in_progress" && !runningHere && affectsNow) {
        const resuming = timer.taskId === action.id;
        if (resuming) {
          const banked = bankPause({ ...next, tasks, timer, sessions }, now);
          tasks = banked.tasks;
          sessions = banked.sessions;
          timer = banked.timer;
        } else {
          // The clock is moving to a DIFFERENT task, so whatever it holds for
          // the old one has to be banked first — including a run that is only
          // PAUSED. Guarding this on `runningSince` meant an auto-paused task
          // lost every minute it had worked the moment you started something
          // else: its `baseSec` was overwritten below and never reached
          // `loggedMin`, so coming back to it showed 0m elapsed.
          if (elapsedSec(timer, now) >= 1 || timer.pausedSince !== undefined) {
            const banked = logTimer({ ...next, tasks, timer, sessions }, now);
            tasks = banked.tasks;
            sessions = banked.sessions;
            timer = banked.timer;
          }
          timer = { ...timer, targetSec: timerTargetSec(timer.mode, tasks.find((t) => t.id === action.id)) };
        }
        timer = { ...timer, taskId: action.id, runningSince: now, baseSec: resuming ? timer.baseSec : 0, pausedSince: undefined };
      }
      // A task bound to habits fills every one of their days (lib/habitLink.ts),
      // on the day the TASK belongs to — ticking Monday's task on Tuesday
      // credits Monday. One pass, no re-dispatch, so the two edges cannot bounce.
      const habits = applyTaskStatusToHabits(
        next.habits,
        next.tasks,
        target,
        action.status,
        taskHabitDayKey(target, now, action.occurrenceDay),
        now,
      );
      return { ...next, tasks: deriveParentStatus(tasks), habits, timer, sessions, notice: notice ?? next.notice };
    }
    case "scheduleTask": {
      const target = state.tasks.find((t) => t.id === action.id);
      if (!target || target.locked) return state;
      const idx = childIndex(state.tasks);

      // Divide & conquer: dragging a leaf SUBTASK reflows it and every task
      // after it in its tree from the drop point (earlier and completed tasks
      // stay put), keeping the run inside the work-hours window. Roots and
      // parents fall through to the whole-tree shift below.
      if (action.at !== undefined && target.parentId && !idx.has(action.id)) {
        const reflowed = reflowFrom(state.tasks, action.id, action.at, activeWindow(state), breakMinutes(state));
        if (reflowed) return { ...state, tasks: deriveParentStatus(restoreLockedTimes(state.tasks, reflowed)) };
      }

      // Dropping a parent whose subtree carries NO times yet estimate-packs
      // the whole tree from the drop point — the md-import flow: import a
      // task tree, bulk-set estimates, drag the one unplanned card onto a
      // morning and the plan unfolds. Without this, only upsertTask (editor
      // edits, estimate changes) ever packed, so the outcome depended on
      // whether estimates were set before or after the first drag. Trees
      // that already carry times keep the whole-tree shift below.
      if (action.at !== undefined && idx.has(action.id)) {
        const sub = subtreeIds(idx, action.id);
        const anyDescendantScheduled = state.tasks.some(
          (t) => t.id !== action.id && sub.has(t.id) && t.scheduledAt !== undefined,
        );
        if (!anyDescendantScheduled) {
          const packed = packSubtree(state.tasks, action.id, action.at, activeWindow(state), breakMinutes(state));
          const tasks = state.tasks.map((t) => {
            const w = packed.get(t.id);
            if (!w) return t;
            return {
              ...t,
              scheduledAt: w.start,
              // Parents span their children; leaves keep their own estimates.
              estimateMin: idx.has(t.id) ? Math.round((w.end - w.start) / 60_000) : t.estimateMin,
            };
          });
          return { ...state, tasks: deriveParentStatus(restoreLockedTimes(state.tasks, tasks)) };
        }
      }

      const blockMs = (t: Task) => Math.max(30, t.estimateMin ?? 60) * 60_000;

      // Root-of lookups run once per task in the maps below, so resolve them
      // against a shared id→task map with a cache instead of rescanning.
      const byId = new Map(state.tasks.map((t) => [t.id, t]));
      const rootCache = new Map<string, string>();
      const rootOf = (id: string): string => {
        const hit = rootCache.get(id);
        if (hit) return hit;
        let cursor = byId.get(id);
        while (cursor?.parentId && byId.get(cursor.parentId)) cursor = byId.get(cursor.parentId)!;
        const root = cursor?.id ?? id;
        rootCache.set(id, root);
        return root;
      };

      // Moving any task in an estimate-packed tree shifts the tree by the same
      // delta so its siblings travel with it — but COMPLETED subtasks stay put:
      // they already happened, so they are fixed anchors and only the pending
      // part of the tree moves. The tree is everything under the top-most
      // ancestor (root + all of its descendants).
      const rootId = rootOf(action.id);
      const tree = subtreeIds(idx, rootId);
      const delta = action.at !== undefined && target.scheduledAt !== undefined ? action.at - target.scheduledAt : undefined;

      // "Squeeze": dropping a task onto another tree's pending run pushes that
      // run (the pending tasks starting at/after the drop point) later by the
      // dropped task's own length, so a new task can be wedged between the
      // completed and pending subtasks and the rest reflow automatically.
      // Completed tasks are never pushed.
      const dropStart = action.at;
      const dropEnd = dropStart !== undefined ? dropStart + blockMs(target) : undefined;
      const pushRoots = new Set<string>();
      if (dropStart !== undefined && dropEnd !== undefined) {
        for (const t of state.tasks) {
          if (tree.has(t.id) || t.status === "done" || t.scheduledAt === undefined) continue;
          if (t.scheduledAt < dropEnd && t.scheduledAt + blockMs(t) > dropStart) {
            pushRoots.add(rootOf(t.id));
          }
        }
      }
      const pushMs = dropEnd !== undefined && dropStart !== undefined ? dropEnd - dropStart : 0;

      return {
        ...state,
        tasks: state.tasks.map((t) => {
          if (t.id === action.id) return { ...t, scheduledAt: action.at };
          // Completed and locked tasks are fixed anchors — never shifted or pushed.
          if (t.status === "done" || t.locked || t.scheduledAt === undefined) return t;
          if (delta !== undefined && tree.has(t.id)) return { ...t, scheduledAt: t.scheduledAt + delta };
          if (dropStart !== undefined && t.scheduledAt >= dropStart && pushRoots.has(rootOf(t.id))) {
            return { ...t, scheduledAt: t.scheduledAt + pushMs };
          }
          return t;
        }),
      };
    }
    case "importMarkdown":
      return importMarkdown(state, action.text, action.sourceName, action.linkBack, action.noteId);
    case "importIcal":
      return importIcal(state, action.text, action.sourceName);
    case "addBlock":
      return { ...state, blocks: [...state.blocks, action.block] };
    case "deleteBlock":
      return { ...state, blocks: state.blocks.filter((b) => b.id !== action.id) };
    case "upsertNote": {
      const exists = state.notes.some((nt) => nt.id === action.note.id);
      return { ...state, notes: exists ? state.notes.map((nt) => (nt.id === action.note.id ? action.note : nt)) : [...state.notes, action.note] };
    }
    case "deleteNote": {
      // Nested pages: deleting a note removes its whole subtree.
      const doomed = new Set<string>([action.id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const nt of state.notes) {
          if (nt.parentId && doomed.has(nt.parentId) && !doomed.has(nt.id)) { doomed.add(nt.id); grew = true; }
        }
      }
      return { ...state, notes: state.notes.filter((nt) => !doomed.has(nt.id)) };
    }
    // Status, rating and tag edits all arrive as a whole book, the same way
    // notes are edited — one verb rather than a verb per field.
    /* Identity is the ISBN (or title+author), not the id.

       Scanning the same book in a second session mints a fresh id, so an
       id-only match appended a second copy of a book already on the shelf —
       which is exactly what happens when a shelf is catalogued over more than
       one sitting. Matching on identity too makes that impossible from every
       entry point at once: scan, manual add and editor save all land here. */
    case "upsertHabit": {
      const i = state.habits.findIndex((h) => h.id === action.habit.id);
      if (i === -1) return { ...state, habits: [...state.habits, action.habit] };
      const habits = [...state.habits];
      habits[i] = action.habit;
      return { ...state, habits };
    }

    case "deleteHabit":
      return { ...state, habits: state.habits.filter((h) => h.id !== action.id) };

    case "tickHabit": {
      const habits = state.habits.map((h) => (h.id === action.id ? tickHabit(h, action.day, action.delta) : h));
      // The other edge of the binding: a habit whose day reaches its target
      // completes the tasks feeding it for that same day — once their OTHER
      // habits are kept too — and reopens them when it falls back below. Tasks already in the wanted state come back
      // identical, which is what keeps this from bouncing back through
      // setStatus above.
      if (!habits.some((h) => h.id === action.id)) return { ...state, habits };
      // Passed the whole habits list, not just the ticked one: a task can feed
      // several habits and only closes once all of them are kept, so the
      // answer cannot be derived from a single habit.
      const tasks = applyHabitDayToTasks(state.tasks, habits, action.day, now);
      return { ...state, habits, tasks: tasks === state.tasks ? state.tasks : deriveParentStatus(tasks) };
    }

    case "importHabits":
      return { ...state, habits: mergeImportedHabits(state.habits, action.habits, action.source) };

    case "upsertBook": {
      const byId = state.books.findIndex((b) => b.id === action.book.id);
      if (byId !== -1) {
        const books = [...state.books];
        books[byId] = action.book;
        return { ...state, books };
      }
      const dupe = indexOfDuplicate(state.books, action.book);
      if (dupe !== -1) {
        // Written back into the same slot, so enriching a book does not make
        // it jump to the end of the shelf.
        const books = [...state.books];
        books[dupe] = mergeDuplicate(books[dupe], action.book);
        return { ...state, books };
      }
      return { ...state, books: [...state.books, action.book] };
    }
    case "reorderPlugin": {
      // Drag-to-reorder the tabs. Stored complete rather than as a diff, so an
      // order written by an older build repairs itself on the next drag.
      if (action.id === action.targetId) return state;
      return {
        ...state,
        settings: {
          ...state.settings,
          pluginOrder: movePlugin(state.settings.pluginOrder, action.id, action.targetId),
        },
      };
    }
    case "dedupeBooks": {
      const { books, removed } = dedupeBooks(state.books);
      return removed === 0 ? state : { ...state, books };
    }
    case "deleteBook":
      return { ...state, books: state.books.filter((b) => b.id !== action.id) };
    /* Bulk operations are single transitions rather than a loop of
       deleteBook/upsertBook dispatches. Cleaning up a 400-book import means
       selecting dozens at once, and N dispatches would be N reducer passes and
       N renders for one user action. */
    case "deleteBooks": {
      const ids = new Set(action.ids);
      if (ids.size === 0) return state;
      return { ...state, books: state.books.filter((b) => !ids.has(b.id)) };
    }
    case "updateBooks": {
      const ids = new Set(action.ids);
      if (ids.size === 0) return state;
      return {
        ...state,
        books: state.books.map((b) => (ids.has(b.id) ? { ...b, ...action.patch } : b)),
      };
    }
    // Separate from upsertBook because a CSV merge has to be one atomic
    // transition: dedupe-by-ISBN across the whole incoming set at once.
    case "importBooks":
      return { ...state, books: mergeImportedBooks(state.books, action.books).books };
    case "addFolder": {
      const name = action.name.trim();
      if (!name) return state;
      return { ...state, folders: [...state.folders, { id: `f-${now}-${Math.floor(Math.random() * 1e4)}`, name }] };
    }
    case "renameFolder": {
      const name = action.name.trim();
      if (!name) return state;
      return { ...state, folders: state.folders.map((f) => (f.id === action.id ? { ...f, name } : f)) };
    }
    case "deleteFolder": {
      // The last notebook is never removed: a new note needs somewhere to live,
      // and a vault with no notebooks has no way back to one.
      if (state.folders.length <= 1 || !state.folders.some((f) => f.id === action.id)) return state;
      return {
        ...state,
        folders: state.folders.filter((f) => f.id !== action.id),
        notes: state.notes.filter((nt) => nt.folderId !== action.id),
      };
    }
    case "moveNoteToFolder": {
      const moving = state.notes.find((nt) => nt.id === action.id);
      if (!moving || moving.folderId === action.folderId) return state;
      if (!state.folders.some((f) => f.id === action.folderId)) return state;
      // A page carries its subpages with it; only the page being moved loses
      // its parent link, since that parent stays behind in the old notebook.
      const subtree = new Set<string>([action.id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const nt of state.notes) {
          if (nt.parentId && subtree.has(nt.parentId) && !subtree.has(nt.id)) { subtree.add(nt.id); grew = true; }
        }
      }
      return {
        ...state,
        notes: state.notes.map((nt) =>
          subtree.has(nt.id)
            ? { ...nt, folderId: action.folderId, parentId: nt.id === action.id ? undefined : nt.parentId }
            : nt,
        ),
      };
    }
    case "reorderFolder": {
      // Drag-to-reorder notebooks: pull `id` out and drop it just before
      // `targetId`. Order is the array order the sidebar renders in.
      if (action.id === action.targetId) return state;
      const folders = [...state.folders];
      const from = folders.findIndex((f) => f.id === action.id);
      if (from < 0) return state;
      const [item] = folders.splice(from, 1);
      const to = folders.findIndex((f) => f.id === action.targetId);
      if (to < 0) return state;
      folders.splice(to, 0, item);
      return { ...state, folders };
    }
    case "reorderNote": {
      // Reorder a page within its sibling group only (same notebook + same
      // parent page) — dropping onto a page in another group is a no-op.
      if (action.id === action.targetId) return state;
      const item = state.notes.find((nt) => nt.id === action.id);
      const target = state.notes.find((nt) => nt.id === action.targetId);
      if (!item || !target) return state;
      if (item.folderId !== target.folderId || (item.parentId ?? "") !== (target.parentId ?? "")) return state;
      const notes = [...state.notes];
      notes.splice(notes.findIndex((nt) => nt.id === action.id), 1);
      notes.splice(notes.findIndex((nt) => nt.id === action.targetId), 0, item);
      return { ...state, notes };
    }
    case "addMindNode":
      return { ...state, mind: [...state.mind, action.node] };
    case "moveMindNode":
      return { ...state, mind: state.mind.map((m) => (m.id === action.id ? { ...m, x: action.x, y: action.y } : m)) };
    case "renameMindNode":
      return { ...state, mind: state.mind.map((m) => (m.id === action.id ? { ...m, label: action.label } : m)) };
    case "timerStart": {
      const taskId = action.taskId ?? state.timer.taskId;
      // Any held time belongs to the task the clock is leaving — bank it (and
      // its pending pause) rather than letting `baseSec`/`pausedSince` ride
      // over onto the new task, where it would read as time worked here.
      const switching = taskId !== state.timer.taskId &&
        (elapsedSec(state.timer, now) >= 1 || state.timer.pausedSince !== undefined);
      let base = switching ? logTimer(state, now) : state;
      // Resuming the task the clock already holds: bank the pause gap first.
      if (!switching && base.timer.pausedSince !== undefined) base = bankPause(base, now);
      const targetSec = timerTargetSec(base.timer.mode, base.tasks.find((t) => t.id === taskId));
      return {
        ...base,
        timer: { ...base.timer, taskId, runningSince: now, targetSec, pausedSince: undefined },
        tasks: deriveParentStatus(base.tasks.map((t) => {
          if (t.id !== taskId) return t;
          // Routines auto-promote TODAY's occurrence, never the template.
          if (t.repeat) {
            const key = occurrenceDateKey(now);
            const occ = t.occurrenceStatus?.[key] ?? "pending";
            return occ === "pending" || occ === "paused"
              ? { ...t, occurrenceStatus: { ...t.occurrenceStatus, [key]: "in_progress" } }
              : t;
          }
          return t.status === "pending" || t.status === "paused" ? { ...t, status: "in_progress", startedAt: now } : t;
        })),
      };
    }
    case "timerAutoPause": {
      // Fired by shell/AppShell when the timer has run untouched past the
      // auto-pause window: freeze worked time at the last interaction instant
      // (`since`), not now, so the idle span is not banked as focus, and mark
      // `pausedSince` there so resume logs it as a break.
      if (!state.timer.runningSince) return state;
      const since = Math.min(now, Math.max(action.since, state.timer.runningSince));
      const timer = { ...state.timer, baseSec: elapsedSec(state.timer, since), runningSince: undefined, pausedSince: since };
      const held = state.tasks.find((t) => t.id === state.timer.taskId);
      if (!held) return { ...state, timer };
      const tasks = state.tasks.map((t) => {
        if (t.id !== held.id) return t;
        if (t.repeat) {
          const key = occurrenceDateKey(now);
          return (t.occurrenceStatus?.[key] ?? t.status) === "in_progress"
            ? { ...t, occurrenceStatus: { ...t.occurrenceStatus, [key]: "paused" as TaskStatus } }
            : t;
        }
        return t.status === "in_progress" ? { ...t, status: "paused" as TaskStatus, startedAt: undefined } : t;
      });
      return { ...state, timer, tasks: deriveParentStatus(tasks) };
    }
    case "sessionDelete": {
      const target = state.sessions.find((s) => s.id === action.id);
      if (!target) return state;
      const sessions = state.sessions.filter((s) => s.id !== action.id);
      const tasks = sessionKind(target) === "focus" && target.taskId
        ? state.tasks.map((t) => (t.id === target.taskId ? { ...t, loggedMin: Math.max(0, t.loggedMin - target.minutes) } : t))
        : state.tasks;
      return { ...state, sessions, tasks };
    }
    case "timerPause": {
      const timer = { ...state.timer, baseSec: elapsedSec(state.timer, now), runningSince: undefined, pausedSince: now };
      // Pausing the clock puts the task it's timing on hold too — the "quick
      // errand" gesture. Routines pause today's occurrence, not the template.
      const held = state.tasks.find((t) => t.id === state.timer.taskId);
      if (!held) return { ...state, timer };
      const tasks = state.tasks.map((t) => {
        if (t.id !== held.id) return t;
        if (t.repeat) {
          const key = occurrenceDateKey(now);
          return (t.occurrenceStatus?.[key] ?? t.status) === "in_progress"
            ? { ...t, occurrenceStatus: { ...t.occurrenceStatus, [key]: "paused" as TaskStatus } }
            : t;
        }
        return t.status === "in_progress" ? { ...t, status: "paused" as TaskStatus, startedAt: undefined } : t;
      });
      return { ...state, timer, tasks: deriveParentStatus(tasks) };
    }
    case "timerReset":
      return { ...state, timer: { ...state.timer, baseSec: 0, runningSince: undefined, pausedSince: undefined } };
    case "timerComplete":
      return logTimer(state, now);
    case "timerMode": {
      const targetSec = timerTargetSec(action.mode, state.tasks.find((t) => t.id === state.timer.taskId));
      return { ...state, timer: { ...state.timer, mode: action.mode, targetSec, baseSec: 0, runningSince: undefined, pausedSince: undefined } };
    }
    case "quickTimerAdd": {
      const totalSec = Math.round(action.minutes * 60);
      if (totalSec <= 0) return state;
      const qt = { id: `qt-${now}-${Math.floor(Math.random() * 1e6)}`, label: action.label ?? `${action.minutes} min`, totalSec, endsAt: now + totalSec * 1000 };
      return { ...state, quickTimers: [...state.quickTimers, qt] };
    }
    case "quickTimerToggle":
      return {
        ...state,
        quickTimers: state.quickTimers.map((t) => {
          if (t.id !== action.id) return t;
          if (t.endsAt === undefined) return { ...t, endsAt: now + (t.remainSec ?? t.totalSec) * 1000, remainSec: undefined };
          const remainSec = (t.endsAt - now) / 1000;
          // Running → pause with the remainder banked; already rung → restart in full.
          return remainSec <= 0 ? { ...t, endsAt: now + t.totalSec * 1000, remainSec: undefined } : { ...t, endsAt: undefined, remainSec };
        }),
      };
    case "quickTimerRemove":
      return { ...state, quickTimers: state.quickTimers.filter((t) => t.id !== action.id) };
    case "setSettings":
      return { ...state, settings: { ...state.settings, ...action.patch } };
    case "togglePlugin":
      return {
        ...state,
        settings: {
          ...state.settings,
          plugins: { ...state.settings.plugins, [action.id]: !state.settings.plugins[action.id] },
        },
      };
    case "dayStart": {
      // Answering the prompt closes it for the day whether or not anything
      // moved — the gate is "you were asked", not "work was done".
      const settings = { ...state.settings, lastDayStartDay: occurrenceDateKey(action.from) };
      const outcome = planDayStartOutcome(state.tasks, action.from, breakMinutes(state), activeWindow(state));
      if (outcome.kind !== "repacked") {
        // Still confirm it out loud. A silent dialog dismissal is why "when
        // does today start" read as doing nothing on a day of appointments.
        const why =
          outcome.kind === "pinned"
            ? "nothing re-packed — everything left today is locked or a routine, and both stay put"
            : outcome.kind === "empty"
              ? "nothing is scheduled for today yet"
              : "today’s plan already fits";
        return { ...state, settings, notice: { id: `n-${now}`, kind: "info", text: `Day starts at ${fmtTime(action.from)} — ${why}.` } };
      }
      const plan = outcome.plan;
      const moved = `${plan.movedCount} task${plan.movedCount === 1 ? "" : "s"}`;
      const notice: Notice = plan.blockedBy
        ? {
            id: `n-${now}`,
            kind: "warn",
            text: `Day starts at ${fmtTime(action.from)} — ${moved} re-packed from there, around “${plan.blockedBy.title}”, which is locked and stayed put.`,
          }
        : { id: `n-${now}`, kind: "info", text: `Day starts at ${fmtTime(action.from)} — ${moved} re-packed from there.` };
      return { ...state, settings, tasks: deriveParentStatus(restoreLockedTimes(state.tasks, plan.tasks)), notice };
    }
    case "skipDayStart":
      return { ...state, settings: { ...state.settings, lastDayStartDay: occurrenceDateKey(action.day) } };
    case "googleSyncApplied": {
      // A sync runs for seconds. Existing tasks are therefore changed FIELD BY
      // FIELD against whatever they look like now — never replaced with an
      // object the sync captured when it began, which would silently revert
      // every edit made while it was in flight.
      let tasks = state.tasks;
      const doomed = new Set(action.deletes);
      if (doomed.size) {
        const gone = new Set<string>();
        const idx = childIndex(tasks);
        for (const id of doomed) for (const descendant of subtreeIds(idx, id)) gone.add(descendant);
        tasks = tasks.filter((t) => !gone.has(t.id));
      }
      for (const { id, fields } of action.patches) {
        if (doomed.has(id)) continue;
        tasks = tasks.map((t) => (t.id === id ? { ...t, ...fields } : t));
      }
      for (const task of action.imports) {
        if (doomed.has(task.id) || tasks.some((t) => t.id === task.id)) continue;
        tasks = [...tasks, task];
      }
      const google = state.settings.google;
      const settings = google
        ? {
            ...state.settings,
            google: {
              ...google,
              accounts: google.accounts.map((a) => (a.id === action.accountId ? { ...a, lastSyncAt: action.at } : a)),
            },
          }
        : state.settings;
      return { ...state, settings, tasks: deriveParentStatus(restoreLockedTimes(state.tasks, tasks)) };
    }
    case "dismissNotice":
      return state.notice === undefined ? state : { ...state, notice: undefined };
    case "importState":
      // Adopting a remote document also clears any local banner — it explained
      // a plan that this document may no longer have.
      return { ...action.state, notice: undefined };
  }
}

/* ————— React context + encrypted persistence ————— */

export interface SyncStatus {
  state: "off" | "syncing" | "ok" | "error";
  at?: number;
  detail?: string;
}

/** Present only in team mode: who/where the current document belongs to. */
export interface TeamInfo {
  user: ApiUser;
  projectId: string;
  projectName: string;
  role: ProjectRole;
}

interface StoreCtx {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  lock: () => void;
  /** Re-encrypt the vault under a new passphrase; future saves use the new key. */
  rekey: (passphrase: string) => Promise<void>;
  sync: SyncStatus;
  syncNow: () => void;
  /** True when the current session may not mutate the document (team viewer). */
  readOnly: boolean;
  /** Team-mode context, or undefined in local-vault mode. */
  team?: TeamInfo;
  /** Team mode: return to the project switcher. Undefined in local mode. */
  switchProject?: () => void;
}

const Ctx = createContext<StoreCtx | null>(null);

export function StoreProvider({ vault, onLock, children }: { vault: VaultHandle; onLock: () => void; children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, vault.state);
  const [sync, setSync] = useState<SyncStatus>({ state: "off" });
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const pushTimer = useRef<ReturnType<typeof setTimeout>>();
  const keyRef = useRef({ key: vault.key, salt: vault.salt, passphrase: vault.passphrase });
  const applyingRemote = useRef(false);
  const syncBusy = useRef(false);
  const syncAgain = useRef(false);
  const cfg = state.settings.sync;

  // Ask the browser to shield this origin's storage from eviction — the
  // vault has no server copy unless sync is on, so localStorage IS the database.
  useEffect(() => {
    void navigator.storage?.persist?.();
  }, []);

  // Keep the module-level clock style in step with settings (fmtTime and
  // friends read it without threading settings through every call site).
  useEffect(() => {
    setHourFormat(state.settings.hourFormat ?? "24");
  }, [state.settings.hourFormat]);

  /** Compare with the NAS and converge. Never throws; failures = local-only. */
  async function runSync() {
    const conf = stateRef.current.settings.sync;
    if (!conf.enabled || !conf.username) return;
    // A save landing mid-sync must not be dropped: the in-flight run read an
    // older local payload, so remember that another pass is owed and take it
    // as soon as this one lands.
    if (syncBusy.current) { syncAgain.current = true; return; }
    syncBusy.current = true;
    setSync((s) => ({ ...s, state: "syncing" }));
    try {
      const local = localPayload()!;
      const syncedStamp = localStorage.getItem(SYNCED_STAMP_KEY);
      const plan = decideSync(await pullRemote(conf), local, syncedStamp);
      if (plan.action === "push") {
        await pushRemote(conf, local);
        localStorage.setItem(SYNCED_STAMP_KEY, payloadStamp(local));
      } else if (plan.action === "pull" || (plan.action === "conflict" && plan.winner === "remote")) {
        if (plan.action === "conflict") localStorage.setItem(CONFLICT_KEY, JSON.stringify(local));
        const salt = payloadSalt(plan.remote);
        const key = await deriveKey(keyRef.current.passphrase, salt);
        const remoteState = hydrateState(await decryptJson<AppState>(key, plan.remote));
        keyRef.current = { key, salt, passphrase: keyRef.current.passphrase };
        applyingRemote.current = true;
        writeLocalPayload(plan.remote);
        localStorage.setItem(SYNCED_STAMP_KEY, payloadStamp(plan.remote));
        dispatch({ type: "importState", state: remoteState });
      } else if (plan.action === "conflict") {
        localStorage.setItem(CONFLICT_KEY, JSON.stringify(plan.remote));
        await pushRemote(conf, local);
        localStorage.setItem(SYNCED_STAMP_KEY, payloadStamp(local));
      } else {
        localStorage.setItem(SYNCED_STAMP_KEY, payloadStamp(local));
      }
      setSync({ state: "ok", at: Date.now() });
    } catch (err) {
      setSync({ state: "error", at: Date.now(), detail: err instanceof Error ? err.message : "failed" });
    } finally {
      syncBusy.current = false;
      if (syncAgain.current) { syncAgain.current = false; void runSync(); }
    }
  }

  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      // A state change caused by adopting the remote blob is already on disk.
      if (applyingRemote.current) {
        applyingRemote.current = false;
        return;
      }
      const prev = localPayload();
      const payload: SyncedPayload = {
        ...(await encryptJson(keyRef.current.key, keyRef.current.salt, persistableState(state))),
        ...stampEnvelope(prev?.rev ?? 0),
      };
      writeLocalPayload(payload);
      if (state.settings.sync.enabled) {
        clearTimeout(pushTimer.current);
        pushTimer.current = setTimeout(() => void runSync(), 1500);
      }
    }, 300);
    return () => clearTimeout(timerRef.current);
  }, [state]);

  // Automatic propagation: sync on unlock, on tab focus, and every 25 s
  // while the tab is visible.
  useEffect(() => {
    if (!cfg.enabled) {
      setSync({ state: "off" });
      return;
    }
    void runSync();
    const onFocus = () => { if (document.visibilityState === "visible") void runSync(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const poll = setInterval(() => { if (document.visibilityState === "visible") void runSync(); }, 25_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      clearInterval(poll);
    };
  }, [cfg.enabled, cfg.url, cfg.username, cfg.password]);

  const rekey = async (passphrase: string) => {
    const handle = await rekeyVault(state, passphrase);
    keyRef.current = { key: handle.key, salt: handle.salt, passphrase };
  };

  return <Ctx.Provider value={{ state, dispatch, lock: onLock, rekey, sync, syncNow: () => void runSync(), readOnly: false }}>{children}</Ctx.Provider>;
}

/* ————— team mode: authenticated per-project document sync ————— */

/** Coerce a stored project doc into a valid AppState. A brand-new project's doc
    is `{}` (server seeds `rev 0, data '{}'`) — treat that as a clean, empty
    workspace; a real doc fills any settings fields added since it was written. */
export function teamStateFrom(data: unknown): AppState {
  const seed = seedState();
  if (data && typeof data === "object" && Array.isArray((data as Partial<AppState>).tasks)) {
    const d = data as Partial<AppState>;
    return hydrateState({ ...seed, ...d } as AppState);
  }
  return { ...seed, tasks: [], blocks: [], folders: [], notes: [], mind: [], mindTitle: "", sessions: [], books: [], habits: [] };
}

/** Team-mode store: the same pure reducer, but the document is loaded from and
    saved to the team backend (server/) with the rev/conflict flow, scoped to one
    project. Viewers get a read-only session — mutations are dropped so the UI
    can stay simple and the server never sees an unauthorized write. */
export function TeamStoreProvider({
  session, onSignOut, onSwitchProject, children,
}: {
  session: { user: ApiUser; project: ApiProject; doc: ApiDoc };
  onSignOut: () => void;
  onSwitchProject: () => void;
  children: ReactNode;
}) {
  const role = session.project.role ?? "viewer";
  const readOnly = !api.canEdit(role);
  const [state, rawDispatch] = useReducer(reducer, session.doc, (d) => teamStateFrom(d.data));
  const [sync, setSync] = useState<SyncStatus>({ state: "ok", at: Date.now() });

  const revRef = useRef(session.doc.rev);
  const stateRef = useRef(state); stateRef.current = state;

  useEffect(() => {
    setHourFormat(state.settings.hourFormat ?? "24");
  }, [state.settings.hourFormat]);
  const applyingRemote = useRef(false);
  const dirty = useRef(false);
  const busy = useRef(false);
  const again = useRef(false);
  const first = useRef(true);
  const pushTimer = useRef<ReturnType<typeof setTimeout>>();

  // Viewers cannot mutate: swallow every action except a remote-adopt, so the
  // reducer state stays a faithful mirror of the server document.
  const dispatch: React.Dispatch<Action> = (action) => {
    if (readOnly && action.type !== "importState") return;
    rawDispatch(action);
  };

  async function push() {
    if (readOnly) return;
    if (busy.current) { again.current = true; return; }
    busy.current = true;
    setSync({ state: "syncing" });
    try {
      const res = await api.putDoc(session.project.id, revRef.current, persistableState(stateRef.current));
      revRef.current = res.rev;
      dirty.current = false;
      setSync({ state: "ok", at: Date.now() });
    } catch (err) {
      if (err instanceof ConflictError) {
        // Someone else advanced the doc: adopt theirs so we converge. Whole-doc
        // sync means last-writer-wins per rev; finer merge is Phase 2.
        revRef.current = err.current.rev;
        dirty.current = false;
        applyingRemote.current = true;
        rawDispatch({ type: "importState", state: teamStateFrom(err.current.data) });
        setSync({ state: "error", at: Date.now(), detail: "Loaded a newer version someone else saved." });
      } else {
        setSync({ state: "error", at: Date.now(), detail: err instanceof Error ? err.message : "sync failed" });
      }
    } finally {
      busy.current = false;
      if (again.current) { again.current = false; void push(); }
    }
  }

  // Persist edits (debounced). Skip the first run — that is just the initial
  // document we already have — unless the project is brand-new (rev 0), which we
  // save once so its doc stops being the empty `{}` placeholder.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      if (revRef.current === 0 && !readOnly) void push();
      return;
    }
    if (applyingRemote.current) { applyingRemote.current = false; return; }
    if (readOnly) return;
    dirty.current = true;
    clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => void push(), 500);
    return () => clearTimeout(pushTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Poll for edits made by teammates; adopt them when we have nothing pending.
  useEffect(() => {
    const poll = async () => {
      if (document.visibilityState !== "visible" || dirty.current || busy.current) return;
      try {
        const doc = await api.getDoc(session.project.id);
        if (doc.rev !== revRef.current && !dirty.current) {
          revRef.current = doc.rev;
          applyingRemote.current = true;
          rawDispatch({ type: "importState", state: teamStateFrom(doc.data) });
          setSync({ state: "ok", at: Date.now() });
        }
      } catch { /* transient: keep the local copy */ }
    };
    const id = setInterval(poll, 12_000);
    const onFocus = () => { if (document.visibilityState === "visible") void poll(); };
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(id); window.removeEventListener("focus", onFocus); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.project.id]);

  const team: TeamInfo = { user: session.user, projectId: session.project.id, projectName: session.project.name, role };
  const rekey = async () => { throw new Error("Passphrases are a local-vault feature."); };

  return (
    <Ctx.Provider value={{ state, dispatch, lock: onSignOut, rekey, sync, syncNow: () => void push(), readOnly, team, switchProject: onSwitchProject }}>
      {children}
    </Ctx.Provider>
  );
}

export function useStore(): StoreCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStore outside StoreProvider");
  return ctx;
}

/* ————— shared selectors ————— */

/** The day key the start prompt records once it has been answered or skipped. */
export function dayStartAnswered(ms: number): string {
  return occurrenceDateKey(ms);
}

/** Is this the first open of a new day, with the prompt switched on? The day
    key lives in the synced settings on purpose: answering on your phone at 09:00
    should not make the laptop ask again at 09:05. */
export function shouldAskDayStart(state: AppState, now: number): boolean {
  if (state.settings.dayStartPrompt === false) return false;
  return state.settings.lastDayStartDay !== occurrenceDateKey(now);
}

export function rootTasks(state: AppState): Task[] {
  return state.tasks.filter((t) => !t.parentId);
}

export function childTasks(state: AppState, id: string): Task[] {
  return state.tasks.filter((t) => t.parentId === id);
}

export function newTask(patch: Partial<Task> = {}): Task {
  return {
    id: `t-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    title: "",
    status: "pending",
    priority: 2,
    tags: [],
    createdAt: Date.now(),
    loggedMin: 0,
    ...patch,
  };
}
