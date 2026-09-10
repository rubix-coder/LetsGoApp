/* Estimate-driven auto-scheduling, ported from the desktop app
   (plugins/corePlugins/todoPlugin/frontend/estimateSchedule.ts). Given one
   anchor start on a subtree's root, every task under it lays out
   back-to-back in depth-first order: a leaf occupies exactly its own
   estimate; a parent's window is the span of its children. When a work-hours
   window is supplied, leaves are confined to it and a leaf that would cross
   the closing time rolls whole to the next day's opening time. */

import type { Task } from "./types";
import { addDays, startOfDay } from "./dates";
import { childIndex, subtreeIds } from "./taskTree";

export const DEFAULT_ESTIMATE_MINUTES = 60;

const MIN = 60_000;

const taskEnd = (t: Task): number => (t.scheduledAt ?? 0) + (t.estimateMin ?? DEFAULT_ESTIMATE_MINUTES) * MIN;

/** The locked tasks that act as immovable anchors right now: scheduled, still
    live (a finished appointment blocks nothing) and — when packing around one
    particular task — never the task being placed itself. */
export function lockedAnchors(tasks: readonly Task[], excludeId?: string): Task[] {
  return tasks.filter(
    (t) => t.locked && t.id !== excludeId && t.scheduledAt !== undefined && t.status !== "done" && t.status !== "skipped",
  );
}

/** Where a block of work can actually go, and what pushed it there. */
export interface Placement {
  start: number;
  /** The locked task that pushed this block later, when one did. */
  blockedBy?: Task;
  /** End of the locked run that had to clear (before the break). */
  blockedUntil?: number;
}

/** Slide `proposedStart` forward until a block of `estimateMin` both fits the
    work window and clears every locked anchor by `breakMin` on BOTH sides.

    The two-sided gap is the point: a packed task that merely ABUTS a locked
    appointment (ends 11:00 sharp against an 11:00 lock) leaves no room to
    travel, wrap up or overrun, so it is moved after the lock instead. Anchors
    are cleared in one hop per pass — jumping past the last-ending lock that
    overlaps the slot — so a stack of back-to-back appointments settles in a
    few iterations rather than one per lock. */
export function placeAvoidingLocked(
  proposedStart: number,
  estimateMin: number,
  anchors: readonly Task[],
  breakMin = 0,
  win?: WorkWindow,
): Placement {
  const dur = estimateMin * MIN;
  const gap = breakMin * MIN;
  let start = proposedStart;
  let blockedBy: Task | undefined;
  let blockedUntil: number | undefined;

  for (let guard = 0; guard < 16; guard++) {
    const snapped = win ? snapIntoWindow(start, estimateMin, win) : start;
    if (snapped !== start) { start = snapped; continue; }
    let latestEnd = -Infinity;
    let hit: Task | undefined;
    for (const anchor of anchors) {
      if (anchor.scheduledAt === undefined) continue;
      const end = taskEnd(anchor);
      // Widen the anchor by the break on both sides: the slot must sit wholly
      // before (start + dur <= anchorStart - gap) or wholly after it.
      if (anchor.scheduledAt - gap < start + dur && end + gap > start && end > latestEnd) {
        latestEnd = end;
        hit = anchor;
      }
    }
    if (!hit) break;
    blockedBy = hit;
    blockedUntil = latestEnd;
    start = latestEnd + gap;
  }
  return { start, blockedBy, blockedUntil };
}

/** The daily window auto-scheduled tasks are confined to. Minutes from local
    midnight; a leaf that would cross `endMin` rolls to the next day. */
export interface WorkWindow {
  startMin: number;
  endMin: number;
}

/** Slide `startMs` forward until a block of `estimateMin` fits inside the work
    window: lift a pre-opening start up to opening, and roll whole to the next
    day's opening if the block would cross closing. A block longer than the
    window itself can't fit anywhere, so it's placed as-is (allowed to run
    past closing) rather than looping forever. */
export function snapIntoWindow(startMs: number, estimateMin: number, win: WorkWindow): number {
  const windowMs = (win.endMin - win.startMin) * MIN;
  if (windowMs <= 0) return startMs; // misconfigured window — no-op
  const durMs = estimateMin * MIN;
  let cursor = startMs;
  for (let guard = 0; guard < 4; guard++) {
    const day = startOfDay(cursor);
    const open = day + win.startMin * MIN;
    const close = day + win.endMin * MIN;
    const nextOpen = startOfDay(addDays(cursor, 1)) + win.startMin * MIN;
    if (cursor < open) { cursor = open; continue; }
    if (cursor >= close) { cursor = nextOpen; continue; }
    if (durMs <= windowMs && cursor + durMs > close) { cursor = nextOpen; continue; }
    break;
  }
  return cursor;
}

