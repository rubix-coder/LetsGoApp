// @vitest-environment node
import { describe, expect, it } from "vitest";
import { groupSessionsByDay, sessionKind } from "./sessionLog";
import type { Session } from "./types";

const DAY = 86_400_000;
const noon = new Date(2023, 10, 14, 12, 0, 0).getTime();
const s = (id: string, startedAt: number, minutes: number, kind?: "focus" | "pause"): Session => ({
  id, label: id, startedAt, minutes, kind,
});

describe("sessionKind", () => {
  it("treats a missing kind as focus", () => {
    expect(sessionKind({ kind: undefined })).toBe("focus");
    expect(sessionKind({ kind: "pause" })).toBe("pause");
  });
});

describe("groupSessionsByDay", () => {
  it("orders days newest-first and rows newest-first within a day", () => {
    const days = groupSessionsByDay([
      s("old", noon - 2 * DAY, 10),
      s("today-early", noon - 2 * 3_600_000, 10),
      s("today-late", noon, 10),
    ]);
    expect(days.map((d) => d.rows.map((r) => r.id))).toEqual([["today-late", "today-early"], ["old"]]);
  });

  it("totals worked and paused minutes per day", () => {
    const days = groupSessionsByDay([
      s("f1", noon, 40),
      s("brk", noon - 3_600_000, 12, "pause"),
      s("f2", noon - 2 * 3_600_000, 8),
    ]);
    expect(days).toHaveLength(1);
    expect(days[0].focusMin).toBe(48);
    expect(days[0].pauseMin).toBe(12);
  });

  it("is empty for no sessions", () => {
    expect(groupSessionsByDay([])).toEqual([]);
  });
});
