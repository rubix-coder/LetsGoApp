// @vitest-environment node
import { describe, expect, it } from "vitest";
import { elapsedSec, newTask, reducer, taskElapsedMin } from "./store";
import { newBook } from "./books";
import type { AppState } from "./types";

function base(patch: Partial<AppState> = {}): AppState {
  return {
    tasks: [],
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
    ...patch,
  };
}

describe("task reducer", () => {
  it("marks done with a completion time", () => {
    const t = newTask({ title: "Ship changelog" });
    const s = reducer(base({ tasks: [t] }), { type: "setStatus", id: t.id, status: "done" });
    expect(s.tasks[0].status).toBe("done");
    expect(s.tasks[0].completedAt).toBeGreaterThan(0);
  });

  it("deleting a parent removes its subtasks", () => {
    const parent = newTask({ title: "Website refresh" });
    const child = newTask({ title: "New hero", parentId: parent.id });
    const s = reducer(base({ tasks: [parent, child] }), { type: "deleteTask", id: parent.id });
    expect(s.tasks).toHaveLength(0);
  });

  it("completing a task with a running timer banks the session", () => {
    const t = newTask({ title: "DSA practice" });
    const state = base({
      tasks: [t],
      timer: { mode: "pomodoro", taskId: t.id, runningSince: Date.now() - 10 * 60_000, baseSec: 0, targetSec: 1500, pomodorosDone: 0 },
    });
    const s = reducer(state, { type: "setStatus", id: t.id, status: "done" });
    expect(s.sessions).toHaveLength(1);
    expect(s.sessions[0].minutes).toBe(10);
    expect(s.tasks[0].loggedMin).toBe(10);
    expect(s.timer.runningSince).toBeUndefined();
  });
});

describe("timer reducer", () => {
  it("start on a pending task moves it to in_progress", () => {
    const t = newTask({ title: "Review PR" });
    const s = reducer(base({ tasks: [t] }), { type: "timerStart", taskId: t.id });
    expect(s.timer.runningSince).toBeDefined();
    expect(s.tasks[0].status).toBe("in_progress");
  });

  it("pause accumulates elapsed seconds; complete logs and resets", () => {
    const t = newTask({ title: "Deep work" });
    let s = reducer(base({ tasks: [t] }), { type: "timerStart", taskId: t.id });
    s = { ...s, timer: { ...s.timer, runningSince: Date.now() - 5 * 60_000 } };
    s = reducer(s, { type: "timerPause" });
    expect(s.timer.runningSince).toBeUndefined();
    expect(Math.round(elapsedSec(s.timer) / 60)).toBe(5);
    s = reducer(s, { type: "timerComplete" });
    expect(s.sessions).toHaveLength(1);
    expect(s.timer.baseSec).toBe(0);
    expect(s.timer.pomodorosDone).toBe(1);
  });

  it("sub-minute runs are dropped, not logged", () => {
    const t = newTask({ title: "Blip" });
    let s = reducer(base({ tasks: [t] }), { type: "timerStart", taskId: t.id });
    s = { ...s, timer: { ...s.timer, runningSince: Date.now() - 10_000 } };
    s = reducer(s, { type: "timerComplete" });
    expect(s.sessions).toHaveLength(0);
  });
});

describe("countdown target from the task estimate", () => {
  const countdownBase = (tasks: AppState["tasks"]) =>
    base({ tasks, timer: { mode: "countdown", baseSec: 0, targetSec: 3600, pomodorosDone: 0 } });

  it("aims a focused countdown at the task's remaining estimate", () => {
    const t = { ...newTask({ title: "Big task" }), estimateMin: 120, loggedMin: 30 };
    const s = reducer(countdownBase([t]), { type: "timerStart", taskId: t.id });
    expect(s.timer.targetSec).toBe(90 * 60);
  });

  it("falls back to an hour when the task has no estimate", () => {
    const t = newTask({ title: "No estimate" });
    const s = reducer(countdownBase([t]), { type: "timerStart", taskId: t.id });
    expect(s.timer.targetSec).toBe(60 * 60);
  });

  it("floors the target at 5 minutes once the estimate is spent", () => {
    const t = { ...newTask({ title: "Overrun" }), estimateMin: 60, loggedMin: 90 };
    const s = reducer(countdownBase([t]), { type: "timerStart", taskId: t.id });
    expect(s.timer.targetSec).toBe(5 * 60);
  });

  it("pomodoro mode ignores the estimate and stays 25 minutes", () => {
    const t = { ...newTask({ title: "Big task" }), estimateMin: 120 };
    const s = reducer(base({ tasks: [t] }), { type: "timerStart", taskId: t.id });
    expect(s.timer.targetSec).toBe(25 * 60);
  });

  it("an estimate edit refreshes the idle countdown target", () => {
    const t = { ...newTask({ title: "Big task" }), estimateMin: 60 };
    let s = reducer(countdownBase([t]), { type: "timerStart", taskId: t.id });
    s = reducer(s, { type: "timerPause" });
    s = reducer(s, { type: "upsertTask", task: { ...s.tasks[0], estimateMin: 120 } });
    expect(s.timer.targetSec).toBe(120 * 60);
  });
});

