// @vitest-environment node
/* Tasks bound to habits, reflected both ways. The things under test are WHICH
   DAY a completion lands on, the many-to-many binding ("get ready" feeds brush
   teeth AND shampoo AND clean the floor), and the guarantee that a reflected
   write never bounces back — both edges must return identical objects once the
   two sides already agree. */
import { describe, expect, it } from "vitest";
import {
  applyHabitDayToTasks, applyTaskStatusToHabits, dayKeyToMs, habitTargetOn, linkedHabits,
  linkedHabitsDone, taskHabitDayKey, tasksForHabit, tasksForHabitOn,
} from "./habitLink";
import type { Habit, Task } from "./types";

const at = (y: number, m: number, d: number, h = 9) => new Date(y, m - 1, d, h, 0, 0, 0).getTime();
const NOW = at(2026, 8, 29, 10);
const DAY = "2026-08-29";

function task(patch: Partial<Task> & Pick<Task, "id">): Task {
  return { title: patch.id, status: "pending", priority: 2, tags: [], createdAt: 0, loggedMin: 0, ...patch };
}
function habit(patch: Partial<Habit> = {}): Habit {
  return { id: "h1", name: "Meditate", createdAt: at(2026, 1, 1), log: {}, ...patch };
}
/** A habit whose day is already at target — i.e. kept. */
const kept = (patch: Partial<Habit> = {}) => habit({ log: { [DAY]: 1 }, ...patch });

describe("taskHabitDayKey", () => {
  it("credits the day the task was PLANNED for, not the day you ticked it", () => {
    // Monday's task, ticked Tuesday morning: Monday is the day that earned it.
    const t = task({ id: "t", scheduledAt: at(2026, 8, 24) });
    expect(taskHabitDayKey(t, at(2026, 8, 25, 8))).toBe("2026-08-24");
  });

  it("falls back to the deadline, then to now, for an undated task", () => {
    expect(taskHabitDayKey(task({ id: "t", deadline: at(2026, 8, 20) }), NOW)).toBe("2026-08-20");
    expect(taskHabitDayKey(task({ id: "t" }), NOW)).toBe(DAY);
  });

  it("uses the occurrence day for a routine, not its recurrence anchor", () => {
    const routine = task({ id: "t", scheduledAt: at(2026, 1, 1), repeat: { interval: 1, unit: "daily" } });
    expect(taskHabitDayKey(routine, NOW, at(2026, 8, 27))).toBe("2026-08-27");
    expect(taskHabitDayKey(routine, NOW)).toBe(DAY);
  });
});

describe("linkedHabits", () => {
  it("resolves the ids a task carries, in the habits' own order", () => {
    const habits = [habit({ id: "h1" }), habit({ id: "h2" }), habit({ id: "h3" })];
    const t = task({ id: "t", habitIds: ["h3", "h1"] });
    expect(linkedHabits(t, habits).map((h) => h.id)).toEqual(["h1", "h3"]);
  });

  it("ignores an id whose habit was deleted, rather than stalling on it", () => {
    expect(linkedHabits(task({ id: "t", habitIds: ["gone"] }), [habit()])).toEqual([]);
  });

  it("ignores archived habits — an archived habit must not hold a task open", () => {
    const habits = [habit({ id: "h1", archivedAt: NOW }), habit({ id: "h2" })];
    expect(linkedHabits(task({ id: "t", habitIds: ["h1", "h2"] }), habits).map((h) => h.id))
      .toEqual(["h2"]);
  });

  it("is empty for an unlinked task", () => {
    expect(linkedHabits(task({ id: "t" }), [habit()])).toEqual([]);
  });
});