/** Breathing room inserted between two consecutive packed tasks. Applied
    BETWEEN neighbours only — never before the first task or after the last —
    so a subtree's span stays exactly its work plus its internal gaps. */
export function packSubtree(
  allTasks: readonly Task[],
  rootId: string,
  anchorStartMs: number,
  win?: WorkWindow,
  breakMin = 0,
): Map<string, { start: number; end: number }> {
  const childrenByParent = new Map<string, Task[]>();
  for (const task of allTasks) {
    if (task.parentId) {
      const siblings = childrenByParent.get(task.parentId) ?? [];
      siblings.push(task);
      childrenByParent.set(task.parentId, siblings);
    }
  }
  // Array order is creation order — the webapp's DFS/sort order.
  const taskById = new Map(allTasks.map((t) => [t.id, t]));
  const anchors = lockedAnchors(allTasks);
  const result = new Map<string, { start: number; end: number }>();

  function layout(taskId: string, proposedStartMs: number): { start: number; end: number } {
    const children = childrenByParent.get(taskId) ?? [];
    if (children.length === 0) {
      const self = taskById.get(taskId);
      const estimate = self?.estimateMin ?? DEFAULT_ESTIMATE_MINUTES;
      // A locked leaf inside the tree is an anchor like any other: it keeps its
      // own slot and its siblings flow around it.
      if (self?.locked && self.scheduledAt !== undefined) {
        const fixed = { start: self.scheduledAt, end: self.scheduledAt + estimate * MIN };
        result.set(taskId, fixed);
        return fixed;
      }
      const start = placeAvoidingLocked(proposedStartMs, estimate, anchors, breakMin, win).start;
      const end = start + estimate * MIN;
      result.set(taskId, { start, end });
      return { start, end };
    }
    // A parent starts where its first child actually lands (which the window
    // may have pushed past the proposed start) and ends at the last child's end
    // — the trailing break is deliberately NOT included, so a parent's span
    // covers work and internal gaps only.
    let cursor = proposedStartMs;
    let firstStart: number | undefined;
    for (const child of children) {
      const w = layout(child.id, firstStart === undefined ? cursor : cursor + breakMin * MIN);
      if (firstStart === undefined) firstStart = w.start;
      cursor = w.end;
    }
    const start = firstStart ?? proposedStartMs;
    result.set(taskId, { start, end: cursor });
    return { start, end: cursor };
  }

  layout(rootId, anchorStartMs);
  return result;
}

export function rootAncestorId(allTasks: readonly Task[], taskId: string): string {
  const taskById = new Map(allTasks.map((t) => [t.id, t]));
  let cursor = taskById.get(taskId);
  while (cursor?.parentId) {
    const parent = taskById.get(cursor.parentId);
    if (!parent) break;
    cursor = parent;
  }
  return cursor ? cursor.id : taskId;
}

/** Recompute every ancestor window in a tree as the span of its scheduled
    children (leaves keep their own start/estimate). Used after a partial move
    so parents stay in sync without re-packing the whole subtree. */
export function rollUpParents(tasks: Task[], rootId: string): Task[] {
  const childrenByParent = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.parentId) {
      const siblings = childrenByParent.get(t.parentId) ?? [];
      siblings.push(t);
      childrenByParent.set(t.parentId, siblings);
    }
  }
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const win = new Map<string, { start: number; end: number }>();

  function visit(id: string): { start: number; end: number } | null {
    const t = byId.get(id);
    if (!t) return null;
    const kids = childrenByParent.get(id) ?? [];
    if (kids.length === 0) {
      if (t.scheduledAt === undefined) return null;
      return { start: t.scheduledAt, end: t.scheduledAt + (t.estimateMin ?? DEFAULT_ESTIMATE_MINUTES) * MIN };
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (const k of kids) {
      const w = visit(k.id);
      if (w) { lo = Math.min(lo, w.start); hi = Math.max(hi, w.end); }
    }
    if (lo === Infinity) return null;
    win.set(id, { start: lo, end: hi });
    return { start: lo, end: hi };
  }

  visit(rootId);
  return tasks.map((t) => {
    const w = win.get(t.id);
    return w ? { ...t, scheduledAt: w.start, estimateMin: Math.round((w.end - w.start) / MIN) } : t;
  });
}

/** Divide & conquer: re-lay-out a dragged leaf subtask and every task after it
    in its tree from the drop point, packing back-to-back within the work-hours
    window. Tasks before it in the pack order — and any completed task — stay
    exactly where they are. Returns null when `draggedId` is a root or a parent
    (those keep the whole-tree shift path). The dragged task keeps its literal
    drop time; the ones that follow flow within the window. */
