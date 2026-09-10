// Pure timeline math for the Gantt board lens. The span rule is the whole
// point: [earliest task date-time, farthest deadline] padded a day each side
// and always containing today, so the axis is one scrollable big picture
// instead of a fixed week.

import { addDays, startOfDay } from "./dates";
import { repeatOccursOn } from "./mdTasks";
import { STATUS_LABEL, type Repeat, type TaskStatus } from "./types";

const DAY = 86_400_000;
const MIN_SPAN_DAYS = 14;

export interface GanttWindow {
  start: number;
  end: number;
  /** Deadline-only tasks render as a point marker, not a bar. */
  milestone: boolean;
}

/**
 * A task's slot on the timeline: a scheduled task runs from scheduledAt to
 * its deadline (or its estimate — floored at 30 min — when the deadline is
 * missing or earlier); a deadline-only task collapses to a milestone at the
 * deadline. Null when the task carries neither.
 */
export function taskGanttWindow(t: { scheduledAt?: number; deadline?: number; estimateMin?: number }): GanttWindow | null {
  if (t.scheduledAt !== undefined) {
    const estimateEnd = t.scheduledAt + Math.max(30, t.estimateMin ?? 60) * 60_000;
    return { start: t.scheduledAt, end: Math.max(estimateEnd, t.deadline ?? estimateEnd), milestone: false };
  }
  if (t.deadline !== undefined) return { start: t.deadline, end: t.deadline, milestone: true };
  return null;
}

/**
 * Whole-day axis span covering every window plus today, padded one day on
 * each side, never narrower than MIN_SPAN_DAYS.
 */
export function ganttSpan(windows: { start: number; end: number }[], now: number): { start: number; days: number } {
  const todayStart = startOfDay(now);
  let min = todayStart;
  let max = todayStart;
  for (const w of windows) {
    min = Math.min(min, w.start);
    max = Math.max(max, w.end);
  }
  const start = addDays(startOfDay(min), -1);
  return { start, days: Math.max(MIN_SPAN_DAYS, Math.round((startOfDay(max) - start) / DAY) + 2) };
}

/**
 * Day-start ms of every occurrence of a routine inside [spanStart, spanEnd).
 * Routines render as one per-day slice per occurrence (each tinted by that
 * day's own status) instead of a single template-colored bar.
 */
export function routineDaysInSpan(anchor: number, repeat: Repeat, spanStart: number, spanEndMs: number): number[] {
  const days: number[] = [];
  for (let d = startOfDay(spanStart); d < spanEndMs; d = addDays(d, 1)) {
    if (repeatOccursOn(anchor, repeat, d)) days.push(d);
  }
  return days;
}

/**
 * Guard for creating the dependency "`toId` starts after `fromId`": rejects
 * self-links, unknown ids, duplicates, and anything that would close a cycle
 * (i.e. `fromId` already depends — transitively — on `toId`).
 */
export function canDepend(
  tasks: readonly { id: string; dependsOn?: string[] }[],
  fromId: string,
  toId: string,
): boolean {
  if (fromId === toId) return false;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  if (!byId.has(fromId) || !byId.has(toId)) return false;
  if (byId.get(toId)!.dependsOn?.includes(fromId)) return false;
  const seen = new Set<string>();
  const stack = [fromId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === toId) return false;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) stack.push(dep);
  }
  return true;
}

/** Grouped presets on top of the plain timeline (monday.com-style lenses):
 * bug-tracker rows by status, urgency rows by priority, channel/phase rows
 * by first tag. */
export type GanttPreset = "timeline" | "status" | "priority" | "tag";

const STATUS_ORDER: TaskStatus[] = ["in_progress", "paused", "pending", "done", "skipped"];
/** Priority group names reuse the Eisenhower quadrant language. */
const PRIORITY_LABEL = ["P0 · Do first", "P1 · Schedule", "P2 · Delegate", "P3 · Eliminate"];

export interface GanttGroup<T> {
  key: string;
  label: string;
  tasks: T[];
}

/**
 * Grouped presets flatten the task tree — each task stands alone, since a
 * child can sit in a different group than its parent. Status groups follow
 * the board's column order, priorities run P0→P3, tags sort alphabetically
 * by each task's first tag with untagged last. Empty groups are dropped.
 */
export function groupGanttTasks<T extends { status: TaskStatus; priority: number; tags: string[] }>(
  tasks: T[],
  preset: "status" | "priority" | "tag",
): GanttGroup<T>[] {
  if (preset === "status") {
    return STATUS_ORDER
      .map((s) => ({ key: s, label: STATUS_LABEL[s], tasks: tasks.filter((t) => t.status === s) }))
      .filter((g) => g.tasks.length > 0);
  }
  if (preset === "priority") {
    return [0, 1, 2, 3]
      .map((p) => ({ key: `p${p}`, label: PRIORITY_LABEL[p], tasks: tasks.filter((t) => t.priority === p) }))
      .filter((g) => g.tasks.length > 0);
  }
  const names = [...new Set(tasks.filter((t) => t.tags.length > 0).map((t) => t.tags[0]))].sort();
  const groups = names.map((name) => ({ key: `#${name}`, label: `#${name}`, tasks: tasks.filter((t) => t.tags[0] === name) }));
  const untagged = tasks.filter((t) => t.tags.length === 0);
  if (untagged.length > 0) groups.push({ key: "untagged", label: "No tag", tasks: untagged });
  return groups;
}