describe("linkedHabitsDone", () => {
  /* ALL, not ANY. "Get ready" is not done because you brushed your teeth —
     both of the shapes this feature exists for ("get ready", "meal time")
     read as a checklist that has to be finished. */
  it("is true only when every linked habit is kept that day", () => {
    const habits = [kept({ id: "h1" }), habit({ id: "h2" })];
    const t = task({ id: "t", habitIds: ["h1", "h2"] });
    expect(linkedHabitsDone(t, habits, [t], DAY, NOW)).toBe(false);
    expect(linkedHabitsDone(t, [kept({ id: "h1" }), kept({ id: "h2" })], [t], DAY, NOW)).toBe(true);
  });

  it("counts a multi-times-a-day habit only at its full target", () => {
    const partial = habit({ id: "h1", timesPerDay: 8, log: { [DAY]: 7 } });
    expect(linkedHabitsDone(task({ id: "t", habitIds: ["h1"] }), [partial], [task({ id: "t", habitIds: ["h1"] })], DAY, NOW)).toBe(false);
  });

  it("says nothing at all when the task links to no live habit", () => {
    expect(linkedHabitsDone(task({ id: "t" }), [habit()], [task({ id: "t" })], DAY, NOW)).toBeNull();
    expect(linkedHabitsDone(task({ id: "t", habitIds: ["gone"] }), [habit()], [task({ id: "t", habitIds: ["gone"] })], DAY, NOW)).toBeNull();
  });
});

describe("applyTaskStatusToHabits", () => {
  const bound = task({ id: "t", habitIds: ["h1"], scheduledAt: at(2026, 8, 29) });

  it("fills the habit's whole target in one move when the task completes", () => {
    const out = applyTaskStatusToHabits([habit({ timesPerDay: 8 })], [bound], bound, "done", DAY, NOW);
    expect(out[0].log[DAY]).toBe(8);
  });

  /* The headline of this change: one task, several habits. */
  it("fills EVERY linked habit — one task can close a whole checklist", () => {
    const habits = [habit({ id: "h1" }), habit({ id: "h2" }), habit({ id: "h3" })];
    const getReady = task({ id: "t", habitIds: ["h1", "h2", "h3"], scheduledAt: at(2026, 8, 29) });
    const out = applyTaskStatusToHabits(habits, [getReady], getReady, "done", DAY, NOW);
    expect(out.map((h) => h.log[DAY])).toEqual([1, 1, 1]);
  });

  it("leaves habits the task does not link to untouched", () => {
    const habits = [habit({ id: "h1" }), habit({ id: "h2" })];
    const out = applyTaskStatusToHabits(habits, [task({ id: "t", habitIds: ["h1"] })], task({ id: "t", habitIds: ["h1"] }), "done", DAY, NOW);
    expect(out[1]).toBe(habits[1]);
  });

  it("clears every linked day when the task is reopened", () => {
    const habits = [kept({ id: "h1" }), kept({ id: "h2" })];
    const out = applyTaskStatusToHabits(habits, [task({ id: "t", habitIds: ["h1", "h2"] })], task({ id: "t", habitIds: ["h1", "h2"] }), "pending", DAY, NOW);
    expect(out.map((h) => h.log[DAY])).toEqual([undefined, undefined]);
  });

  it("does NOT award the day for a skipped task — skipping is a decision not to", () => {
    const out = applyTaskStatusToHabits([habit()], [bound], bound, "skipped", DAY, NOW);
    expect(out[0].log[DAY]).toBeUndefined();
  });

  it("leaves an unbound task's habits completely alone", () => {
    const habits = [habit()];
    expect(applyTaskStatusToHabits(habits, [task({ id: "t" })], task({ id: "t" }), "done", DAY, NOW)).toBe(habits);
  });

  it("never writes to an archived habit", () => {
    const h = habit({ archivedAt: NOW });
    expect(applyTaskStatusToHabits([h], [bound], bound, "done", DAY, NOW)[0]).toBe(h);
  });

  it("returns the identical habit when the two sides already agree", () => {
    const h = kept();
    expect(applyTaskStatusToHabits([h], [bound], bound, "done", DAY, NOW)[0]).toBe(h);
  });
});

