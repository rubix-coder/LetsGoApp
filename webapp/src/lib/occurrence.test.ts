// @vitest-environment node
import { describe, expect, it } from "vitest";
import { newTask, reducer } from "./store";
import { occurrenceDateKey, occurrenceStatusOf, occurrenceTask } from "./occurrence";
import type { AppState, Task } from "./types";

const DAY = 86_400_000;

function base(tasks: Task[]): AppState {
  return {
    tasks,
    blocks: [],
    folders: [],
    notes: [],
    mind: [],
    mindTitle: "map",
    sessions: [],
    books: [],
    habits: [],
    timer: { mode: "pomodoro", baseSec: 0, targetSec: 1500, pomodorosDone: 0 },
    quickTimers: [],
    settings: {
      theme: "light", accent: "violet", density: "cozy", statusColors: true, reduceMotion: false, notifications: false, sounds: false, weekStart: 0, hourFormat: "24",
      workHours: { enabled: false, startMin: 360, endMin: 1260 },
      sync: { enabled: false, url: "/webdav", username: "", password: "" },
      plugins: { todo: true, timer: true, notes: true, mindmap: true, dashboard: true, library: true, habits: true },
      sidebarCollapsed: false, landingView: "todo", todoDefaultView: "last", scheduleReminders: true,
    },
  };
}

const routine = (patch: Partial<Task> = {}): Task =>
  newTask({ id: "r1", title: "Swim", scheduledAt: Date.now(), repeat: { interval: 1, unit: "daily" }, ...patch });

describe("occurrence date key", () => {
  it("maps any time of a local day to the same key", () => {
    const noon = new Date(2026, 6, 21, 12, 0).getTime();
    const night = new Date(2026, 6, 21, 23, 59).getTime();
    expect(occurrenceDateKey(noon)).toBe("2026-07-21");
    expect(occurrenceDateKey(night)).toBe(occurrenceDateKey(noon));
  });
});

describe("occurrence status resolution", () => {
  it("defaults every day to pending, even when the template says done", () => {
    const t = routine({ status: "done" });
    expect(occurrenceStatusOf(t, Date.now())).toBe("pending");
    expect(occurrenceTask(t, Date.now()).status).toBe("pending");
  });

  it("reads only the asked day's override", () => {
    const today = Date.now();
    const t = routine({ occurrenceStatus: { [occurrenceDateKey(today)]: "done" } });
    expect(occurrenceStatusOf(t, today)).toBe("done");
    expect(occurrenceStatusOf(t, today + DAY)).toBe("pending");
  });

  it("passes non-repeat tasks through untouched", () => {
    const t = newTask({ id: "t1", title: "One-off", status: "done" });
    expect(occurrenceTask(t, Date.now())).toBe(t);
  });
});

describe("setStatus on a routine", () => {
  it("marks today's occurrence only — template status and other days stay put", () => {
    const s1 = reducer(base([routine()]), { type: "setStatus", id: "r1", status: "done" });
    const t = s1.tasks[0];
    expect(t.status).toBe("pending");
    expect(t.completedAt).toBeUndefined();
    expect(occurrenceStatusOf(t, Date.now())).toBe("done");
    expect(occurrenceStatusOf(t, Date.now() + DAY)).toBe("pending");
  });

  it("marks an explicit future day without touching today", () => {
    const tomorrow = Date.now() + DAY;
    const s1 = reducer(base([routine()]), { type: "setStatus", id: "r1", status: "skipped", occurrenceDay: tomorrow });
    const t = s1.tasks[0];
    expect(occurrenceStatusOf(t, tomorrow)).toBe("skipped");
    expect(occurrenceStatusOf(t, Date.now())).toBe("pending");
  });

  it("keeps earlier days' marks when a new day is marked", () => {
    const yesterday = Date.now() - DAY;
    const s1 = reducer(base([routine()]), { type: "setStatus", id: "r1", status: "done", occurrenceDay: yesterday });
    const s2 = reducer(s1, { type: "setStatus", id: "r1", status: "skipped" });
    const t = s2.tasks[0];
    expect(occurrenceStatusOf(t, yesterday)).toBe("done");
    expect(occurrenceStatusOf(t, Date.now())).toBe("skipped");
  });

  it("starts the timer when today's occurrence enters in_progress, but not for another day", () => {
    const s1 = reducer(base([routine()]), { type: "setStatus", id: "r1", status: "in_progress" });
    expect(s1.timer.taskId).toBe("r1");
    expect(s1.timer.runningSince).toBeDefined();

    const s2 = reducer(base([routine()]), { type: "setStatus", id: "r1", status: "in_progress", occurrenceDay: Date.now() + DAY });
    expect(s2.timer.runningSince).toBeUndefined();
  });

  it("leaves non-repeat tasks on the shared-status path", () => {
    const s1 = reducer(base([newTask({ id: "t1", title: "One-off" })]), { type: "setStatus", id: "t1", status: "done" });
    expect(s1.tasks[0].status).toBe("done");
    expect(s1.tasks[0].completedAt).toBeDefined();
    expect(s1.tasks[0].occurrenceStatus).toBeUndefined();
  });
});
