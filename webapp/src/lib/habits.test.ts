// @vitest-environment node
import { describe, expect, it } from "vitest";
import { completionStats, currentStreak, habitScheduleSummary, habitTarget, isDoneOn, isDueOn, tickHabit, ticksOn } from "./habits";
import { occurrenceDateKey } from "./occurrence";
import type { Habit } from "./types";

/** Noon on a fixed Friday — noon keeps day arithmetic clear of DST edges. */
const FRI = new Date(2026, 7, 7, 12, 0, 0).getTime(); // 2026-08-07 is a Friday
const day = (offset: number) => {
  const d = new Date(FRI);
  d.setDate(d.getDate() + offset);
  return d.getTime();
};
const key = (offset: number) => occurrenceDateKey(day(offset));

function habit(patch: Partial<Habit> = {}): Habit {
  return { id: "h1", name: "Wake up by 6", createdAt: day(-30), log: {}, ...patch };
}

describe("due days and targets", () => {
  it("defaults to due every day with a target of 1", () => {
    expect(isDueOn(habit(), day(0))).toBe(true);
    expect(isDueOn(habit(), day(-1))).toBe(true);
    expect(habitTarget(habit())).toBe(1);
  });

  it("honors a weekday schedule", () => {
    const swim = habit({ days: [1, 3, 5] }); // Mon Wed Fri
    expect(isDueOn(swim, FRI)).toBe(true);
    expect(isDueOn(swim, day(1))).toBe(false); // Saturday
  });

  it("a multi-times day counts done only at target", () => {
    const water = habit({ timesPerDay: 8, log: { [key(0)]: 7 } });
    expect(ticksOn(water, day(0))).toBe(7);
    expect(isDoneOn(water, day(0))).toBe(false);
    expect(isDoneOn({ ...water, log: { [key(0)]: 8 } }, day(0))).toBe(true);
  });
});

describe("tickHabit", () => {
  it("increments, decrements and never goes negative", () => {
    let h = habit();
    h = tickHabit(h, key(0), 1);
    expect(h.log[key(0)]).toBe(1);
    h = tickHabit(h, key(0), -1);
    h = tickHabit(h, key(0), -1);
    expect(h.log[key(0)] ?? 0).toBe(0);
  });
});

describe("currentStreak", () => {
  it("counts consecutive done due-days ending today", () => {
    const h = habit({ log: { [key(0)]: 1, [key(-1)]: 1, [key(-2)]: 1 } });
    expect(currentStreak(h, FRI)).toBe(3);
  });

  it("an unfinished today shows yesterday's run, not zero", () => {
    const h = habit({ log: { [key(-1)]: 1, [key(-2)]: 1 } });
    expect(currentStreak(h, FRI)).toBe(2);
  });

  it("a missed due day breaks the run", () => {
    const h = habit({ log: { [key(0)]: 1, [key(-2)]: 1 } });
    expect(currentStreak(h, FRI)).toBe(1);
  });

  it("non-due days neither count nor break — the Mon/Wed/Fri swim", () => {
    const swim = habit({ days: [1, 3, 5], log: { [key(0)]: 1, [key(-2)]: 1, [key(-4)]: 1 } }); // Fri, Wed, Mon
    expect(currentStreak(swim, FRI)).toBe(3);
  });

  it("counts a logged day even when it predates createdAt", () => {
    // Changed deliberately: a run now starts at `habitStartMs`, the EARLIER of
    // createdAt and the first logged day. A habit imported from a markdown
    // ledger is created today and carries years of log behind it, and the old
    // createdAt-only rule threw all of that away — a streak the user really
    // kept read as one day. A tick on a day is evidence the day happened.
    const h = habit({ createdAt: day(-1), log: { [key(0)]: 1, [key(-1)]: 1, [key(-2)]: 1 } });
    expect(currentStreak(h, FRI)).toBe(3);
  });

  it("still stops at createdAt when nothing older was ever logged", () => {
    const h = habit({ createdAt: day(-1), log: { [key(0)]: 1, [key(-1)]: 1 } });
    expect(currentStreak(h, FRI)).toBe(2);
  });
});

describe("completionStats", () => {
  it("counts due and done days over a window ending today", () => {
    const h = habit({ log: { [key(0)]: 1, [key(-1)]: 1, [key(-3)]: 1 } });
    expect(completionStats(h, 7, FRI)).toEqual({ due: 7, done: 3 });
  });

  it("window clips to the habit's lifetime and schedule", () => {
    const swim = habit({ days: [1, 3, 5], createdAt: day(-2), log: { [key(0)]: 1 } });
    // Window of 7 days, but the habit is 3 days old (Wed–Fri): due Wed + Fri.
    expect(completionStats(swim, 7, FRI)).toEqual({ due: 2, done: 1 });
  });
});

describe("habitScheduleSummary", () => {
  it("says every day when no days are singled out", () => {
    expect(habitScheduleSummary(true, [], 1)).toBe("Every day");
  });

  it("names the chosen days, in week order", () => {
    expect(habitScheduleSummary(false, [5, 1, 3], 1)).toBe("Mon, Wed, Fri");
  });

  it("reads weekdays and weekends by name rather than listing them", () => {
    expect(habitScheduleSummary(false, [1, 2, 3, 4, 5], 1)).toBe("Weekdays");
    expect(habitScheduleSummary(false, [0, 6], 1)).toBe("Weekends");
  });

  it("appends the daily target once it is more than one", () => {
    expect(habitScheduleSummary(true, [], 3)).toBe("Every day · 3× a day");
    expect(habitScheduleSummary(false, [1], 2)).toBe("Mon · 2× a day");
  });

  it("orders the week Monday-first, so Sunday reads last", () => {
    expect(habitScheduleSummary(false, [0, 1], 1)).toBe("Mon, Sun");
  });

  it("says so when no day is picked — the state that blocks saving", () => {
    expect(habitScheduleSummary(false, [], 1)).toBe("No days picked");
  });

  it("treats all seven days as every day, however they were ticked", () => {
    expect(habitScheduleSummary(false, [0, 1, 2, 3, 4, 5, 6], 1)).toBe("Every day");
  });
});
