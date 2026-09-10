/* Tasks bound to habits, reflected both ways.

   "Meditate 20 min" is a task on Tuesday's schedule AND a habit you are keeping
   a streak on. Before this it was both, twice: tick it in Habits, then find it
   in Todo and tick it again, and a missed second tick quietly broke a streak
   that was actually kept.

   The binding is many-to-many. A task carries `habitIds`; a habit is equally
   the target of any number of tasks. "Get ready" feeds brush teeth, shampoo
   and clean the bathroom floor; "meal time" feeds whey protein, lunch, snack
   and dinner. It is reflected on BOTH edges — completing the task fills every
   habit's day, and keeping the habits completes the task — so whichever
   surface you happen to be looking at is the one you can use.

   A task with several habits closes only when ALL of them are kept that day.
   ANY would mean "get ready" was finished the moment you brushed your teeth,
   which is not what a checklist means. Partial progress therefore leaves the
   task pending, and un-ticking any one habit reopens it.

   Which DAY a completion lands on is the whole subtlety, and it is answered
   once, here, by `taskHabitDayKey`: never "now", always the day the task itself
   belongs to. Ticking Monday's task on Tuesday morning credits Monday, because
   that is the day the work was for — crediting Tuesday would both lie about
   Monday and inflate Tuesday.

   Everything here is pure and returns new arrays; the reducer applies them in a
   single pass, so the two edges can never bounce a change back and forth. */

import { occurrenceDateKey, occurrenceStatusOf } from "./occurrence";
import { habitTarget } from "./habits";
import { repeatOccursOn } from "./mdTasks";
import { startOfDay } from "./dates";
import type { Habit, Task, TaskStatus } from "./types";

/** The habits a task actually feeds, right now.

    Ids that name a deleted habit are dropped, and so are archived ones: an
    archived habit must never hold a task open forever, and writing to one
    would resurrect a practice the user has retired. The result follows the
    habits' own order, so any UI listing them is stable. */
export function linkedHabits(task: Task, habits: readonly Habit[]): Habit[] {
  const ids = task.habitIds;
  if (!ids?.length) return [];
  return habits.filter((h) => !h.archivedAt && ids.includes(h.id));
}

/** Does this task belong to the local day starting at `dayStart`?

    A routine is resolved by its recurrence rather than its anchor — a daily
    task anchored in January falls on every day since — while anything else
    uses the day `taskHabitDayKey` would credit it to. */
function fallsOn(task: Task, dayStart: number, now: number): boolean {
  if (task.repeat) {
    const anchor = task.scheduledAt ?? task.deadline;
    return anchor !== undefined && repeatOccursOn(anchor, task.repeat, dayStart);
  }
  return taskHabitDayKey(task, now) === occurrenceDateKey(dayStart);
}

/** The linked tasks that are this habit's instances on one particular day.

    Three glasses of water on Tuesday's schedule are three instances of one
    habit, and Wednesday may hold a different number — which is why this is
    asked per day rather than counted once over the whole binding. */
export function tasksForHabitOn(
  tasks: readonly Task[],
  habitId: string,
  dayMs: number,
  now: number,
): Task[] {
  const dayStart = startOfDay(dayMs);
  return tasks.filter((t) => t.habitIds?.includes(habitId) && fallsOn(t, dayStart, now));
}

/** How many ticks the habit needs on `dayMs`.

    Several tasks feeding one habit ARE that day's target: link morning, noon
    and evening water and the day wants three ticks, one per task. One task is
    left alone deliberately — a single task is one whole obligation ("drink
    water", target 8), and deriving the target from it would quietly demote
    that 8 to a 1. Below two, the habit's own `timesPerDay` stands. */
export function habitTargetOn(
  habit: Habit,
  tasks: readonly Task[],
  dayMs: number,
  now: number,
): number {
  const n = tasksForHabitOn(tasks, habit.id, dayMs, now).length;
  return n >= 2 ? n : habitTarget(habit);
}

/** Are ALL the habits this task feeds kept on `dayKey`?

    `null` means the question does not apply — the task feeds nothing live —
    and callers must treat that as "leave the task alone" rather than as
    false, which would reopen every unlinked task on the day. */
export function linkedHabitsDone(
  task: Task,
  habits: readonly Habit[],
  tasks: readonly Task[],
  dayKey: string,
  now: number,
): boolean | null {
  const linked = linkedHabits(task, habits);
  if (linked.length === 0) return null;
  // The same per-day target the other edge writes against — asking a different
  // question here is how a day gets filled and then immediately reopened.
  const dayMs = dayKeyToMs(dayKey);
  let all = true;
  for (const h of linked) {
    const ticks = h.log[dayKey] ?? 0;
    if (ticks >= habitTargetOn(h, tasks, dayMs, now)) continue;
    all = false;
    /* A habit whose target IS its tasks carries no verdict while it is
       part-way: 2/3 says two of the three were done, never which two. Writing
       "not done" back from that reopened every task feeding the habit and threw
       away completions that were real — so a partial tally answers `null`,
       which every caller already reads as "leave the task alone".

       Zero is not partial: nothing was done, and reopening is exactly right.
       Habits counted by hand (eight glasses, one task) still answer false at
       7/8 — that task genuinely is not finished. */
    if (ticks > 0 && tasksForHabitOn(tasks, h.id, dayMs, now).length >= 2) return null;
  }
  return all;
}

