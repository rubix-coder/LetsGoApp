// @vitest-environment node
/* Long-range habit arithmetic. Every walk here steps days at noon, so the
   tests deliberately cross a DST boundary and a month/year boundary — an
   off-by-one in this file silently corrupts a record that took a year to
   build, and would otherwise only show up as "my streak reset itself". */
import { describe, expect, it } from "vitest";
import {
  combinedDays,
  combinedWeeks,
  heatLevel,
  heatmapWeeks,
  lifetimeStats,
  longestStreak,
  monthlyStats,
  overallHabitScore,
  perfectDays,
  rollingTrend,
  weekdayStats,
  yearlyStats,
} from "./habitStats";
import type { Habit } from "./types";

const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0, 0).getTime();

/** A habit created on `from`, with `done` marking the days that hit target. */
function habit(patch: Partial<Habit> & { createdAt: number }, doneDays: number[] = []): Habit {
  const log: Record<string, number> = {};
  for (const ms of doneDays) log[key(new Date(ms))] = patch.timesPerDay ?? 1;
  return { id: "h1", name: "Test", log, ...patch };
}

describe("heatLevel", () => {
  it("keeps 'nothing recorded' out of the ramp entirely", () => {
    expect(heatLevel(0, 1)).toBe(0);
    expect(heatLevel(0, 8)).toBe(0);
  });

  it("steps a partial day through the ramp and tops out at the target", () => {
    expect(heatLevel(1, 8)).toBe(1);
    expect(heatLevel(3, 8)).toBe(2);
    expect(heatLevel(6, 8)).toBe(3);
    expect(heatLevel(8, 8)).toBe(4);
  });

  it("does not exceed the top step when the target is overshot", () => {
    expect(heatLevel(20, 8)).toBe(4);
  });
});

describe("heatmapWeeks", () => {
  const created = at(2026, 1, 1);
  const today = at(2026, 3, 1);

  it("lays out whole weeks as columns of seven, ending in today's week", () => {
    const grid = heatmapWeeks(habit({ createdAt: created }), today, 8, 1);
    expect(grid).toHaveLength(8);
    for (const col of grid) expect(col).toHaveLength(7);
    expect(grid[0][0].dayMs).toBeLessThan(grid[7][6].dayMs);
  });

  it("starts every column on the configured first day of the week", () => {
    for (const start of [0, 1, 6] as const) {
      const grid = heatmapWeeks(habit({ createdAt: created }), today, 4, start);
      for (const col of grid) expect(new Date(col[0].dayMs).getDay()).toBe(start);
    }
  });

  it("marks the future and the pre-creation past as out of range, not as misses", () => {
    const grid = heatmapWeeks(habit({ createdAt: at(2026, 2, 20) }), at(2026, 2, 25), 3, 1);
    const flat = grid.flat();
    expect(flat.some((c) => !c.inRange && c.dayMs < at(2026, 2, 20))).toBe(true);
    expect(flat.filter((c) => c.dayMs > at(2026, 2, 25)).every((c) => !c.inRange)).toBe(true);
  });

  it("respects a weekday schedule — a Sunday-only habit is not due midweek", () => {
    const grid = heatmapWeeks(habit({ createdAt: created, days: [0] }), today, 4, 1);
    for (const cell of grid.flat()) {
      if (cell.inRange && new Date(cell.dayMs).getDay() !== 0) expect(cell.due).toBe(false);
    }
  });

  it("survives a spring-forward DST boundary without dropping or doubling a day", () => {
    // US DST 2026 begins Sun 8 Mar. Walk a grid straight through it.
    const grid = heatmapWeeks(habit({ createdAt: at(2026, 3, 1) }), at(2026, 3, 20), 4, 1);
    const days = grid.flat().map((c) => c.key);
    expect(new Set(days).size).toBe(days.length);           // no repeats
    expect(days).toContain("2026-03-08");                    // and none skipped
    expect(days).toContain("2026-03-09");
  });
});

describe("longestStreak", () => {
  it("finds the best run and reports its span", () => {
    const days = [at(2026, 1, 1), at(2026, 1, 2), at(2026, 1, 3), at(2026, 1, 8), at(2026, 1, 9)];
    const rec = longestStreak(habit({ createdAt: at(2026, 1, 1) }, days), at(2026, 1, 31));
    expect(rec.length).toBe(3);
    expect(rec.fromMs).toBe(at(2026, 1, 1));
    expect(rec.toMs).toBe(at(2026, 1, 3));
  });

  it("treats a non-due day as transparent — it neither extends nor breaks a run", () => {
    // Weekdays only; the weekend in between must not break the chain.
    const weekdays = [at(2026, 1, 1), at(2026, 1, 2), at(2026, 1, 5), at(2026, 1, 6)];
    const h = habit({ createdAt: at(2026, 1, 1), days: [1, 2, 3, 4, 5] }, weekdays);
    expect(longestStreak(h, at(2026, 1, 6)).length).toBe(4);
  });

  it("is zero for a habit that has never been done", () => {
    const rec = longestStreak(habit({ createdAt: at(2026, 1, 1) }), at(2026, 2, 1));
    expect(rec).toEqual({ length: 0, fromMs: null, toMs: null });
  });

  it("counts a partial day as a miss when the target is above one", () => {
    const h: Habit = { id: "h", name: "Water", createdAt: at(2026, 1, 1), timesPerDay: 8, log: { "2026-01-01": 8, "2026-01-02": 4, "2026-01-03": 8 } };
    expect(longestStreak(h, at(2026, 1, 3)).length).toBe(1);
  });
});

