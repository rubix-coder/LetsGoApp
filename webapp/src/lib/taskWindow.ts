/* How much of the plan the boards actually show.

   Every board view listed the whole vault: a year of finished work and every
   deadline out to next winter, all in one column. The fix is a window the user
   sets once — how far back and how far ahead — applied to the board, list,
   Eisenhower and Gantt views, which are the ones with no date axis of their own
   to scroll (Schedule and Calendar already ARE a date axis, so they are left
   alone).

   Two rules keep it from ever hiding work you still owe:

   1. A task with no date at all is the backlog, not old data. It is never
      windowed out — otherwise "show me the last 3 days" would silently empty
      the board of everything not yet scheduled.
   2. A tree is kept whole. A root stays visible when ANY task in its subtree
      falls inside the window, which is how an imported project with one due
      subtask this week keeps its parent (and the rest of its plan) on screen. */

import { startOfDay } from "./dates";
import { repeatOccursInRange } from "./mdTasks";
import { childIndex, subtreeIds } from "./taskTree";
import type { Settings, Task } from "./types";

const DAY = 86_400_000;

/** One span the picker offers. `days: null` is "no limit in this direction". */
export interface RangeOption {
  id: string;
  label: string;
  days: number | null;
}

/** Shortest first, ending in "Everything" — the app's default, because an
    upgrade must never make work the user is relying on disappear. */
export const RANGE_OPTIONS: readonly RangeOption[] = [
  { id: "3d", label: "3 days", days: 3 },
  { id: "1w", label: "1 week", days: 7 },
  { id: "2w", label: "2 weeks", days: 14 },
  { id: "1m", label: "1 month", days: 30 },
  { id: "2m", label: "2 months", days: 61 },
  { id: "3m", label: "3 months", days: 92 },
  { id: "6m", label: "6 months", days: 183 },
  { id: "1y", label: "1 year", days: 365 },
  { id: "all", label: "Everything", days: null },
];

/** How far either side of today a board reaches, in days. `null` = no limit. */
export interface TaskWindow {
  pastDays: number | null;
  futureDays: number | null;
}

export const UNLIMITED_WINDOW: TaskWindow = { pastDays: null, futureDays: null };

/** The option matching a day count, for driving the picker's active chip. */
export function rangeOptionFor(days: number | null): RangeOption {
  return RANGE_OPTIONS.find((o) => o.days === days) ?? RANGE_OPTIONS[RANGE_OPTIONS.length - 1];
}

/** The window a vault is configured for. Absent settings mean "everything",
    so a vault saved before this existed behaves exactly as it did. */
export function taskWindowOf(settings: Pick<Settings, "taskWindow">): TaskWindow {
  const w = settings.taskWindow;
  if (!w) return UNLIMITED_WINDOW;
  return {
    pastDays: typeof w.pastDays === "number" && w.pastDays >= 0 ? w.pastDays : null,
    futureDays: typeof w.futureDays === "number" && w.futureDays >= 0 ? w.futureDays : null,
  };
}

export interface WindowBounds {
  start: number;
  end: number;
}

/** Whole local days: "3 days back" includes all of the day three days ago, and
    "3 days ahead" includes all of the day three days from now. */
export function taskWindowBounds(window: TaskWindow, now: number): WindowBounds {
  const today = startOfDay(now);
  return {
    start: window.pastDays === null ? -Infinity : today - window.pastDays * DAY,
    end: window.futureDays === null ? Infinity : today + (window.futureDays + 1) * DAY - 1,
  };
}

/** True when a window lets everything through — the cue to skip the filter
    entirely rather than walk every tree for nothing. */
export function isUnlimited(window: TaskWindow): boolean {
  return window.pastDays === null && window.futureDays === null;
}

/** The moment a task belongs to: when it is planned, else when it is owed,
    else when it was finished. Never `createdAt` — that would date the entire
    backlog to the day it was typed in and window it away. */
export function taskAnchor(task: Task): number | undefined {
  const anchor = task.scheduledAt ?? task.deadline ?? task.completedAt;
  return anchor !== undefined && Number.isFinite(anchor) ? anchor : undefined;
}

/** A single task's own verdict — undated tasks always pass (rule 1). */
export function taskInWindow(task: Task, bounds: WindowBounds): boolean {
  const anchor = taskAnchor(task);
  if (anchor === undefined) return true;
  // A routine's anchor is only where the series STARTS; an old anchor still
  // produces occurrences later. Show it when the series actually lands an
  // occurrence inside the window — otherwise a yearly birthday or monthly
  // bill sits on every board all year regardless of the window.
  if (task.repeat) {
    if (bounds.end === Infinity) return true;
    const from = bounds.start === -Infinity ? anchor : bounds.start;
    return repeatOccursInRange(anchor, task.repeat, from, bounds.end);
  }
  return anchor >= bounds.start && anchor <= bounds.end;
}

/** Filter `roots` to the trees with anything inside the window; `ids` is the
    union of the kept subtrees, for views that walk the tree themselves (Gantt).
    `ids` is null when nothing was filtered, matching `searchTaskTree`. */
export function filterTaskWindow(
  roots: readonly Task[],
  all: readonly Task[],
  window: TaskWindow,
  now: number,
): { roots: Task[]; ids: Set<string> | null } {
  if (isUnlimited(window)) return { roots: [...roots], ids: null };

  const bounds = taskWindowBounds(window, now);
  const idx = childIndex(all);
  const byId = new Map(all.map((t) => [t.id, t]));
  const kept: Task[] = [];
  const ids = new Set<string>();

  for (const root of roots) {
    const subtree = subtreeIds(idx, root.id);
    let hit = false;
    for (const id of subtree) {
      const t = byId.get(id);
      if (t && taskInWindow(t, bounds)) { hit = true; break; }
    }
    if (!hit) continue;
    kept.push(root);
    for (const id of subtree) ids.add(id);
  }
  return { roots: kept, ids };
}

/** "Last 1 month · next 2 weeks", or "Everything" — the settings summary and
    the board's own hint line. */
export function windowLabel(window: TaskWindow): string {
  if (isUnlimited(window)) return "Everything";
  const past = window.pastDays === null ? "all history" : `last ${rangeOptionFor(window.pastDays).label}`;
  const future = window.futureDays === null ? "everything ahead" : `next ${rangeOptionFor(window.futureDays).label}`;
  return `${past} · ${future}`;
}