describe("applyHabitDayToTasks", () => {
  it("completes the bound task belonging to that day", () => {
    const t = task({ id: "t", habitIds: ["h1"], scheduledAt: at(2026, 8, 29) });
    const out = applyHabitDayToTasks([t], [kept()], DAY, NOW);
    expect(out[0].status).toBe("done");
    expect(out[0].completedAt).toBe(NOW);
  });

  /* The other half of many-to-many: a checklist task waits for the whole
     checklist. Ticking three of four habits must NOT close it. */
  it("holds the task open until the last linked habit is kept", () => {
    const t = task({ id: "t", habitIds: ["h1", "h2"], scheduledAt: at(2026, 8, 29) });
    const partway = applyHabitDayToTasks([t], [kept({ id: "h1" }), habit({ id: "h2" })], DAY, NOW);
    expect(partway[0].status).toBe("pending");

    const finished = applyHabitDayToTasks([t], [kept({ id: "h1" }), kept({ id: "h2" })], DAY, NOW);
    expect(finished[0].status).toBe("done");
  });

  it("reopens the task the moment one of its habits is un-ticked", () => {
    const t = task({ id: "t", habitIds: ["h1", "h2"], status: "done", completedAt: NOW, scheduledAt: at(2026, 8, 29) });
    const out = applyHabitDayToTasks([t], [kept({ id: "h1" }), habit({ id: "h2" })], DAY, NOW);
    expect(out[0].status).toBe("pending");
    expect(out[0].completedAt).toBeUndefined();
  });

  it("never reaches back to a task from another day", () => {
    const monday = task({ id: "t", habitIds: ["h1"], scheduledAt: at(2026, 8, 24) });
    expect(applyHabitDayToTasks([monday], [kept()], DAY, NOW)[0]).toBe(monday);
  });

  it("records a routine as a per-day override, leaving the template pending", () => {
    const routine = task({ id: "t", habitIds: ["h1"], scheduledAt: at(2026, 1, 1), repeat: { interval: 1, unit: "daily" } });
    const out = applyHabitDayToTasks([routine], [kept()], DAY, NOW);
    expect(out[0].status).toBe("pending");
    expect(out[0].occurrenceStatus).toEqual({ [DAY]: "done" });
  });

  it("returns identical tasks when they already agree — this is what stops a bounce", () => {
    const t = task({ id: "t", habitIds: ["h1"], status: "done", scheduledAt: at(2026, 8, 29) });
    expect(applyHabitDayToTasks([t], [kept()], DAY, NOW)[0]).toBe(t);
  });

  it("leaves an unlinked task alone", () => {
    const free = task({ id: "t", scheduledAt: at(2026, 8, 29) });
    expect(applyHabitDayToTasks([free], [kept()], DAY, NOW)[0]).toBe(free);
  });

  /* A habit can be deleted while tasks still name it. The task must not be
     stuck "waiting" on something that no longer exists. */
  it("ignores ids whose habit is gone, and completes on the ones that remain", () => {
    const t = task({ id: "t", habitIds: ["h1", "deleted"], scheduledAt: at(2026, 8, 29) });
    expect(applyHabitDayToTasks([t], [kept({ id: "h1" })], DAY, NOW)[0].status).toBe("done");
  });

  it("does not touch a task whose every linked habit has been archived", () => {
    const t = task({ id: "t", habitIds: ["h1"], scheduledAt: at(2026, 8, 29) });
    expect(applyHabitDayToTasks([t], [kept({ archivedAt: NOW })], DAY, NOW)[0]).toBe(t);
  });
});

describe("tasksForHabit", () => {
  it("finds every task naming the habit, whatever else it also links to", () => {
    const tasks = [
      task({ id: "a", habitIds: ["h1"] }),
      task({ id: "b", habitIds: ["h2", "h1"] }),
      task({ id: "c", habitIds: ["h2"] }),
      task({ id: "d" }),
    ];
    expect(tasksForHabit(tasks, "h1").map((t) => t.id)).toEqual(["a", "b"]);
  });
});

describe("round trip", () => {
  it("settles after one pass in both directions", () => {
    const t = task({ id: "t", habitIds: ["h1", "h2"], scheduledAt: at(2026, 8, 29) });
    const habits = [habit({ id: "h1" }), habit({ id: "h2" })];
    // Task → habits fills both; habits → task then finds it already done.
    const filled = applyTaskStatusToHabits(habits, [t], t, "done", DAY, NOW);
    const done = { ...t, status: "done" as const };
    expect(applyHabitDayToTasks([done], filled, DAY, NOW)[0]).toBe(done);
  });
});

describe("dayKeyToMs", () => {
  it("lands on local noon, so a DST shift cannot slide it into the day before", () => {
    expect(new Date(dayKeyToMs("2026-03-29")).getHours()).toBe(12);
    expect(new Date(dayKeyToMs("2026-03-29")).getDate()).toBe(29);
  });
});

/* Many tasks feeding ONE habit — the mirror of the checklist case above. Three
   glasses of water on the schedule are three instances of one habit, so the
   day's target is however many of them fall on that day and each completion
   moves it one step, rather than any one of them closing the whole day. */