describe("monthlyStats / yearlyStats", () => {
  it("returns one entry per month, oldest first, ending on today's month", () => {
    const out = monthlyStats(habit({ createdAt: at(2025, 6, 1) }), at(2026, 3, 15), 12);
    expect(out).toHaveLength(12);
    expect(out[11].label).toBe(new Date(at(2026, 3, 15)).toLocaleDateString(undefined, { month: "short" }));
    expect(out[0].atMs).toBeLessThan(out[11].atMs);
  });

  it("counts only days inside the month, and inside the habit's life", () => {
    const h = habit({ createdAt: at(2026, 2, 10) }, [at(2026, 2, 10), at(2026, 2, 11), at(2026, 3, 1)]);
    const out = monthlyStats(h, at(2026, 3, 5), 2);
    expect(out[0].done).toBe(2);            // February
    expect(out[0].due).toBe(19);            // 10 Feb..28 Feb inclusive
    expect(out[1].done).toBe(1);            // March, up to the 5th
    expect(out[1].due).toBe(5);
  });

  it("reports rate null rather than zero when nothing was due", () => {
    const h = habit({ createdAt: at(2026, 3, 1), days: [0] });   // Sundays only
    const out = monthlyStats(h, at(2026, 3, 3), 1);              // Mon-Tue only
    expect(out[0].due).toBe(1);                                   // 1 Mar 2026 is a Sunday
    expect(monthlyStats(h, at(2026, 3, 3), 3)[0].rate).toBeNull();
  });

  it("walks whole years across a year boundary", () => {
    const h = habit({ createdAt: at(2025, 12, 30) }, [at(2025, 12, 31), at(2026, 1, 1)]);
    const out = yearlyStats(h, at(2026, 1, 2));
    expect(out.map((p) => p.label)).toEqual(["2025", "2026"]);
    expect(out[0].done).toBe(1);
    expect(out[1].done).toBe(1);
  });
});

describe("weekdayStats", () => {
  it("buckets a lifetime by day of the week, Sunday first", () => {
    // Four Mondays done, four Wednesdays missed.
    const mondays = [at(2026, 1, 5), at(2026, 1, 12), at(2026, 1, 19), at(2026, 1, 26)];
    const out = weekdayStats(habit({ createdAt: at(2026, 1, 1) }, mondays), at(2026, 1, 31));
    expect(out).toHaveLength(7);
    expect(out[1].label).toBe("Mon");
    expect(out[1].done).toBe(4);
    expect(out[3].done).toBe(0);            // Wednesday — the weak spot
    expect(out[3].rate).toBe(0);
  });
});

describe("lifetimeStats", () => {
  it("separates effort from success: active days, done days, and every tick", () => {
    const h: Habit = {
      id: "h", name: "Water", createdAt: at(2026, 1, 1), timesPerDay: 8,
      log: { "2026-01-01": 8, "2026-01-02": 3, "2026-01-03": 8 },
    };
    const out = lifetimeStats(h, at(2026, 1, 4));
    expect(out.totalTicks).toBe(19);
    expect(out.doneDays).toBe(2);           // the 3-tick day is effort, not success
    expect(out.activeDays).toBe(3);
    expect(out.dueDays).toBe(4);
    expect(out.ageDays).toBe(4);
    expect(out.rate).toBeCloseTo(0.5);
  });

  it("reports rate null for a habit with nothing due yet", () => {
    const h = habit({ createdAt: at(2026, 3, 2), days: [0] });    // Sundays; 2 Mar is a Monday
    expect(lifetimeStats(h, at(2026, 3, 3)).rate).toBeNull();
  });
});

describe("rollingTrend", () => {
  it("samples a trailing window across the span, oldest first", () => {
    const done = [at(2026, 1, 1), at(2026, 1, 2), at(2026, 1, 3)];
    const pts = rollingTrend(habit({ createdAt: at(2026, 1, 1) }, done), at(2026, 1, 10), 10, 7);
    expect(pts.length).toBeGreaterThan(1);
    expect(pts[0].atMs).toBeLessThan(pts[pts.length - 1].atMs);
    expect(pts[0].rate).toBe(1);            // day 1: the only due day was done
  });

  it("never samples before the habit existed", () => {
    const pts = rollingTrend(habit({ createdAt: at(2026, 1, 20) }), at(2026, 1, 25), 60, 30);
    expect(pts.every((p) => p.atMs >= at(2026, 1, 20))).toBe(true);
  });
});