describe("pause logging", () => {
  it("manual pause then resume logs a break for the away span", () => {
    const t = newTask({ title: "Deep work" });
    let s = reducer(base({ tasks: [t] }), { type: "timerStart", taskId: t.id });
    s = { ...s, timer: { ...s.timer, runningSince: Date.now() - 20 * 60_000 } };
    s = reducer(s, { type: "timerPause" });
    expect(s.timer.pausedSince).toBeDefined();
    s = { ...s, timer: { ...s.timer, pausedSince: Date.now() - 6 * 60_000 } };
    s = reducer(s, { type: "timerStart" });
    const pauses = s.sessions.filter((x) => x.kind === "pause");
    expect(pauses).toHaveLength(1);
    expect(pauses[0].minutes).toBe(6);
    expect(s.timer.pausedSince).toBeUndefined();
  });

  it("a pause under a minute is not logged", () => {
    const t = newTask({ title: "Deep work" });
    let s = reducer(base({ tasks: [t] }), { type: "timerStart", taskId: t.id });
    s = reducer(s, { type: "timerPause" });
    s = reducer(s, { type: "timerStart" });
    expect(s.sessions).toHaveLength(0);
  });

  it("auto-pause freezes worked time at the last interaction, banking the idle span on resume", () => {
    const t = newTask({ title: "Deep work" });
    let s = reducer(base({ tasks: [t] }), { type: "timerStart", taskId: t.id });
    s = { ...s, timer: { ...s.timer, runningSince: Date.now() - 60 * 60_000 } };
    s = reducer(s, { type: "timerAutoPause", since: Date.now() - 45 * 60_000 });
    expect(s.tasks[0].status).toBe("paused");
    expect(Math.round(elapsedSec(s.timer) / 60)).toBe(15);
    s = reducer(s, { type: "timerStart" });
    expect(s.sessions.find((x) => x.kind === "pause")!.minutes).toBe(45);
    s = { ...s, timer: { ...s.timer, runningSince: Date.now() } };
    s = reducer(s, { type: "timerComplete" });
    expect(s.sessions.filter((x) => x.kind !== "pause").reduce((n, x) => n + x.minutes, 0)).toBe(15);
  });

  it("timerReset drops a pending pause without logging it", () => {
    const t = newTask({ title: "Deep work" });
    let s = reducer(base({ tasks: [t] }), { type: "timerStart", taskId: t.id });
    s = reducer(s, { type: "timerPause" });
    s = { ...s, timer: { ...s.timer, pausedSince: Date.now() - 10 * 60_000 } };
    s = reducer(s, { type: "timerReset" });
    expect(s.timer.pausedSince).toBeUndefined();
    expect(s.sessions).toHaveLength(0);
  });
});

describe("sessionDelete", () => {
  it("removes a focus session and refunds its minutes to the task", () => {
    const t = { ...newTask({ title: "X" }), loggedMin: 50 };
    const sess = { id: "s1", taskId: t.id, label: "X", startedAt: Date.now(), minutes: 20, kind: "focus" as const };
    const s = reducer(base({ tasks: [t], sessions: [sess] }), { type: "sessionDelete", id: "s1" });
    expect(s.sessions).toHaveLength(0);
    expect(s.tasks[0].loggedMin).toBe(30);
  });

  it("removes a pause session without touching loggedMin", () => {
    const t = { ...newTask({ title: "X" }), loggedMin: 50 };
    const sess = { id: "p1", taskId: t.id, label: "X", startedAt: Date.now(), minutes: 20, kind: "pause" as const };
    const s = reducer(base({ tasks: [t], sessions: [sess] }), { type: "sessionDelete", id: "p1" });
    expect(s.tasks[0].loggedMin).toBe(50);
  });
});