export function reflowFrom(
  tasks: Task[],
  draggedId: string,
  dropAt: number,
  win?: WorkWindow,
  breakMin = 0,
): Task[] | null {
  const dragged = tasks.find((t) => t.id === draggedId);
  if (!dragged || !dragged.parentId) return null;            // roots use the shift path
  const kids = childIndex(tasks);
  if (kids.has(draggedId)) return null;                      // only leaves reflow
  const rootId = rootAncestorId(tasks, draggedId);
  const inTree = subtreeIds(kids, rootId);
  const leaves = tasks.filter((t) => inTree.has(t.id) && !kids.has(t.id));
  const idx = leaves.findIndex((t) => t.id === draggedId);
  if (idx < 0) return null;

  const anchors = lockedAnchors(tasks, draggedId);
  const placed = new Map<string, number>();
  let cursor = dropAt;
  for (let i = idx; i < leaves.length; i++) {
    const leaf = leaves[i];
    if (leaf.status === "done") continue; // a finished task is a fixed anchor
    const est = leaf.estimateMin ?? DEFAULT_ESTIMATE_MINUTES;
    // The dragged leaf keeps its literal drop time — bar a locked appointment
    // sitting there, which no placement may overlap; everything after it flows
    // on with a break between neighbours, inside the work window.
    const after = cursor + breakMin * MIN;
    const start = i === idx
      ? placeAvoidingLocked(dropAt, est, anchors, breakMin).start
      : placeAvoidingLocked(after, est, anchors, breakMin, win).start;
    placed.set(leaf.id, start);
    cursor = start + est * MIN;
  }
  const moved = tasks.map((t) => (placed.has(t.id) ? { ...t, scheduledAt: placed.get(t.id)! } : t));
  return rollUpParents(moved, rootId);
}

/** Where a late-started task should actually land, and what (if anything)
    stopped it landing on "right now". */
export interface LateStartPlan {
  startAt: number;
  /** The locked task occupying the current slot, when one pushed us later. */
  blockedBy?: Task;
  /** End of the locked run we had to clear (before the break). */
  blockedUntil?: number;
}

/** You scheduled a task for 10:00, an emergency ate the morning, and at 13:00
    you finally mark it in progress: it should start NOW, not sit in the past.

    Returns the slot to move it to, or null when there is nothing to do (the
    task is not late, not scheduled, or is itself locked). Locked tasks are
    immovable anchors, so a locked task already sitting on "now" pushes this one
    past it plus a break — repeatedly, for a chain of locked tasks — and the
    plan reports which one did it so the UI can explain the jump. */
export function planLateStart(
  tasks: readonly Task[],
  taskId: string,
  now: number,
  breakMin = 0,
  win?: WorkWindow,
): LateStartPlan | null {
  const target = tasks.find((t) => t.id === taskId);
  if (!target || target.locked || target.scheduledAt === undefined) return null;
  // Only ever pull a task FORWARD to now — a task that has not started yet
  // keeps its plan.
  if (target.scheduledAt >= now) return null;

  const placed = placeAvoidingLocked(
    now,
    target.estimateMin ?? DEFAULT_ESTIMATE_MINUTES,
    lockedAnchors(tasks, taskId),
    breakMin,
    win,
  );
  if (placed.start === target.scheduledAt) return null;
  // Starting a task is an assertion about NOW. When the first conflict-free
  // slot sits on a later day — locked blocks wall off the rest of today
  // (a fully locked routine day ending in an overnight sleep), or the work
  // window has already shut — moving the card there would show tomorrow's
  // slot as active with today's timer running. Leave the plan untouched.
  if (startOfDay(placed.start) !== startOfDay(now)) return null;
  return { startAt: placed.start, blockedBy: placed.blockedBy, blockedUntil: placed.blockedUntil };
}

/** The day re-packed from a chosen starting time. */
export interface DayStartPlan {
  /** The full task list with the day's moves applied. */
  tasks: Task[];
  /** How many tasks actually changed slot. */
  movedCount: number;
  /** The first locked appointment the re-pack had to work around. */
  blockedBy?: Task;
}

/** You wake at 5, open the app at 9, and the tasks you planned for 7:00 are
    still sitting in the past dragging the whole day out of date. Told when the
    day really starts, re-pack today's remaining UNLOCKED work from there — in
    the order it was planned, back-to-back with the break between neighbours,
    inside the work window and clear of every locked appointment.

    Locked tasks, routines (whose `scheduledAt` is a recurrence anchor, not an
    appointment), finished work and other days are all left untouched. Parents
    are not placed directly: their leaves are, and each affected tree's parent
    windows roll up to match. Returns null when nothing needed to move. */
