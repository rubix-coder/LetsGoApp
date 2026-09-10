// Per-day status for routines (repeat tasks) — the desktop's occurrenceStatus
// port. A routine is ONE task whose occurrences are computed on read, so its
// single `status` used to hit every day at once: marking today done struck
// through every future card. These helpers key an independent status to each
// local calendar day; a day with no recorded mark is pending, so every
// occurrence starts fresh regardless of the template's own status.

import type { Task, TaskStatus } from "./types";

/** Local "YYYY-MM-DD" for a timestamp — any time within a day maps to the
    same occurrence key. */
export function occurrenceDateKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The status of a routine's occurrence on the given day: its own recorded
    mark, else pending. */
export function occurrenceStatusOf(task: Task, dayMs: number): TaskStatus {
  return task.occurrenceStatus?.[occurrenceDateKey(dayMs)] ?? "pending";
}

/** A view copy of a routine with `status` swapped for the given day's own
    status, so boards/lists/day cards render that day's state. Non-repeat
    tasks pass through unchanged — they keep their single shared status.
    Never write a view copy back through upsertTask: the resolved status
    would overwrite the template's. */
export function occurrenceTask(task: Task, dayMs: number): Task {
  return task.repeat ? { ...task, status: occurrenceStatusOf(task, dayMs) } : task;
}

/** Local-midnight ms of every day this task's occurrences were marked done —
    routines never touch `completedAt`, so done-today counts and streaks read
    their completions from here. */
export function occurrenceDoneDays(task: Task): number[] {
  if (!task.occurrenceStatus) return [];
  return Object.entries(task.occurrenceStatus)
    .filter(([, status]) => status === "done")
    .map(([key]) => {
      const [y, m, d] = key.split("-").map(Number);
      return new Date(y, m - 1, d).getTime();
    });
}