describe("paused status", () => {
  it("pausing the timer puts the task it's timing on hold, holding the elapsed time", () => {
    const t = newTask({ title: "Deep work" });
    let s = reducer(base({ tasks: [t] }), { type: "timerStart", taskId: t.id });
    s = { ...s, timer: { ...s.timer, runningSince: Date.now() - 12 * 60_000 } };
    s = reducer(s, { type: "timerPause" });
    expect(s.tasks[0].status).toBe("paused");
    expect(s.timer.runningSince).toBeUndefined();
    expect(Math.round(elapsedSec(s.timer) / 60)).toBe(12);
    expect(s.sessions).toHaveLength(0);            // nothing banked
  });

  it("resuming a paused task continues the same count and re-runs the clock", () => {
    const t = newTask({ title: "Deep work" });
    let s = reducer(base({ tasks: [t] }), { type: "timerStart", taskId: t.id });
    s = { ...s, timer: { ...s.timer, runningSince: Date.now() - 12 * 60_000 } };
    s = reducer(s, { type: "timerPause" });
    const held = s.timer.baseSec;
    s = reducer(s, { type: "setStatus", id: t.id, status: "in_progress" });
    expect(s.tasks[0].status).toBe("in_progress");
    expect(s.timer.baseSec).toBe(held);           // not zeroed
    expect(s.timer.runningSince).toBeDefined();
    expect(s.sessions).toHaveLength(0);
  });

  it("timerStart also resumes a paused task, keeping the held count", () => {
    const t = newTask({ title: "Deep work" });
    let s = reducer(base({ tasks: [t] }), { type: "timerStart", taskId: t.id });
    s = { ...s, timer: { ...s.timer, runningSince: Date.now() - 8 * 60_000 } };
    s = reducer(s, { type: "timerPause" });
    const held = s.timer.baseSec;
    s = reducer(s, { type: "timerStart" });
    expect(s.tasks[0].status).toBe("in_progress");
    expect(s.timer.baseSec).toBe(held);
  });

  it("resuming a paused task keeps its original scheduled slot (not a late start)", () => {
    const d = new Date(); d.setHours(10, 0, 0, 0);
    const tenAm = d.getTime();
    const t = { ...newTask({ title: "Deep work", estimateMin: 90 }), scheduledAt: tenAm, status: "in_progress" as const };
    let s = reducer(base({ tasks: [t] }), { type: "timerStart", taskId: t.id });
    s = { ...s, timer: { ...s.timer, runningSince: tenAm } };
    s = reducer(s, { type: "setStatus", id: t.id, status: "paused" });
    // ...resumed later in the day
    s = reducer(s, { type: "setStatus", id: t.id, status: "in_progress" });
    expect(s.tasks[0].scheduledAt).toBe(tenAm);
  });

  it("banks a paused task's worked time when another task takes the clock", () => {
    const a = newTask({ title: "A" });
    const b = newTask({ title: "B" });
    let s = reducer(base({ tasks: [a, b] }), { type: "timerStart", taskId: a.id });
    s = { ...s, timer: { ...s.timer, runningSince: Date.now() - 20 * 60_000 } };
    s = reducer(s, { type: "timerAutoPause", since: Date.now() });
    s = reducer(s, { type: "setStatus", id: b.id, status: "in_progress" });
    expect(s.tasks[0].loggedMin).toBe(20);        // A's 20 minutes are not lost
    expect(s.timer.taskId).toBe(b.id);
    expect(s.timer.baseSec).toBe(0);              // and do not ride onto B
  });

  it("timerStart on another task banks the paused run too", () => {
    const a = newTask({ title: "A" });
    const b = newTask({ title: "B" });
    let s = reducer(base({ tasks: [a, b] }), { type: "timerStart", taskId: a.id });
    s = { ...s, timer: { ...s.timer, runningSince: Date.now() - 15 * 60_000 } };
    s = reducer(s, { type: "timerPause" });
    s = reducer(s, { type: "timerStart", taskId: b.id });
    expect(s.tasks[0].loggedMin).toBe(15);
    expect(s.timer.baseSec).toBe(0);
  });

  it("elapsed accumulates across many pause/resume cycles rather than resetting", () => {
    const t = newTask({ title: "Deep work", estimateMin: 60 });
    let s = reducer(base({ tasks: [t] }), { type: "timerStart", taskId: t.id });
    for (let i = 0; i < 3; i++) {
      s = { ...s, timer: { ...s.timer, runningSince: Date.now() - 10 * 60_000 } };
      s = reducer(s, { type: "timerAutoPause", since: Date.now() });
      s = reducer(s, { type: "setStatus", id: t.id, status: "in_progress" });
    }
    expect(Math.round(taskElapsedMin(s, s.tasks[0]))).toBe(30);
  });

  it("a paused task reports its held time as elapsed, not the banked total", () => {
    const t = newTask({ title: "Deep work" });
    let s = reducer(base({ tasks: [t] }), { type: "timerStart", taskId: t.id });
    s = { ...s, timer: { ...s.timer, runningSince: Date.now() - 12 * 60_000 } };
    s = reducer(s, { type: "timerPause" });
    expect(s.tasks[0].loggedMin).toBe(0);
    expect(Math.round(taskElapsedMin(s, s.tasks[0]))).toBe(12);
  });

  it("pausing a task with no running timer just changes status", () => {
    const t = { ...newTask({ title: "Errand" }), status: "in_progress" as const };
    const before = base({ tasks: [t] });
    const s = reducer(before, { type: "setStatus", id: t.id, status: "paused" });
    expect(s.tasks[0].status).toBe("paused");
    expect(s.sessions).toBe(before.sessions);
    expect(s.timer).toBe(before.timer);
  });

  it("a parent with a paused child (and no in-progress one) reads paused", () => {
    const p = newTask({ title: "Feature" });
    const a = { ...newTask({ title: "A", parentId: p.id }), status: "paused" as const };
    const b = newTask({ title: "B", parentId: p.id });   // pending
    const s = reducer(base({ tasks: [p, a, b] }), { type: "setStatus", id: b.id, status: "pending" });
    expect(s.tasks.find((x) => x.title === "Feature")!.status).toBe("paused");
  });

  it("an in-progress child outranks a paused sibling for the parent's status", () => {
    const p = newTask({ title: "Feature" });
    const a = { ...newTask({ title: "A", parentId: p.id }), status: "paused" as const };
    const b = newTask({ title: "B", parentId: p.id });
    const s = reducer(base({ tasks: [p, a, b] }), { type: "setStatus", id: b.id, status: "in_progress" });
    expect(s.tasks.find((x) => x.title === "Feature")!.status).toBe("in_progress");
  });
});

