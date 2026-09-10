// @vitest-environment node
import { describe, expect, it } from "vitest";
import { addDays, at, startOfDay } from "./dates";
import { canDepend, ganttSpan, groupGanttTasks, routineDaysInSpan, taskGanttWindow } from "./gantt";
import type { TaskStatus } from "./types";

const day = startOfDay(new Date(2026, 6, 10).getTime()); // Fri Jul 10 2026, local

describe("taskGanttWindow", () => {
  it("runs a scheduled task out to its deadline", () => {
    const w = taskGanttWindow({ scheduledAt: at(day, 9), deadline: at(addDays(day, 3), 17) });
    expect(w).toEqual({ start: at(day, 9), end: at(addDays(day, 3), 17), milestone: false });
  });

  it("falls back to the estimate when there is no deadline", () => {
    expect(taskGanttWindow({ scheduledAt: at(day, 9), estimateMin: 120 })!.end).toBe(at(day, 11));
  });

  it("keeps the estimate end when the deadline is earlier", () => {
    expect(taskGanttWindow({ scheduledAt: at(day, 9), estimateMin: 240, deadline: at(day, 10) })!.end).toBe(at(day, 13));
  });

  it("floors tiny estimates at 30 minutes so the bar stays visible", () => {
    expect(taskGanttWindow({ scheduledAt: at(day, 9), estimateMin: 5 })!.end).toBe(at(day, 9, 30));
  });

  it("turns a deadline-only task into a milestone point", () => {
    expect(taskGanttWindow({ deadline: at(day, 17) })).toEqual({ start: at(day, 17), end: at(day, 17), milestone: true });
  });

  it("returns null with neither schedule nor deadline", () => {
    expect(taskGanttWindow({ estimateMin: 60 })).toBeNull();
  });
});

describe("ganttSpan", () => {
  it("covers earliest start through farthest end, padded a day each side", () => {
    const span = ganttSpan(
      [
        { start: at(day, 9), end: at(addDays(day, 4), 17) },
        { start: at(addDays(day, 2), 8), end: at(addDays(day, 30), 12) },
      ],
      at(day, 12),
    );
    expect(span.start).toBe(addDays(day, -1));
    expect(span.days).toBe(33); // Jul 9 pad + Jul 10 – Aug 9 + Aug 10 pad
  });

  it("always includes today even when every task is in the past", () => {
    const span = ganttSpan([{ start: at(addDays(day, -40), 9), end: at(addDays(day, -35), 17) }], at(day, 12));
    expect(span.start).toBe(addDays(day, -41));
    expect(addDays(span.start, span.days - 1)).toBeGreaterThanOrEqual(day);
  });

  it("gives an empty timeline a two-week runway", () => {
    const span = ganttSpan([], at(day, 12));
    expect(span.start).toBe(addDays(day, -1));
    expect(span.days).toBe(14);
  });
});

describe("groupGanttTasks", () => {
  const t = (status: TaskStatus, priority: number, tags: string[] = []) => ({ status, priority, tags });

  it("orders status groups like the board columns and drops empty ones", () => {
    const groups = groupGanttTasks([t("done", 2), t("pending", 1), t("in_progress", 0)], "status");
    expect(groups.map((g) => g.key)).toEqual(["in_progress", "pending", "done"]);
    expect(groups.map((g) => g.label)).toEqual(["In progress", "Pending", "Done"]);
  });

  it("runs priorities P0→P3 with the Eisenhower names", () => {
    const groups = groupGanttTasks([t("pending", 3), t("pending", 0)], "priority");
    expect(groups.map((g) => g.key)).toEqual(["p0", "p3"]);
    expect(groups[0].label).toBe("P0 · Do first");
  });

  it("groups by first tag alphabetically, untagged last", () => {
    const groups = groupGanttTasks(
      [t("pending", 2, ["web", "x"]), t("pending", 2, ["api"]), t("pending", 2)],
      "tag",
    );
    expect(groups.map((g) => g.label)).toEqual(["#api", "#web", "No tag"]);
    expect(groups[1].tasks).toHaveLength(1);
  });
});

describe("canDepend", () => {
  const tasks = [
    { id: "a" },
    { id: "b", dependsOn: ["a"] },
    { id: "c", dependsOn: ["b"] },
  ];

  it("allows a fresh forward link", () => {
    expect(canDepend(tasks, "a", "c")).toBe(true);
  });

  it("rejects self-links, duplicates and unknown ids", () => {
    expect(canDepend(tasks, "a", "a")).toBe(false);
    expect(canDepend(tasks, "a", "b")).toBe(false); // already linked
    expect(canDepend(tasks, "ghost", "a")).toBe(false);
  });

  it("rejects direct and transitive cycles", () => {
    expect(canDepend(tasks, "b", "a")).toBe(false); // b already depends on a
    expect(canDepend(tasks, "c", "a")).toBe(false); // c → b → a
  });
});

describe("routineDaysInSpan", () => {
  it("lists every daily occurrence inside the span, none before the anchor", () => {
    const anchor = at(day, 7); // 07:00 on the anchor day
    const days = routineDaysInSpan(anchor, { interval: 1, unit: "daily" }, addDays(day, -2), addDays(day, 3));
    expect(days).toEqual([day, addDays(day, 1), addDays(day, 2)]);
  });

  it("respects the repeat interval", () => {
    const days = routineDaysInSpan(at(day, 9), { interval: 2, unit: "daily" }, day, addDays(day, 5));
    expect(days).toEqual([day, addDays(day, 2), addDays(day, 4)]);
  });

  it("weekly repeats land on the anchor weekday only", () => {
    const days = routineDaysInSpan(at(day, 9), { interval: 1, unit: "weekly" }, day, addDays(day, 15));
    expect(days).toEqual([day, addDays(day, 7), addDays(day, 14)]);
  });
});
