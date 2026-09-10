// @vitest-environment node
/* The reducer wiring for the late-start move: planLateStart is unit-tested in
   lateStart.test.ts, this covers setStatus actually applying it (and the
   notice it raises). */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { newTask, persistableState, reducer } from "./store";
import type { AppState } from "./types";

const MIN = 60_000;

// These tests reason about "an hour from now". Run on the real clock late in
// the evening, that hour crosses midnight and the planner's day-boundary
// handling kicks in — which is not what they test. Pin "now" to mid-morning.
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(new Date().setHours(10, 0, 0, 0)));
});
afterAll(() => vi.useRealTimers());

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
      theme: "light", accent: "violet", density: "cozy", statusColors: true, reduceMotion: false,
      notifications: false, sounds: false, weekStart: 0, hourFormat: "24",
      workHours: { enabled: false, startMin: 360, endMin: 1260 },
      breakMin: 5,
      sync: { enabled: false, url: "/webdav", username: "", password: "" },
      plugins: { todo: true, timer: true, notes: true, mindmap: true, dashboard: true, library: true, habits: true },
      sidebarCollapsed: false, landingView: "todo", todoDefaultView: "last", scheduleReminders: true,
    },
    ...patch,
  };
}

describe("marking an overdue task in progress", () => {
  it("moves it to roughly now and explains why", () => {
    const threeHoursAgo = Date.now() - 3 * 60 * MIN;
    const t = newTask({ title: "Task A", scheduledAt: threeHoursAgo, estimateMin: 60 });
    const s = reducer(base({ tasks: [t] }), { type: "setStatus", id: t.id, status: "in_progress" });
    const moved = s.tasks.find((x) => x.id === t.id)!;
    expect(moved.status).toBe("in_progress");
    // Within a second of "now" — the reducer stamps its own clock.
    expect(Math.abs(moved.scheduledAt! - Date.now())).toBeLessThan(1000);
    expect(s.notice?.kind).toBe("info");
  });

  it("lands after a locked task holding the slot, and says so", () => {
    const now = Date.now();
    const a = newTask({ title: "Task A", scheduledAt: now - 3 * 60 * MIN, estimateMin: 60 });
    const b = newTask({ title: "Task B", scheduledAt: now, estimateMin: 60, locked: true });
    const s = reducer(base({ tasks: [a, b] }), { type: "setStatus", id: a.id, status: "in_progress" });
    const moved = s.tasks.find((x) => x.id === a.id)!;
    // B ends an hour from now; A takes the slot 5 minutes after that.
    expect(Math.abs(moved.scheduledAt! - (now + 65 * MIN))).toBeLessThan(1000);
    expect(s.notice?.kind).toBe("warn");
    expect(s.notice?.text).toContain("Task B");
    // The locked task itself never moves.
    expect(s.tasks.find((x) => x.id === b.id)!.scheduledAt).toBe(b.scheduledAt);
  });

  it("leaves a task whose time has not come alone", () => {
    const later = Date.now() + 2 * 60 * MIN;
    const t = newTask({ title: "Later", scheduledAt: later, estimateMin: 30 });
    const s = reducer(base({ tasks: [t] }), { type: "setStatus", id: t.id, status: "in_progress" });
    expect(s.tasks[0].scheduledAt).toBe(later);
    expect(s.notice).toBeUndefined();
  });

  it("does not move a task on any status other than in progress", () => {
    const was = Date.now() - 3 * 60 * MIN;
    const t = newTask({ title: "Task A", scheduledAt: was, estimateMin: 60 });
    for (const status of ["done", "skipped", "pending"] as const) {
      const s = reducer(base({ tasks: [t] }), { type: "setStatus", id: t.id, status });
      expect(s.tasks[0].scheduledAt).toBe(was);
    }
  });

  it("leaves routines alone — their scheduledAt is a recurrence anchor", () => {
    const was = Date.now() - 3 * 60 * MIN;
    const t = newTask({ title: "Standup", scheduledAt: was, estimateMin: 15, repeat: { interval: 1, unit: "daily" } });
    const s = reducer(base({ tasks: [t] }), { type: "setStatus", id: t.id, status: "in_progress" });
    expect(s.tasks[0].scheduledAt).toBe(was);
  });

  it("never moves a locked task itself", () => {
    const was = Date.now() - 3 * 60 * MIN;
    const t = newTask({ title: "Frozen", scheduledAt: was, estimateMin: 60, locked: true });
    const s = reducer(base({ tasks: [t] }), { type: "setStatus", id: t.id, status: "in_progress" });
    expect(s.tasks[0].scheduledAt).toBe(was);
    expect(s.notice).toBeUndefined();
  });
});

describe("notices are transient", () => {
  it("dismissNotice clears it", () => {
    const t = newTask({ title: "A", scheduledAt: Date.now() - 60 * MIN, estimateMin: 30 });
    const withNotice = reducer(base({ tasks: [t] }), { type: "setStatus", id: t.id, status: "in_progress" });
    expect(withNotice.notice).toBeDefined();
    expect(reducer(withNotice, { type: "dismissNotice" }).notice).toBeUndefined();
  });

  it("persistableState strips the notice so it is never stored or synced", () => {
    const t = newTask({ title: "A", scheduledAt: Date.now() - 60 * MIN, estimateMin: 30 });
    const s = reducer(base({ tasks: [t] }), { type: "setStatus", id: t.id, status: "in_progress" });
    const stored = persistableState(s);
    expect(stored.notice).toBeUndefined();
    expect("notice" in stored).toBe(false);
    // Everything else survives untouched.
    expect(stored.tasks).toBe(s.tasks);
  });

  it("adopting a remote document clears any local banner", () => {
    const t = newTask({ title: "A", scheduledAt: Date.now() - 60 * MIN, estimateMin: 30 });
    const s = reducer(base({ tasks: [t] }), { type: "setStatus", id: t.id, status: "in_progress" });
    expect(reducer(s, { type: "importState", state: base() }).notice).toBeUndefined();
  });
});