describe("combinedDays / perfectDays", () => {
  const a = habit({ createdAt: at(2026, 1, 1) }, [at(2026, 1, 1), at(2026, 1, 2)]);
  const b: Habit = { ...habit({ createdAt: at(2026, 1, 1) }, [at(2026, 1, 1)]), id: "h2", name: "B" };

  it("rolls every habit up per day", () => {
    const out = combinedDays([a, b], at(2026, 1, 2), 2);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ due: 2, done: 2, rate: 1 });   // 1 Jan: both
    expect(out[1]).toMatchObject({ due: 2, done: 1 });            // 2 Jan: one
  });

  it("counts a perfect day only when something was actually due", () => {
    expect(perfectDays([a, b], at(2026, 1, 2), 2)).toBe(1);
    // A habit due only on Sundays makes Mon-Sat empty, never "perfect".
    const sunday = habit({ createdAt: at(2026, 1, 5), days: [0] });
    expect(perfectDays([sunday], at(2026, 1, 9), 4)).toBe(0);
  });

  it("ignores archived habits", () => {
    const gone: Habit = { ...b, archivedAt: at(2026, 1, 2) };
    expect(combinedDays([a, gone], at(2026, 1, 1), 1)[0].due).toBe(1);
  });
});

/* Regression: every walk used to start at `createdAt`, so a habit imported
   from a markdown ledger — created today, carrying a year of log — reported
   no history at all, and the charts the import existed to fill came out
   empty. The log is the evidence; createdAt is only when this device first
   heard about the habit. */
describe("imported history", () => {
  const imported: Habit = {
    id: "h", name: "Meditate", createdAt: at(2026, 8, 29),
    log: { "2026-06-01": 1, "2026-06-02": 1, "2026-06-03": 1, "2026-08-29": 1 },
  };

  it("counts a lifetime from the earliest logged day, not from createdAt", () => {
    const life = lifetimeStats(imported, at(2026, 8, 29));
    expect(life.ageDays).toBeGreaterThan(80);
    expect(life.doneDays).toBe(4);
    expect(life.firstDayMs).toBe(at(2026, 6, 1));
  });

  it("finds a record streak that predates createdAt", () => {
    expect(longestStreak(imported, at(2026, 8, 29)).length).toBe(3);
  });

  it("draws imported days on the grid instead of marking them out of range", () => {
    const cells = heatmapWeeks(imported, at(2026, 8, 29), 20, 1).flat();
    const june = cells.find((c) => c.key === "2026-06-02");
    expect(june?.inRange).toBe(true);
    expect(june?.level).toBe(4);
  });

  it("rolls imported days into the overview", () => {
    const days = combinedDays([imported], at(2026, 8, 29), 100);
    expect(days.some((d) => d.done === 1 && d.dayMs < at(2026, 7, 1))).toBe(true);
  });

  it("still uses createdAt when it is earlier than anything logged", () => {
    const fresh: Habit = { id: "f", name: "New", createdAt: at(2026, 8, 1), log: { "2026-08-20": 1 } };
    expect(lifetimeStats(fresh, at(2026, 8, 29)).firstDayMs).toBe(at(2026, 8, 1));
  });
});

describe("combinedWeeks", () => {
  it("pads every column to seven days and marks alignment padding out of range", () => {
    const h = habit({ createdAt: at(2026, 6, 1) }, [at(2026, 8, 27), at(2026, 8, 28)]);
    const cols = combinedWeeks([h], at(2026, 8, 29), 30, 1);
    for (const col of cols) expect(col).toHaveLength(7);

    const flat = cols.flat();
    const hit = flat.find((c) => key(new Date(c.dayMs)) === "2026-08-28");
    expect(hit?.inRange).toBe(true);
    expect(hit?.done).toBe(1);
    expect(flat.some((c) => !c.inRange && c.dayMs < at(2026, 7, 30))).toBe(true);
  });
});

describe("overallHabitScore", () => {
  const everyDayUpTo = (end: number, n: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const d = new Date(end);
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() - i);
      out.push(d.getTime());
    }
    return out;
  };

  it("is zero and 'Building' with no habits", () => {
    expect(overallHabitScore([], at(2026, 8, 29))).toEqual({ score: 0, band: "Building" });
  });

  it("tops out at 'Locked in' for a long, fully-kept run", () => {
    const end = at(2026, 8, 29);
    const h = habit({ createdAt: at(2026, 5, 1) }, everyDayUpTo(end, 100));
    const { score, band } = overallHabitScore([h], end);
    expect(score).toBeGreaterThanOrEqual(90);
    expect(band).toBe("Locked in");
  });

  it("sits low when recent days are mostly missed", () => {
    const end = at(2026, 8, 29);
    const h = habit({ createdAt: at(2026, 5, 1) }, everyDayUpTo(end, 100).filter((_, i) => i % 5 === 0));
    expect(overallHabitScore([h], end).score).toBeLessThan(40);
  });
});