describe("tasksForHabitOn", () => {
  const water = (id: string, day: number) => task({ id, habitIds: ["h1"], scheduledAt: at(2026, 8, day) });

  it("counts only the linked tasks that fall on that day", () => {
    const tasks = [water("morning", 29), water("noon", 29), water("evening", 30)];
    expect(tasksForHabitOn(tasks, "h1", at(2026, 8, 29), NOW).map((t) => t.id)).toEqual(["morning", "noon"]);
  });

  it("ignores tasks bound to a different habit", () => {
    const tasks = [water("mine", 29), task({ id: "theirs", habitIds: ["h2"], scheduledAt: at(2026, 8, 29) })];
    expect(tasksForHabitOn(tasks, "h1", at(2026, 8, 29), NOW).map((t) => t.id)).toEqual(["mine"]);
  });

  it("resolves a routine by its recurrence, not by its anchor date", () => {
    // Anchored in January, repeating daily: it falls on the queried day in August.
    const daily = task({ id: "r", habitIds: ["h1"], scheduledAt: at(2026, 1, 1), repeat: { interval: 1, unit: "daily" } });
    expect(tasksForHabitOn([daily], "h1", at(2026, 8, 29), NOW)).toHaveLength(1);
  });

  it("does not count a weekly routine on a day it does not recur", () => {
    const weekly = task({ id: "r", habitIds: ["h1"], scheduledAt: at(2026, 8, 29), repeat: { interval: 1, unit: "weekly" } });
    expect(tasksForHabitOn([weekly], "h1", at(2026, 9, 5), NOW)).toHaveLength(1);
    expect(tasksForHabitOn([weekly], "h1", at(2026, 9, 3), NOW)).toHaveLength(0);
  });

  it("counts an undated task against today, matching taskHabitDayKey", () => {
    const undated = task({ id: "u", habitIds: ["h1"] });
    expect(tasksForHabitOn([undated], "h1", NOW, NOW)).toHaveLength(1);
    expect(tasksForHabitOn([undated], "h1", at(2026, 8, 28), NOW)).toHaveLength(0);
  });
});

describe("habitTargetOn", () => {
  const water = (id: string, day: number) => task({ id, habitIds: ["h1"], scheduledAt: at(2026, 8, day) });

  it("is the number of linked tasks due that day, once there are several", () => {
    const tasks = [water("a", 29), water("b", 29), water("c", 29)];
    expect(habitTargetOn(habit(), tasks, at(2026, 8, 29), NOW)).toBe(3);
  });

  it("keeps the habit's own target when a single task feeds it", () => {
    // The eight-glasses case: one task IS the whole obligation, so linking it
    // must not quietly demote a target of 8 to 1.
    expect(habitTargetOn(habit({ timesPerDay: 8 }), [water("a", 29)], at(2026, 8, 29), NOW)).toBe(8);
  });

  it("keeps the habit's own target on a day no linked task falls on", () => {
    const tasks = [water("a", 29), water("b", 29)];
    expect(habitTargetOn(habit({ timesPerDay: 4 }), tasks, at(2026, 8, 30), NOW)).toBe(4);
  });

  it("is per day — the same habit can want two ticks today and three tomorrow", () => {
    const tasks = [water("a", 29), water("b", 29), water("c", 30), water("d", 30), water("e", 30)];
    expect(habitTargetOn(habit(), tasks, at(2026, 8, 29), NOW)).toBe(2);
    expect(habitTargetOn(habit(), tasks, at(2026, 8, 30), NOW)).toBe(3);
  });
});