describe("metadata edits preserve manual placement", () => {
  // A scheduled root with estimated children is "pack-anchored": the live
  // re-pack lays children back-to-back from the root anchor. After a manual
  // drag diverges from that layout, an edit that does NOT touch scheduling
  // inputs (tags, priority, lock…) must not snap tasks back to the pack.
  const T = 1_700_000_000_000;
  const tree = () => {
    const root = { ...newTask({ title: "R" }), scheduledAt: T };
    const a = { ...newTask({ title: "A", parentId: root.id }), estimateMin: 60, scheduledAt: T + 5 * 3_600_000 };
    const b = { ...newTask({ title: "B", parentId: root.id }), estimateMin: 30, scheduledAt: T + 7 * 3_600_000 };
    return { root, a, b };
  };

  it("a tags-only edit moves nothing", () => {
    const { root, a, b } = tree();
    const s = reducer(base({ tasks: [root, a, b] }), { type: "upsertTask", task: { ...b, tags: ["deep"] } });
    expect(s.tasks.find((x) => x.title === "A")!.scheduledAt).toBe(a.scheduledAt);
    expect(s.tasks.find((x) => x.title === "B")!.scheduledAt).toBe(b.scheduledAt);
  });

  it("toggling the lock moves nothing", () => {
    const { root, a, b } = tree();
    const s = reducer(base({ tasks: [root, a, b] }), { type: "upsertTask", task: { ...b, locked: true } });
    expect(s.tasks.find((x) => x.title === "A")!.scheduledAt).toBe(a.scheduledAt);
    expect(s.tasks.find((x) => x.title === "B")!.scheduledAt).toBe(b.scheduledAt);
  });

  it("an estimate edit still re-packs the tree (live re-pack stays)", () => {
    const { root, a, b } = tree();
    const s = reducer(base({ tasks: [root, a, b] }), { type: "upsertTask", task: { ...b, estimateMin: 45 } });
    expect(s.tasks.find((x) => x.title === "A")!.scheduledAt).toBe(T);
  });

  it("an estimate edit with repack:false leaves siblings put (timeline resize)", () => {
    const { root, a, b } = tree();
    const s = reducer(base({ tasks: [root, a, b] }), { type: "upsertTask", task: { ...b, estimateMin: 45 }, repack: false });
    // The re-pack would have snapped A to the root anchor T; opting out keeps
    // both manually-diverged starts and just grows B in place.
    expect(s.tasks.find((x) => x.title === "A")!.scheduledAt).toBe(a.scheduledAt);
    expect(s.tasks.find((x) => x.title === "B")!.scheduledAt).toBe(b.scheduledAt);
    expect(s.tasks.find((x) => x.title === "B")!.estimateMin).toBe(45);
  });
});

