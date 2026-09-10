// @vitest-environment node
import { describe, expect, it } from "vitest";
import { packSubtree, planLateStart, reflowFrom, DEFAULT_ESTIMATE_MINUTES } from "./estimate";
import type { Task } from "./types";

const day = (h: number, m = 0) => new Date(2026, 6, 20, h, m, 0, 0).getTime();

const task = (p: Partial<Task> & Pick<Task, "id">): Task => ({
  title: p.id, status: "pending", priority: 2, tags: [], createdAt: 0, loggedMin: 0, ...p,
});

describe("planLateStart", () => {
  it("pulls an overdue task to now", () => {
    const a = task({ id: "a", scheduledAt: day(10), estimateMin: 60 });
    const plan = planLateStart([a], "a", day(13), 5)!;
    expect(plan.startAt).toBe(day(13));
    expect(plan.blockedBy).toBeUndefined();
  });

  it("leaves a task that has not come round yet alone", () => {
    const a = task({ id: "a", scheduledAt: day(15), estimateMin: 60 });
    expect(planLateStart([a], "a", day(13), 5)).toBeNull();
  });

  it("ignores unscheduled and locked tasks", () => {
    expect(planLateStart([task({ id: "a" })], "a", day(13), 5)).toBeNull();
    const locked = task({ id: "a", scheduledAt: day(10), estimateMin: 60, locked: true });
    expect(planLateStart([locked], "a", day(13), 5)).toBeNull();
  });

  // The scenario from the brief: A was due at 10:00, it is now 13:00, and a
  // LOCKED task B owns 13:00–14:00. A cannot take B's slot, so it lands at
  // 14:05 (B's end + the 5-minute break) and the plan says who displaced it.
  it("jumps past a locked task holding the current slot, plus the break", () => {
    const a = task({ id: "a", title: "Task A", scheduledAt: day(10), estimateMin: 60 });
    const b = task({ id: "b", title: "Task B", scheduledAt: day(13), estimateMin: 60, locked: true });
    const plan = planLateStart([a, b], "a", day(13), 5)!;
    expect(plan.startAt).toBe(day(14, 5));
    expect(plan.blockedBy?.id).toBe("b");
    expect(plan.blockedUntil).toBe(day(14));
  });

  it("clears a whole chain of back-to-back locked tasks in one plan", () => {
    const a = task({ id: "a", scheduledAt: day(9), estimateMin: 60 });
    const b = task({ id: "b", scheduledAt: day(13), estimateMin: 60, locked: true });
    const c = task({ id: "c", scheduledAt: day(14), estimateMin: 30, locked: true });
    const plan = planLateStart([a, b, c], "a", day(13), 5)!;
    // c ends 14:30 and overlaps the slot a would take after b → 14:35.
    expect(plan.startAt).toBe(day(14, 35));
  });

  it("a finished or skipped locked task is not an obstacle", () => {
    const a = task({ id: "a", scheduledAt: day(10), estimateMin: 60 });
    const done = task({ id: "b", scheduledAt: day(13), estimateMin: 60, locked: true, status: "done" });
    expect(planLateStart([a, done], "a", day(13), 5)!.startAt).toBe(day(13));
  });

  it("gives up when the work window would roll the start to tomorrow", () => {
    const a = task({ id: "a", scheduledAt: day(6), estimateMin: 60 });
    // Now is 20:30 and the window shuts at 21:00 — the only conflict-free
    // slot is tomorrow's opening. Starting a task means doing it NOW, so the
    // plan is abandoned rather than sending a just-started task into
    // tomorrow with its timer running today.
    expect(planLateStart([a], "a", day(20, 30), 5, { startMin: 6 * 60, endMin: 21 * 60 })).toBeNull();
  });

  // The bug from the field: every block of the day is locked (a routine
  // schedule), the last one is an overnight sleep, and starting the 11:00
  // appointment at 11:21 hopped the placement over the whole wall — landing
  // the card on TOMORROW 06:50 while it showed as active today.
  it("gives up rather than move a started task past a locked wall onto another day", () => {
    const appt = task({ id: "appt", scheduledAt: day(11), estimateMin: 60 });
    const wall = task({ id: "wall", scheduledAt: day(10, 30), estimateMin: 12 * 60, locked: true });
    const sleep = task({ id: "sleep", scheduledAt: day(22, 45), estimateMin: 480, locked: true });
    expect(planLateStart([appt, wall, sleep], "appt", day(11, 21), 5)).toBeNull();
  });

  it("uses the default estimate when the task carries none", () => {
    const a = task({ id: "a", scheduledAt: day(10) });
    const b = task({ id: "b", scheduledAt: day(13), estimateMin: 30, locked: true });
    const plan = planLateStart([a, b], "a", day(13), 5)!;
    expect(DEFAULT_ESTIMATE_MINUTES).toBe(60);
    expect(plan.startAt).toBe(day(13, 35)); // b ends 13:30, +5 break
  });
});

describe("break between tasks", () => {
  it("packSubtree inserts the break between siblings but not around the run", () => {
    const root = task({ id: "r", scheduledAt: day(9) });
    const a = task({ id: "a", parentId: "r", estimateMin: 60 });
    const b = task({ id: "b", parentId: "r", estimateMin: 30 });
    const packed = packSubtree([root, a, b], "r", day(9), undefined, 5);
    expect(packed.get("a")).toEqual({ start: day(9), end: day(10) });
    expect(packed.get("b")).toEqual({ start: day(10, 5), end: day(10, 35) });
    // The parent spans work + internal gap only — no trailing break.
    expect(packed.get("r")).toEqual({ start: day(9), end: day(10, 35) });
  });

  it("packSubtree with breakMin 0 still packs edge-to-edge", () => {
    const root = task({ id: "r", scheduledAt: day(9) });
    const a = task({ id: "a", parentId: "r", estimateMin: 60 });
    const b = task({ id: "b", parentId: "r", estimateMin: 30 });
    const packed = packSubtree([root, a, b], "r", day(9), undefined, 0);
    expect(packed.get("b")!.start).toBe(day(10));
  });

  it("reflowFrom keeps the dragged task's literal drop time and breaks after it", () => {
    const root = task({ id: "r", scheduledAt: day(9) });
    const a = task({ id: "a", parentId: "r", estimateMin: 60, scheduledAt: day(9) });
    const b = task({ id: "b", parentId: "r", estimateMin: 30, scheduledAt: day(10) });
    const c = task({ id: "c", parentId: "r", estimateMin: 30, scheduledAt: day(11) });
    const out = reflowFrom([root, a, b, c], "b", day(13), undefined, 5)!;
    expect(out.find((t) => t.id === "b")!.scheduledAt).toBe(day(13));
    expect(out.find((t) => t.id === "c")!.scheduledAt).toBe(day(13, 35));
    // a sits before the drop point and must not move.
    expect(out.find((t) => t.id === "a")!.scheduledAt).toBe(day(9));
  });
});