export function planDayStart(
  tasks: readonly Task[],
  fromMs: number,
  breakMin = 0,
  win?: WorkWindow,
): DayStartPlan | null {
  const day = startOfDay(fromMs);
  const kids = childIndex(tasks);
  const anchors = lockedAnchors(tasks);

  const movable = tasks
    .map((task, order) => ({ task, order }))
    .filter(({ task }) =>
      task.scheduledAt !== undefined
      && startOfDay(task.scheduledAt) === day
      && !task.locked
      && !task.repeat
      && task.status !== "done"
      && task.status !== "skipped"
      && !kids.has(task.id))
    .sort((a, b) => a.task.scheduledAt! - b.task.scheduledAt! || a.order - b.order);
  if (movable.length === 0) return null;

  const placed = new Map<string, number>();
  let blockedBy: Task | undefined;
  let cursor = fromMs;
  for (const { task } of movable) {
    const estimate = task.estimateMin ?? DEFAULT_ESTIMATE_MINUTES;
    const slot = placeAvoidingLocked(cursor, estimate, anchors, breakMin, win);
    blockedBy ??= slot.blockedBy;
    placed.set(task.id, slot.start);
    cursor = slot.start + (estimate + breakMin) * MIN;
  }

  const movedCount = movable.filter(({ task }) => placed.get(task.id) !== task.scheduledAt).length;
  if (movedCount === 0) return null;

  let next = tasks.map((t) => (placed.has(t.id) ? { ...t, scheduledAt: placed.get(t.id)! } : t));
  for (const root of new Set([...placed.keys()].map((id) => rootAncestorId(tasks, id)))) {
    next = rollUpParents(next, root);
  }
  return { tasks: next, movedCount, blockedBy };
}

/** Why a day-start answer did or did not move anything.

    The prompt used to show only "N tasks would move" and grey out its confirm
    button when the plan came back null — so a day whose tasks are ALL locked
    (a day of appointments, which is precisely a day you might start late) had
    no way to answer the question at all. The answer is always accepted now;
    this says what happened to it. */
export type DayStartOutcome =
  | { kind: "repacked"; plan: DayStartPlan }
  /** Nothing is scheduled for today, so there is nothing to re-pack. */
  | { kind: "empty" }
  /** Everything left today is a locked appointment or a routine — both stay
      put by contract, so the start time is recorded and nothing moves. */
  | { kind: "pinned"; locked: Task[]; routines: Task[] }
  /** There is movable work, and it already sits from this time onward. */
  | { kind: "alreadyFits" };

/** `planDayStart` plus the reason when it comes back empty-handed. */
export function planDayStartOutcome(
  tasks: readonly Task[],
  fromMs: number,
  breakMin = 0,
  win?: WorkWindow,
): DayStartOutcome {
  const plan = planDayStart(tasks, fromMs, breakMin, win);
  if (plan) return { kind: "repacked", plan };

  const day = startOfDay(fromMs);
  const kids = childIndex(tasks);
  const todays = tasks.filter(
    (t) =>
      t.scheduledAt !== undefined
      && startOfDay(t.scheduledAt) === day
      && t.status !== "done"
      && t.status !== "skipped"
      && !kids.has(t.id),
  );
  if (todays.length === 0) return { kind: "empty" };

  const locked = todays.filter((t) => t.locked);
  const routines = todays.filter((t) => !t.locked && t.repeat);
  if (locked.length + routines.length === todays.length) return { kind: "pinned", locked, routines };
  return { kind: "alreadyFits" };
}

/** Live re-pack: write the packed windows back onto the tasks. Leaves keep
    their own estimates; a parent's stored window becomes the derived span
    (its own estimate is ignored by design). No-op unless the root has an
    anchor start and actually owns children. */
export function applyEstimatePack(tasks: Task[], changedTaskId: string, win?: WorkWindow, breakMin = 0): Task[] {
  const rootId = rootAncestorId(tasks, changedTaskId);
  const root = tasks.find((t) => t.id === rootId);
  if (!root?.scheduledAt) return tasks;
  if (!tasks.some((t) => t.parentId === rootId)) return tasks;
  const packed = packSubtree(tasks, rootId, root.scheduledAt, win, breakMin);
  return tasks.map((t) => {
    const window = packed.get(t.id);
    if (!window) return t;
    const isParent = tasks.some((x) => x.parentId === t.id);
    return {
      ...t,
      scheduledAt: window.start,
      estimateMin: isParent ? Math.round((window.end - window.start) / MIN) : t.estimateMin,
    };
  });
}