describe("scheduling lock", () => {
  it("rescheduling a locked task is a no-op", () => {
    const t = { ...newTask({ title: "Fixed" }), scheduledAt: 1_000, locked: true };
    const s = reducer(base({ tasks: [t] }), { type: "scheduleTask", id: t.id, at: 99_000 });
    expect(s.tasks[0].scheduledAt).toBe(1_000);
  });

  it("edits keep a locked task's date-times but apply status fields", () => {
    const t = { ...newTask({ title: "Fixed" }), scheduledAt: 1_000, deadline: 2_000, estimateMin: 30, locked: true };
    const s = reducer(base({ tasks: [t] }), {
      type: "upsertTask",
      task: { ...t, scheduledAt: 5_000, deadline: 6_000, estimateMin: 90, priority: 0, tags: ["deep"] },
    });
    expect(s.tasks[0].scheduledAt).toBe(1_000);
    expect(s.tasks[0].deadline).toBe(2_000);
    expect(s.tasks[0].estimateMin).toBe(30);
    expect(s.tasks[0].priority).toBe(0);
    expect(s.tasks[0].tags).toEqual(["deep"]);
  });

  it("tree shifts move siblings but leave locked ones anchored", () => {
    const parent = newTask({ title: "P" });
    const a = { ...newTask({ title: "A", parentId: parent.id }), scheduledAt: 10_000, estimateMin: 30 };
    const b = { ...newTask({ title: "B", parentId: parent.id }), scheduledAt: 20_000, estimateMin: 30, locked: true };
    // Drop A two hours out — well clear of B's locked 20_000–1_820_000 slot, so
    // this exercises the shift alone (see the next test for a collision).
    const dropAt = 10_000 + 7_200_000;
    const s = reducer(base({ tasks: [parent, a, b] }), { type: "scheduleTask", id: a.id, at: dropAt });
    expect(s.tasks.find((x) => x.title === "A")!.scheduledAt).toBe(dropAt);
    expect(s.tasks.find((x) => x.title === "B")!.scheduledAt).toBe(20_000);
  });

  it("a leaf dropped onto a locked sibling snaps past it, keeping the break", () => {
    const parent = newTask({ title: "P" });
    const a = { ...newTask({ title: "A", parentId: parent.id }), scheduledAt: 10_000, estimateMin: 30 };
    const b = { ...newTask({ title: "B", parentId: parent.id }), scheduledAt: 20_000, estimateMin: 30, locked: true };
    // Dropped inside B's locked slot: nothing may share a locked task's time,
    // so A lands after it plus the 5-minute default break.
    const s = reducer(base({ tasks: [parent, a, b] }), { type: "scheduleTask", id: a.id, at: 1_000_000 });
    expect(s.tasks.find((x) => x.title === "A")!.scheduledAt).toBe(1_820_000 + 300_000);
    expect(s.tasks.find((x) => x.title === "B")!.scheduledAt).toBe(20_000);
  });
});

describe("quick timers", () => {
  it("add starts a countdown of the requested length", () => {
    const s = reducer(base(), { type: "quickTimerAdd", minutes: 7, label: "7m" });
    expect(s.quickTimers).toHaveLength(1);
    expect(s.quickTimers[0].totalSec).toBe(420);
    expect(s.quickTimers[0].endsAt! - Date.now()).toBeGreaterThan(415_000);
  });

  it("several run side by side, independent of the focus timer", () => {
    let s = reducer(base(), { type: "quickTimerAdd", minutes: 5 });
    s = reducer(s, { type: "quickTimerAdd", minutes: 10 });
    expect(s.quickTimers).toHaveLength(2);
    expect(s.timer.runningSince).toBeUndefined();
  });

  it("toggle pauses banking the remainder, then resumes from it", () => {
    let s = reducer(base(), { type: "quickTimerAdd", minutes: 7 });
    const id = s.quickTimers[0].id;
    s = reducer(s, { type: "quickTimerToggle", id });
    expect(s.quickTimers[0].endsAt).toBeUndefined();
    expect(s.quickTimers[0].remainSec).toBeGreaterThan(415);
    s = reducer(s, { type: "quickTimerToggle", id });
    expect(s.quickTimers[0].remainSec).toBeUndefined();
    expect(s.quickTimers[0].endsAt! - Date.now()).toBeGreaterThan(415_000);
  });

  it("toggle on a rung timer restarts it in full", () => {
    let s = reducer(base(), { type: "quickTimerAdd", minutes: 7 });
    s = { ...s, quickTimers: [{ ...s.quickTimers[0], endsAt: Date.now() - 1_000 }] };
    s = reducer(s, { type: "quickTimerToggle", id: s.quickTimers[0].id });
    expect(s.quickTimers[0].endsAt! - Date.now()).toBeGreaterThan(415_000);
  });

  it("remove deletes only the targeted timer", () => {
    let s = reducer(base(), { type: "quickTimerAdd", minutes: 5 });
    s = reducer(s, { type: "quickTimerAdd", minutes: 10 });
    s = reducer(s, { type: "quickTimerRemove", id: s.quickTimers[0].id });
    expect(s.quickTimers).toHaveLength(1);
    expect(s.quickTimers[0].totalSec).toBe(600);
  });
});