describe("applyTaskStatusToHabits with several tasks on one day", () => {
  const water = (id: string, patch: Partial<Task> = {}) =>
    task({ id, habitIds: ["h1"], scheduledAt: at(2026, 8, 29), ...patch });
  const three = [water("morning"), water("noon"), water("evening")];

  it("moves the day ONE step per task rather than closing it outright", () => {
    const out = applyTaskStatusToHabits([habit()], three, three[0], "done", DAY, NOW);
    expect(out[0].log[DAY]).toBe(1);
  });

  it("reaches the target only once every task for the day is done", () => {
    let habits = [habit()];
    habits = applyTaskStatusToHabits(habits, three, three[0], "done", DAY, NOW);
    const afterTwo = applyTaskStatusToHabits(habits, three, three[1], "done", DAY, NOW);
    expect(afterTwo[0].log[DAY]).toBe(2);
    expect(afterTwo[0].log[DAY]).toBeLessThan(habitTargetOn(habit(), three, at(2026, 8, 29), NOW));
  });

  it("gives the tick back when one of them is reopened", () => {
    const habits = [habit({ log: { [DAY]: 2 } })];
    const done = water("noon", { status: "done" });
    const out = applyTaskStatusToHabits(habits, [water("morning"), done, water("evening")], done, "pending", DAY, NOW);
    expect(out[0].log[DAY]).toBe(1);
  });

  /* The reducer hands this the task as it was BEFORE the change, so a status
     write that does not cross the done boundary must not move the tally —
     otherwise re-saving a finished task would tick the habit again and again. */
  it("does not double-count a status write that was already done", () => {
    const habits = [habit({ log: { [DAY]: 1 } })];
    const already = water("morning", { status: "done" });
    const out = applyTaskStatusToHabits(habits, [already, water("noon"), water("evening")], already, "done", DAY, NOW);
    expect(out[0]).toBe(habits[0]);
  });

  it("never pushes the tally past the day's target", () => {
    const habits = [habit({ log: { [DAY]: 3 } })];
    const out = applyTaskStatusToHabits(habits, three, three[2], "done", DAY, NOW);
    expect(out[0].log[DAY]).toBe(3);
  });

  it("still fills the whole target when only one task feeds the habit", () => {
    const one = [water("morning")];
    const out = applyTaskStatusToHabits([habit({ timesPerDay: 8 })], one, one[0], "done", DAY, NOW);
    expect(out[0].log[DAY]).toBe(8);
  });
});

/* The habit -> task edge, once the habit's target comes from its own tasks.

   Reported as "clicking the habit as done wipes my completed tasks": three
   tasks feed one habit, so the day wants three ticks; one tap on the Habits
   screen left it at 1/3, which the edge read as "not done" and pushed back
   onto every task feeding it — reopening them and dropping completedAt on
   work that really had been finished. */
describe("applyHabitDayToTasks with a task-derived target", () => {
  const water = (id: string, patch: Partial<Task> = {}) =>
    task({ id, habitIds: ["h1"], scheduledAt: at(2026, 8, 29), ...patch });

  it("leaves finished tasks alone while the tally is part-way", () => {
    const three = [water("morning", { status: "done", completedAt: NOW }), water("noon"), water("evening")];
    const out = applyHabitDayToTasks(three, [habit({ log: { [DAY]: 2 } })], DAY, NOW);
    expect(out[0].status).toBe("done");
    expect(out[0].completedAt).toBe(NOW);
  });

  it("returns the tasks untouched at a partial tally, so nothing re-renders", () => {
    const three = [water("morning", { status: "done" }), water("noon"), water("evening")];
    expect(applyHabitDayToTasks(three, [habit({ log: { [DAY]: 1 } })], DAY, NOW)[0]).toBe(three[0]);
  });

  it("still completes every task once the tally reaches the target", () => {
    const three = [water("morning"), water("noon"), water("evening")];
    const out = applyHabitDayToTasks(three, [habit({ log: { [DAY]: 3 } })], DAY, NOW);
    expect(out.map((t) => t.status)).toEqual(["done", "done", "done"]);
  });

  it("still reopens them all at a tally of zero — nothing was done", () => {
    const three = [water("morning", { status: "done" }), water("noon", { status: "done" }), water("evening", { status: "done" })];
    const out = applyHabitDayToTasks(three, [habit()], DAY, NOW);
    expect(out.map((t) => t.status)).toEqual(["pending", "pending", "pending"]);
  });

  /* The hand-counted case is deliberately NOT softened: one task feeding a
     habit of eight glasses is not done at seven, and must still reopen. */
  it("keeps reporting a hand-counted habit as unfinished below its target", () => {
    const one = [water("drink")];
    const partial = habit({ timesPerDay: 8, log: { [DAY]: 7 } });
    expect(linkedHabitsDone(one[0], [partial], one, DAY, NOW)).toBe(false);
  });

  it("says nothing when one of several linked habits is part-way on its tasks", () => {
    const three = [water("morning"), water("noon"), water("evening")];
    const t = three[0];
    expect(linkedHabitsDone(t, [habit({ log: { [DAY]: 1 } })], three, DAY, NOW)).toBeNull();
  });
});