/** The local "YYYY-MM-DD" a task's completion should be recorded against.

    A routine occurrence names its own day; anything else uses the day it was
    planned for, falling back to its deadline and finally to the wall clock for
    a task with no date at all. */
export function taskHabitDayKey(task: Task, now: number, occurrenceDay?: number): string {
  if (task.repeat) return occurrenceDateKey(occurrenceDay ?? now);
  return occurrenceDateKey(task.scheduledAt ?? task.deadline ?? now);
}

/** Is this status the "done" edge? `skipped` deliberately is NOT — skipping a
    task is a decision not to do it, and must never award the habit a day. */
function isDone(status: TaskStatus): boolean {
  return status === "done";
}

/** The habits list after `task` moved to `status` on `dayKey`.

    Completing fills EVERY linked habit's day to its target in one move (a
    task is one whole obligation, not one of eight glasses of water), which is
    the point of the many-to-many binding: ticking "get ready" marks the whole
    morning checklist. Un-completing clears them again. Habits the task is not
    bound to come back untouched and identical, so a reducer can return the
    result unconditionally. */
export function applyTaskStatusToHabits(
  habits: readonly Habit[],
  tasks: readonly Task[],
  task: Task,
  status: TaskStatus,
  dayKey: string,
  now: number,
): Habit[] {
  const ids = task.habitIds;
  if (!ids?.length) return habits as Habit[];
  const dayMs = dayKeyToMs(dayKey);
  /* `task` is the task as it was BEFORE this status write, so the move across
     the done boundary is the thing that counts — not the new status on its
     own. Re-saving an already-finished task must not tick the habit twice, and
     the reducer calls this on every status write, idempotent or not. */
  const wasDone = isDone(task.repeat ? occurrenceStatusOf(task, dayMs) : task.status);
  const nowDone = isDone(status);
  return habits.map((h) => {
    if (!ids.includes(h.id) || h.archivedAt) return h;
    const target = habitTargetOn(h, tasks, dayMs, now);
    const current = h.log[dayKey] ?? 0;
    /* One task is the whole obligation and fills the day outright; two or more
       are instances of it, and each one moves the tally a single step. */
    const perTask = tasksForHabitOn(tasks, h.id, dayMs, now).length >= 2;
    let wanted: number;
    if (perTask) {
      if (wasDone === nowDone) return h;
      wanted = Math.max(0, Math.min(target, current + (nowDone ? 1 : -1)));
    } else {
      wanted = nowDone ? target : 0;
    }
    if (current === wanted) return h;
    const log = { ...h.log };
    if (wanted === 0) delete log[dayKey];
    else log[dayKey] = wanted;
    return { ...h, log };
  });
}

/** The tasks list after the habits for `dayKey` changed.

    Recomputed from the WHOLE habits list rather than from the one habit that
    was ticked, because a task now waits on several of them: knowing that
    "shampoo" was kept says nothing on its own about whether "get ready" is
    finished. Only tasks belonging to that same day move, so completing
    Tuesday's habit never reaches back and closes Monday's task. A routine
    records the change as a per-day occurrence override, exactly as the Todo
    screen would; a one-off moves its own status.

    Tasks already in the wanted state are returned identical — this is what
    stops the two edges from chasing each other. */
export function applyHabitDayToTasks(
  tasks: readonly Task[],
  habits: readonly Habit[],
  dayKey: string,
  now: number,
): Task[] {
  return tasks.map((t) => {
    const done = linkedHabitsDone(t, habits, tasks, dayKey, now);
    if (done === null) return t;
    const wanted: TaskStatus = done ? "done" : "pending";
    if (taskHabitDayKey(t, now, dayKeyToMs(dayKey)) !== dayKey) return t;

    if (t.repeat) {
      if ((t.occurrenceStatus?.[dayKey] ?? "pending") === wanted) return t;
      return { ...t, occurrenceStatus: { ...t.occurrenceStatus, [dayKey]: wanted } };
    }
    if (t.status === wanted) return t;
    return { ...t, status: wanted, completedAt: done ? now : undefined };
  });
}

/** "2026-08-29" → local noon of that day. Noon, not midnight, so the value
    survives a DST transition without sliding into the previous day. */
export function dayKeyToMs(dayKey: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) return Date.now();
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0).getTime();
}

/** Tasks bound to a habit, for the habit editor's "linked tasks" list. A task
    feeding several habits appears under each of them. */
export function tasksForHabit(tasks: readonly Task[], habitId: string): Task[] {
  return tasks.filter((t) => t.habitIds?.includes(habitId));
}