describe("notes + notebooks reordering", () => {
  const nb = (id: string) => ({ id, name: id });
  const nt = (id: string, folderId: string, parentId?: string) => ({ id, folderId, title: id, body: "", updatedAt: 0, parentId });

  it("reorderFolder drops a notebook just before its target", () => {
    const s = reducer(base({ folders: [nb("a"), nb("b"), nb("c")] }), { type: "reorderFolder", id: "c", targetId: "a" });
    expect(s.folders.map((f) => f.id)).toEqual(["c", "a", "b"]);
  });

  it("reorderNote reorders pages within a sibling group", () => {
    const notes = [nt("n1", "f"), nt("n2", "f"), nt("n3", "f")];
    const s = reducer(base({ notes }), { type: "reorderNote", id: "n3", targetId: "n1" });
    expect(s.notes.map((n) => n.id)).toEqual(["n3", "n1", "n2"]);
  });

  it("reorderNote across notebooks or parents is a no-op", () => {
    const notes = [nt("n1", "f1"), nt("n2", "f2")];
    const s = reducer(base({ notes }), { type: "reorderNote", id: "n2", targetId: "n1" });
    expect(s.notes.map((n) => n.id)).toEqual(["n1", "n2"]);
  });
});

describe("notebooks", () => {
  const folders = [{ id: "f1", name: "Work" }, { id: "f2", name: "Personal" }];
  const notes = [
    { id: "n1", folderId: "f1", title: "A", body: "", updatedAt: 0 },
    { id: "n2", folderId: "f1", title: "B", body: "", updatedAt: 0, parentId: "n1" },
    { id: "n3", folderId: "f2", title: "C", body: "", updatedAt: 0 },
  ];

  it("deleting a notebook takes its pages with it", () => {
    const s = reducer(base({ folders, notes }), { type: "deleteFolder", id: "f1" });
    expect(s.folders.map((f) => f.id)).toEqual(["f2"]);
    expect(s.notes.map((n) => n.id)).toEqual(["n3"]);
  });

  it("refuses to delete the last notebook, so a new note always has a home", () => {
    const one = base({ folders: [folders[0]], notes: [notes[0]] });
    expect(reducer(one, { type: "deleteFolder", id: "f1" })).toBe(one);
  });

  it("ignores a notebook that does not exist", () => {
    const s = base({ folders, notes });
    expect(reducer(s, { type: "deleteFolder", id: "nope" })).toBe(s);
  });
});

describe("book reducer", () => {
  const odyssey = newBook({ id: "b1", title: "The Odyssey", isbn13: "9780140449136" });

  it("adds a book that is not there yet", () => {
    const s = reducer(base(), { type: "upsertBook", book: odyssey });
    expect(s.books.map((b) => b.id)).toEqual(["b1"]);
  });

  it("updates in place rather than appending a second copy", () => {
    const s = reducer(base({ books: [odyssey] }), {
      type: "upsertBook",
      book: { ...odyssey, status: "read", rating: 5 },
    });
    expect(s.books).toHaveLength(1);
    expect(s.books[0]).toMatchObject({ status: "read", rating: 5 });
  });

  it("deletes by id and leaves the rest", () => {
    const dune = newBook({ id: "b2", title: "Dune" });
    const s = reducer(base({ books: [odyssey, dune] }), { type: "deleteBook", id: "b1" });
    expect(s.books.map((b) => b.id)).toEqual(["b2"]);
  });

  it("merges an import by ISBN instead of duplicating", () => {
    const incoming = newBook({ id: "other", title: "The Odyssey", isbn13: "9780140449136", publisher: "Penguin" });
    const s = reducer(base({ books: [odyssey] }), { type: "importBooks", books: [incoming] });
    expect(s.books).toHaveLength(1);
    expect(s.books[0].id).toBe("b1");
    expect(s.books[0].publisher).toBe("Penguin");
  });

  it("bulk-deletes exactly the ids given, in one transition", () => {
    const a = newBook({ id: "b1" }), b = newBook({ id: "b2" }), c = newBook({ id: "b3" });
    const s = reducer(base({ books: [a, b, c] }), { type: "deleteBooks", ids: ["b1", "b3"] });
    expect(s.books.map((x) => x.id)).toEqual(["b2"]);
  });

  it("ignores ids that are not there rather than throwing", () => {
    const a = newBook({ id: "b1" });
    const s = reducer(base({ books: [a] }), { type: "deleteBooks", ids: ["nope"] });
    expect(s.books).toHaveLength(1);
  });

  /* An empty selection must be a no-op, not a state churn: the action bar is
     only visible with a selection, but a race could still deliver one. */
  it("an empty bulk delete leaves state untouched", () => {
    const before = base({ books: [newBook({ id: "b1" })] });
    expect(reducer(before, { type: "deleteBooks", ids: [] })).toBe(before);
  });

  it("bulk-updates only the selected books", () => {
    const a = newBook({ id: "b1", status: "unread" });
    const b = newBook({ id: "b2", status: "unread" });
    const s = reducer(base({ books: [a, b] }), { type: "updateBooks", ids: ["b1"], patch: { status: "read" } });
    expect(s.books.find((x) => x.id === "b1")!.status).toBe("read");
    expect(s.books.find((x) => x.id === "b2")!.status).toBe("unread");
  });

  it("a bulk update patches only the named fields", () => {
    const a = newBook({ id: "b1", title: "Dune", rating: 4, status: "unread" });
    const s = reducer(base({ books: [a] }), { type: "updateBooks", ids: ["b1"], patch: { shelf: "Loft" } });
    expect(s.books[0]).toMatchObject({ title: "Dune", rating: 4, status: "unread", shelf: "Loft" });
  });

  /* The reducer rewrites note bodies whenever tasks change (writeTasksBackToNotes).
     Book actions must never trip that — a shelf of 400 scans would otherwise
     rewrite every note in the vault 400 times. The referential check is the
     assertion that matters; a deep-equal one would pass even if it re-ran. */
  it("never touches notes, so a scan cannot churn the markdown", () => {
    const notes = [{ id: "n1", folderId: "f1", title: "Plan", body: "- [ ] ship it", updatedAt: 0 }];
    const before = base({ notes });
    const after = reducer(before, { type: "upsertBook", book: odyssey });
    expect(after.notes).toBe(before.notes);
    expect(after.tasks).toBe(before.tasks);
  });
});

