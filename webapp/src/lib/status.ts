/* Task-status helpers shared by every surface that shows or changes a status.

   "paused" is a hold on started work: the clock is frozen but the elapsed time
   is kept (lib/store.tsx timer wiring). It is NOT a step in the click-cycle —
   you reach it from the timer's pause button or a Pause control, and one click
   on a paused status square resumes it. */

import type { TaskStatus } from "./types";

/** The four board columns — every status except the paused overlay. */
export type ColumnStatus = Exclude<TaskStatus, "paused">;

/** The 4-state click-cycle, unchanged. */
const CYCLE: TaskStatus[] = ["in_progress", "done", "skipped", "pending"];

/** What a click on the status square does next. A paused task resumes to
    in-progress; everything else walks the 4-state cycle. */
export function nextStatus(current: TaskStatus): TaskStatus {
  if (current === "paused") return "in_progress";
  const i = CYCLE.indexOf(current);
  return CYCLE[(i + 1) % CYCLE.length];
}

/** Which board lane a status belongs to. Paused folds into In progress — the
    board stays four columns, paused cards just look different. */
export function boardStatus(status: TaskStatus): ColumnStatus {
  return status === "paused" ? "in_progress" : status;
}

/** Started work, active or on hold — the timer can be attached to it. */
export function isRunningLike(status: TaskStatus): boolean {
  return status === "in_progress" || status === "paused";
}
