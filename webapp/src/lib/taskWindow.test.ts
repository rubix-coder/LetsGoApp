// @vitest-environment node
/* The board window: how far back and how far ahead the date-axis-less views
   reach, and the two things it must never hide — undated backlog, and a tree
   with live work in it. */
import { describe, expect, it } from "vitest";
import {
  filterTaskWindow,
  isUnlimited,
  rangeOptionFor,
  taskInWindow,
  taskWindowBounds,
  taskWindowOf,
  windowLabel,
  UNLIMITED_WINDOW,
} from "./taskWindow";
import type { Task } from "./types";

const DAY = 86_400_000;
const NOW = new Date(2026, 6, 20, 13, 0, 0, 0).getTime(); // Mon 20 Jul 2026, 13:00
const daysOut = (n: number): number => NOW + n * DAY;

function task(patch: Partial<Task> & Pick<Task, "id">): Task {
  return { title: patch.id, status: "pending", priority: 2, tags: [], createdAt: 0, loggedMin: 0, ...patch };
}

const week = { pastDays: 7, futureDays: 7 };

describe("taskWindowOf", () => {
  it("reads a vault saved before the setting existed as unlimited", () => {
    expect(taskWindowOf({})).toEqual(UNLIMITED_WINDOW);
    expect(isUnlimited(taskWindowOf({}))).toBe(true);
  });

  it("keeps a configured window, and treats junk as no limit", () => {
    expect(taskWindowOf({ taskWindow: { pastDays: 3, futureDays: null } })).toEqual({ pastDays: 3, futureDays: null });
    expect(taskWindowOf({ taskWindow: { pastDays: -1, futureDays: 30 } })).toEqual({ pastDays: null, futureDays: 30 });
  });
});

describe("taskWindowBounds", () => {
  it("covers whole local days at both ends", () => {
    const { start, end } = taskWindowBounds({ pastDays: 3, futureDays: 3 }, NOW);
    expect(start).toBe(new Date(2026, 6, 17, 0, 0, 0, 0).getTime());
    expect(end).toBe(new Date(2026, 6, 24, 0, 0, 0, 0).getTime() - 1);
  });

  it("is open-ended where the window says null", () => {
    const { start, end } = taskWindowBounds(UNLIMITED_WINDOW, NOW);
    expect(start).toBe(-Infinity);
    expect(end).toBe(Infinity);
  });
});

describe("taskInWindow", () => {
  const bounds = taskWindowBounds(week, NOW);

  it("keeps a task scheduled inside the window", () => {
    expect(taskInWindow(task({ id: "a", scheduledAt: daysOut(2) }), bounds)).toBe(true);
  });

  it("drops one scheduled outside it, either side", () => {
    expect(taskInWindow(task({ id: "a", scheduledAt: daysOut(-30) }), bounds)).toBe(false);
    expect(taskInWindow(task({ id: "b", scheduledAt: daysOut(30) }), bounds)).toBe(false);
  });

  it("never hides an undated task — that is the backlog, not old data", () => {
    expect(taskInWindow(task({ id: "a" }), bounds)).toBe(true);
  });

  it("keeps a routine whose old anchor still lands an occurrence in the window", () => {
    // Daily series started 400 days ago — it occurs every day, so it is in.
    expect(taskInWindow(task({ id: "a", scheduledAt: daysOut(-400), repeat: { interval: 1, unit: "daily" } }), bounds)).toBe(true);
  });

  it("drops a yearly event whose next occurrence is outside the window", () => {
    // Birthday anchored 100 days ago: next occurrence is ~265 days out, well
    // past a one-week window.
    expect(taskInWindow(task({ id: "bday", scheduledAt: daysOut(-100), repeat: { interval: 1, unit: "yearly" } }), bounds)).toBe(false);
  });

  it("keeps a yearly event whose occurrence falls inside the window", () => {
    expect(taskInWindow(task({ id: "bday", scheduledAt: daysOut(-365 + 3), repeat: { interval: 1, unit: "yearly" } }), bounds)).toBe(true);
  });

  it("always keeps a routine when the future side is open-ended", () => {
    const openEnd = taskWindowBounds({ pastDays: 7, futureDays: null }, NOW);
    expect(taskInWindow(task({ id: "bday", scheduledAt: daysOut(-100), repeat: { interval: 1, unit: "yearly" } }), openEnd)).toBe(true);
  });

  it("falls back to the deadline, then to when it was finished", () => {
    expect(taskInWindow(task({ id: "a", deadline: daysOut(3) }), bounds)).toBe(true);
    expect(taskInWindow(task({ id: "b", status: "done", completedAt: daysOut(-60) }), bounds)).toBe(false);
  });
});

describe("filterTaskWindow", () => {
  it("does no work at all when nothing is limited", () => {
    const roots = [task({ id: "a", scheduledAt: daysOut(-500) })];
    const out = filterTaskWindow(roots, roots, UNLIMITED_WINDOW, NOW);
    expect(out.roots).toEqual(roots);
    expect(out.ids).toBeNull();
  });

  it("keeps a whole tree when any one task in it is live", () => {
    const root = task({ id: "root", scheduledAt: daysOut(-90) });
    const stale = task({ id: "stale", parentId: "root", scheduledAt: daysOut(-90) });
    const live = task({ id: "live", parentId: "root", scheduledAt: daysOut(1) });
    const all = [root, stale, live];
    const out = filterTaskWindow([root], all, week, NOW);
    expect(out.roots.map((t) => t.id)).toEqual(["root"]);
    expect([...out.ids!].sort()).toEqual(["live", "root", "stale"]);
  });

  it("drops a tree with nothing left inside the window", () => {
    const root = task({ id: "root", scheduledAt: daysOut(-90) });
    const kid = task({ id: "kid", parentId: "root", scheduledAt: daysOut(-91) });
    const other = task({ id: "other", scheduledAt: daysOut(1) });
    const out = filterTaskWindow([root, other], [root, kid, other], week, NOW);
    expect(out.roots.map((t) => t.id)).toEqual(["other"]);
    expect(out.ids!.has("root")).toBe(false);
  });
});

describe("labels", () => {
  it("names the window in words", () => {
    expect(windowLabel(UNLIMITED_WINDOW)).toBe("Everything");
    expect(windowLabel({ pastDays: 30, futureDays: 14 })).toBe("last 1 month · next 2 weeks");
    expect(windowLabel({ pastDays: 7, futureDays: null })).toBe("last 1 week · everything ahead");
  });

  it("falls back to Everything for a day count no option names", () => {
    expect(rangeOptionFor(999).id).toBe("all");
    expect(rangeOptionFor(30).label).toBe("1 month");
  });
});