describe("book reducer — duplicates", () => {
  const ISBN = "9780441013593";

  it("adds a genuinely new book", () => {
    const s = reducer(base(), { type: "upsertBook", book: newBook({ isbn13: ISBN, title: "Dune" }) });
    expect(s.books).toHaveLength(1);
  });

  it("does not add a second copy when the same ISBN is scanned again", () => {
    /* The reported bug. A second scanner session mints a fresh id, so an
       id-only match appended a duplicate — which is what happens whenever a
       shelf is catalogued across more than one sitting. */
    const first = newBook({ isbn13: ISBN, title: "Dune", status: "read" });
    const rescan = newBook({ isbn13: ISBN, title: ISBN });
    let s = reducer(base(), { type: "upsertBook", book: first });
    s = reducer(s, { type: "upsertBook", book: rescan });
    expect(s.books).toHaveLength(1);
    expect(s.books[0].id).toBe(first.id);
    expect(s.books[0].status).toBe("read");
    expect(s.books[0].title).toBe("Dune");
  });

  it("enriches in place rather than moving the book to the end of the shelf", () => {
    const a = newBook({ isbn13: ISBN, title: "Dune" });
    const b = newBook({ title: "Something else" });
    let s = base({ books: [a, b] });
    s = reducer(s, { type: "upsertBook", book: newBook({ isbn13: ISBN, title: ISBN }) });
    expect(s.books.map((x) => x.id)).toEqual([a.id, b.id]);
  });

  it("still edits by id, so renaming a book does not clone it", () => {
    const book = newBook({ isbn13: ISBN, title: "Dune" });
    let s = reducer(base(), { type: "upsertBook", book });
    s = reducer(s, { type: "upsertBook", book: { ...book, title: "Dune (annotated)" } });
    expect(s.books).toHaveLength(1);
    expect(s.books[0].title).toBe("Dune (annotated)");
  });

  it("keeps two different books that happen to lack ISBNs and titles apart", () => {
    let s = reducer(base(), { type: "upsertBook", book: newBook({ title: "" }) });
    s = reducer(s, { type: "upsertBook", book: newBook({ title: "" }) });
    expect(s.books).toHaveLength(2);
  });

  it("dedupeBooks merges what is already stored", () => {
    const books = [
      newBook({ isbn13: ISBN, title: "Dune", rating: 5 }),
      newBook({ isbn13: ISBN, title: ISBN }),
      newBook({ title: "Other" }),
    ];
    const s = reducer(base({ books }), { type: "dedupeBooks" });
    expect(s.books).toHaveLength(2);
    expect(s.books[0].rating).toBe(5);
  });

  it("dedupeBooks returns the SAME state object when there is nothing to merge", () => {
    // Referential equality matters: a new object here would mark the vault
    // dirty and trigger a sync push on every render.
    const before = base({ books: [newBook({ title: "A" })] });
    expect(reducer(before, { type: "dedupeBooks" })).toBe(before);
  });

  it("book actions never touch tasks or notes", () => {
    const before = base({ tasks: [newTask({ title: "t" })] });
    const after = reducer(before, { type: "upsertBook", book: newBook({ title: "B" }) });
    expect(after.tasks).toBe(before.tasks);
    expect(after.notes).toBe(before.notes);
  });
});

describe("plugin reorder reducer", () => {
  it("stores a complete order on the first drag", () => {
    const s = reducer(base(), { type: "reorderPlugin", id: "library", targetId: "todo" });
    expect(s.settings.pluginOrder?.[0]).toBe("library");
    expect(s.settings.pluginOrder).toHaveLength(7);
  });

  it("is a no-op when a row is dropped on itself", () => {
    const before = base();
    expect(reducer(before, { type: "reorderPlugin", id: "todo", targetId: "todo" })).toBe(before);
  });

  it("leaves everything except settings untouched", () => {
    const before = base({ tasks: [newTask({ title: "t" })] });
    const after = reducer(before, { type: "reorderPlugin", id: "notes", targetId: "todo" });
    expect(after.tasks).toBe(before.tasks);
    expect(after.books).toBe(before.books);
  });
});

describe("scheduling an unscheduled tree from its first task", () => {
  const T = 1_700_000_000_000;
  const unscheduledTree = () => {
    const root = newTask({ title: "Imported plan" });
    const a = { ...newTask({ title: "step 1", parentId: root.id }), estimateMin: 30 };
    const b = { ...newTask({ title: "step 2", parentId: root.id }), estimateMin: 45 };
    const c = { ...newTask({ title: "step 3", parentId: root.id }), estimateMin: 20 };
    return { root, a, b, c };
  };

  // base() has no breakMin, so the packer uses the 5-minute default gap.
  const G = 5 * 60_000;

  it("packs the whole tree back-to-back when the first leaf gets a start time", () => {
    const { root, a, b, c } = unscheduledTree();
    const s = reducer(base({ tasks: [root, a, b, c] }), { type: "upsertTask", task: { ...a, scheduledAt: T } });
    const at = (title: string) => s.tasks.find((x) => x.title === title)!.scheduledAt;
    expect(at("step 1")).toBe(T);
    expect(at("step 2")).toBe(T + 30 * 60_000 + G);               // after step 1 + gap
    expect(at("step 3")).toBe(T + (30 + 45) * 60_000 + 2 * G);    // after step 2 + gap
    expect(at("Imported plan")).toBe(T);                          // parent spans the run
  });

  it("does not touch tasks before the scheduled one, or another tree", () => {
    const { root, a, b, c } = unscheduledTree();
    const other = newTask({ title: "unrelated" });
    const s = reducer(base({ tasks: [root, a, b, c, other] }), { type: "upsertTask", task: { ...b, scheduledAt: T } });
    expect(s.tasks.find((x) => x.title === "step 1")!.scheduledAt).toBeUndefined();
    expect(s.tasks.find((x) => x.title === "step 3")!.scheduledAt).toBe(T + 45 * 60_000 + G);
    expect(s.tasks.find((x) => x.title === "unrelated")!.scheduledAt).toBeUndefined();
  });
});

describe("reorderTask", () => {
  it("moves a later subtask before an earlier sibling", () => {
    const root = newTask({ title: "R" });
    const a = newTask({ title: "1.1", parentId: root.id });
    const b = newTask({ title: "1.0", parentId: root.id });
    const s = reducer(base({ tasks: [root, a, b] }), { type: "reorderTask", id: b.id, targetId: a.id, place: "before" });
    const kids = s.tasks.filter((t) => t.parentId === root.id).map((t) => t.title);
    expect(kids).toEqual(["1.0", "1.1"]);
  });

  it("re-packs a scheduled tree so times follow the new order", () => {
    const T = 1_700_000_000_000;
    const root = { ...newTask({ title: "R" }), scheduledAt: T };
    const a = { ...newTask({ title: "A", parentId: root.id }), estimateMin: 60, scheduledAt: T };
    const b = { ...newTask({ title: "B", parentId: root.id }), estimateMin: 30, scheduledAt: T + 60 * 60_000 };
    const s = reducer(base({ tasks: [root, a, b] }), { type: "reorderTask", id: b.id, targetId: a.id, place: "before" });
    expect(s.tasks.find((x) => x.title === "B")!.scheduledAt).toBe(T);
    expect(s.tasks.find((x) => x.title === "A")!.scheduledAt).toBe(T + 30 * 60_000 + 5 * 60_000); // B + 5m gap
  });

  it("ignores a drop onto a task with a different parent", () => {
    const r1 = newTask({ title: "R1" });
    const r2 = newTask({ title: "R2" });
    const a = newTask({ title: "A", parentId: r1.id });
    const before = base({ tasks: [r1, r2, a] });
    expect(reducer(before, { type: "reorderTask", id: a.id, targetId: r2.id, place: "before" }).tasks).toBe(before.tasks);
  });
});
